import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ErrorCode,
  configInvalidJsonError,
  configMissingFieldError,
  configNotFoundError,
  configSearchError,
  formatCliError,
  serverNotFoundError,
} from './errors.js';

export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpServerConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export type ServerConfig = StdioServerConfig | HttpServerConfig;

export interface McpServersConfig {
  mcpServers: Record<string, ServerConfig>;
  _configSource?: string;
}

export function isHttpServer(config: ServerConfig): config is HttpServerConfig {
  return 'url' in config;
}

export function isStdioServer(
  config: ServerConfig,
): config is StdioServerConfig {
  return 'command' in config;
}

export const DEFAULT_TIMEOUT_SECONDS = 1800;
export const DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_SECONDS * 1000;
export const DEFAULT_CONCURRENCY = 5;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 1000;

export function debug(message: string): void {
  if (process.env.MCP_DEBUG) {
    console.error(`[mcpx] ${message}`);
  }
}

export function getTimeoutMs(): number {
  const envTimeout = process.env.MCP_TIMEOUT;
  if (envTimeout) {
    const seconds = Number.parseInt(envTimeout, 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  return DEFAULT_TIMEOUT_MS;
}

export function getConcurrencyLimit(): number {
  const envConcurrency = process.env.MCP_CONCURRENCY;
  if (envConcurrency) {
    const limit = Number.parseInt(envConcurrency, 10);
    if (!Number.isNaN(limit) && limit > 0) {
      return limit;
    }
  }
  return DEFAULT_CONCURRENCY;
}

export function getMaxRetries(): number {
  const envRetries = process.env.MCP_MAX_RETRIES;
  if (envRetries) {
    const retries = Number.parseInt(envRetries, 10);
    if (!Number.isNaN(retries) && retries >= 0) {
      return retries;
    }
  }
  return DEFAULT_MAX_RETRIES;
}

export function getRetryDelayMs(): number {
  const envDelay = process.env.MCP_RETRY_DELAY;
  if (envDelay) {
    const delay = Number.parseInt(envDelay, 10);
    if (!Number.isNaN(delay) && delay > 0) {
      return delay;
    }
  }
  return DEFAULT_RETRY_DELAY_MS;
}

function isStrictEnvMode(): boolean {
  const value = process.env.MCP_STRICT_ENV?.toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Substitute environment variables in a string
 * Supports ${VAR_NAME} syntax
 *
 * By default (strict mode), throws an error when referenced env var is not set.
 * Set MCP_STRICT_ENV=false to warn instead of error.
 */
function substituteEnvVars(value: string): string {
  const missingVars: string[] = [];

  const result = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      missingVars.push(varName);
      return '';
    }
    return envValue;
  });

  if (missingVars.length > 0) {
    const varList = missingVars.map((v) => `\${${v}}`).join(', ');
    const message = `Missing environment variable${missingVars.length > 1 ? 's' : ''}: ${varList}`;

    if (isStrictEnvMode()) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'MISSING_ENV_VAR',
          message: message,
          details: 'Referenced in config but not set in environment',
          suggestion: `Set the variable(s) before running: export ${missingVars[0]}="value" or set MCP_STRICT_ENV=false to use empty values`,
        }),
      );
    }
    console.error(`[mcpx] Warning: ${message}`);
  }

  return result;
}

function substituteEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVarsInObject) as T;
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVarsInObject(value);
    }
    return result as T;
  }
  return obj;
}

function getDefaultConfigPaths(): string[] {
  const paths: string[] = [];
  const home = homedir();

  paths.push(resolve('./mcp_servers.json'));
  paths.push(join(home, '.mcp_servers.json'));
  paths.push(join(home, '.config', 'mcp', 'mcp_servers.json'));

  return paths;
}

export interface ConfigPathInfo {
  path: string;
  exists: boolean;
  active: boolean;
  source?: 'cli' | 'env' | 'search';
}

export interface ConfigPathsResult {
  active: string | null;
  activeSource: 'cli' | 'env' | 'search' | null;
  searchPaths: ConfigPathInfo[];
  envVar: string | undefined;
}

export function getConfigPaths(explicitPath?: string): ConfigPathsResult {
  const envPath = process.env.MCP_CONFIG_PATH;

  type Source = 'cli' | 'env' | 'search';
  const candidates: Array<{ path: string; source: Source }> = [];

  if (explicitPath)
    candidates.push({ path: resolve(explicitPath), source: 'cli' });
  if (envPath) candidates.push({ path: resolve(envPath), source: 'env' });
  for (const p of getDefaultConfigPaths())
    candidates.push({ path: p, source: 'search' });

  const seen = new Set<string>();
  const pathInfos: ConfigPathInfo[] = [];
  let active: string | null = null;
  let activeSource: Source | null = null;

  for (const { path, source } of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);

    const exists = existsSync(path);
    const isActive = exists && active === null;
    if (isActive) {
      active = path;
      activeSource = source;
    }

    pathInfos.push({ path, exists, active: isActive, source });
  }

  return { active, activeSource, searchPaths: pathInfos, envVar: envPath };
}

function isInlineJson(value: string): boolean {
  return value.trimStart().startsWith('{');
}

export async function loadConfig(
  explicitPath?: string,
): Promise<McpServersConfig> {
  let config: McpServersConfig;
  let configSource: string;

  const inlineValue = explicitPath ?? process.env.MCP_CONFIG_PATH;
  if (inlineValue && isInlineJson(inlineValue)) {
    configSource = '<inline>';
    try {
      config = JSON.parse(inlineValue);
    } catch (e) {
      throw new Error(
        formatCliError(
          configInvalidJsonError('<inline>', (e as Error).message),
        ),
      );
    }
  } else {
    let configPath: string | undefined;

    if (explicitPath) {
      configPath = resolve(explicitPath);
    } else if (process.env.MCP_CONFIG_PATH) {
      configPath = resolve(process.env.MCP_CONFIG_PATH);
    }

    if (configPath) {
      if (!existsSync(configPath)) {
        throw new Error(formatCliError(configNotFoundError(configPath)));
      }
    } else {
      const searchPaths = getDefaultConfigPaths();
      for (const path of searchPaths) {
        if (existsSync(path)) {
          configPath = path;
          break;
        }
      }

      if (!configPath) {
        throw new Error(formatCliError(configSearchError()));
      }
    }

    configSource = configPath;
    const file = Bun.file(configPath);
    const content = await file.text();

    try {
      config = JSON.parse(content);
    } catch (e) {
      throw new Error(
        formatCliError(
          configInvalidJsonError(configPath, (e as Error).message),
        ),
      );
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    throw new Error(formatCliError(configMissingFieldError(configSource)));
  }

  if (Object.keys(config.mcpServers).length === 0) {
    console.error(
      '[mcpx] Warning: No servers configured in mcpServers. Add server configurations to use MCP tools.',
    );
  }

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    if (!serverConfig || typeof serverConfig !== 'object') {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'CONFIG_INVALID_SERVER',
          message: `Invalid server configuration for "${serverName}"`,
          details: 'Server config must be an object',
          suggestion: `Use { "command": "..." } for stdio or { "url": "..." } for HTTP`,
        }),
      );
    }

    const hasCommand = 'command' in serverConfig;
    const hasUrl = 'url' in serverConfig;

    if (!hasCommand && !hasUrl) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'CONFIG_INVALID_SERVER',
          message: `Server "${serverName}" missing required field`,
          details: `Must have either "command" (for stdio) or "url" (for HTTP)`,
          suggestion: `Add "command": "npx ..." for local servers or "url": "https://..." for remote servers`,
        }),
      );
    }

    if (hasCommand && hasUrl) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'CONFIG_INVALID_SERVER',
          message: `Server "${serverName}" has both "command" and "url"`,
          details:
            'A server must be either stdio (command) or HTTP (url), not both',
          suggestion: `Remove one of "command" or "url"`,
        }),
      );
    }
  }

  config = substituteEnvVarsInObject(config);
  config._configSource = configSource;

  return config;
}

export function getServerConfig(
  config: McpServersConfig,
  serverName: string,
): ServerConfig {
  const server = config.mcpServers[serverName];
  if (!server) {
    const available = Object.keys(config.mcpServers);
    throw new Error(
      formatCliError(
        serverNotFoundError(serverName, available, config._configSource),
      ),
    );
  }
  return server;
}

export function listServerNames(config: McpServersConfig): string[] {
  return Object.keys(config.mcpServers);
}

export interface DisabledToolsMatch {
  pattern: string;
  source: string;
}

function globMatch(pattern: string, str: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return regex.test(str);
}

function getDisabledToolsPaths(): string[] {
  const home = homedir();
  return [
    join(home, '.config', 'mcp', 'disabled_tools'),
    join(home, '.mcp_disabled_tools'),
    resolve('./mcp_disabled_tools'),
  ];
}

function parseDisabledToolsFile(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export async function loadDisabledTools(): Promise<Map<string, string>> {
  const patterns = new Map<string, string>();

  for (const path of getDisabledToolsPaths()) {
    if (existsSync(path)) {
      const content = await Bun.file(path).text();
      for (const pattern of parseDisabledToolsFile(content)) {
        patterns.set(pattern, path);
      }
      debug(`Loaded ${patterns.size} disabled tool patterns from ${path}`);
    }
  }

  const envPatterns = process.env.MCP_DISABLED_TOOLS;
  if (envPatterns) {
    for (const pattern of envPatterns
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)) {
      patterns.set(pattern, 'MCP_DISABLED_TOOLS');
    }
  }

  return patterns;
}

export function findDisabledMatch(
  toolPath: string,
  patterns: Map<string, string>,
): DisabledToolsMatch | undefined {
  for (const [pattern, source] of patterns) {
    if (globMatch(pattern, toolPath)) {
      return { pattern, source };
    }
  }
  return undefined;
}
