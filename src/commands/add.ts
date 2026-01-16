/**
 * Add command - add Smithery registry server to local config
 */

import { readFile, writeFile } from 'node:fs/promises';
import { ErrorCode, formatCliError } from '../errors.js';
import { formatJson } from '../output.js';
import {
  type SmitheryConnection,
  type SmitheryServerDetail,
  getRegistryServer,
  parseStdioFunction,
} from '../registry.js';

export interface AddOptions {
  serverName: string;
  alias?: string;
  dryRun: boolean;
  json: boolean;
  configPath: string;
  preferLocal: boolean;
}

interface StdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface HttpConfig {
  url: string;
  transport: 'streamable-http';
}

type ServerConfig = StdioConfig | HttpConfig;

interface AddResult {
  name: string;
  config: ServerConfig;
  remote: boolean;
  security?: string;
  configRequired?: string[];
}

function deriveLocalName(qualifiedName: string): string {
  const parts = qualifiedName.split('/');
  let name = parts[parts.length - 1];

  name = name.replace(/^mcp-/, '');
  name = name.replace(/^server-/, '');
  name = name.replace(/-mcp$/, '');
  name = name.replace(/-server$/, '');

  return name;
}

function selectConnection(
  server: SmitheryServerDetail,
  preferLocal: boolean,
): SmitheryConnection | null {
  if (!server.connections || server.connections.length === 0) {
    return null;
  }

  if (preferLocal) {
    for (const conn of server.connections) {
      if (conn.type === 'stdio' && conn.stdioFunction) {
        return conn;
      }
    }
  }

  for (const conn of server.connections) {
    if (conn.type === 'http' && conn.deploymentUrl) {
      return conn;
    }
  }

  for (const conn of server.connections) {
    if (conn.type === 'stdio' && conn.stdioFunction) {
      return conn;
    }
  }

  return server.connections[0];
}

function connectionToConfig(
  _server: SmitheryServerDetail,
  conn: SmitheryConnection,
): ServerConfig | null {
  if (conn.type === 'http' && conn.deploymentUrl) {
    return {
      url: conn.deploymentUrl,
      transport: 'streamable-http',
    };
  }

  if (conn.type === 'stdio' && conn.stdioFunction) {
    const parsed = parseStdioFunction(conn.stdioFunction);
    if (parsed) {
      return {
        command: parsed.command,
        args: parsed.args.length > 0 ? parsed.args : undefined,
      };
    }
  }

  return null;
}

function getRequiredConfigFields(conn: SmitheryConnection): string[] {
  const required: string[] = [];

  if (conn.configSchema?.required) {
    required.push(...conn.configSchema.required);
  }

  return required;
}

function formatTextOutput(result: AddResult, dryRun: boolean): string {
  const lines: string[] = [];
  const action = dryRun ? 'Would add' : 'Added';

  lines.push(`${action} "${result.name}":`);

  if ('url' in result.config) {
    lines.push(`  url: ${result.config.url}`);
    lines.push(`  transport: ${result.config.transport}`);
  } else {
    lines.push(`  command: ${result.config.command}`);
    if (result.config.args && result.config.args.length > 0) {
      lines.push(`  args: ${result.config.args.join(' ')}`);
    }
  }

  lines.push(`  type: ${result.remote ? 'remote' : 'local'}`);

  if (result.security) {
    lines.push(`  security: ${result.security}`);
  }

  if (result.configRequired && result.configRequired.length > 0) {
    lines.push('');
    lines.push('Configuration required:');
    for (const field of result.configRequired) {
      lines.push(`  - ${field}`);
    }
  } else {
    lines.push('');
    lines.push('No configuration required');
  }

  return lines.join('\n');
}

export async function addCommand(options: AddOptions): Promise<void> {
  const server = await getRegistryServer(options.serverName);

  if (!server) {
    console.error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'REGISTRY_SERVER_NOT_FOUND',
        message: `Server "${options.serverName}" not found in registry`,
        suggestion: `Use 'mcpx search <query>' to find available servers`,
      }),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const conn = selectConnection(server, options.preferLocal);

  if (!conn) {
    console.error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'NO_CONNECTIONS',
        message: `Server "${options.serverName}" has no installable connections`,
        suggestion: 'Check the registry for alternative servers',
      }),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const config = connectionToConfig(server, conn);

  if (!config) {
    const rawStdio = conn.stdioFunction
      ? `\nRaw stdioFunction: ${conn.stdioFunction}`
      : '';
    console.error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'INVALID_CONNECTION',
        message: `Could not parse connection for "${options.serverName}"`,
        suggestion: `The server connection format is not supported. Manually add to your config.${rawStdio}`,
      }),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const localName = options.alias || deriveLocalName(options.serverName);
  const configRequired = getRequiredConfigFields(conn);

  let existingConfig: { mcpServers: Record<string, unknown> };

  try {
    const content = await readFile(options.configPath, 'utf-8');
    existingConfig = JSON.parse(content);
  } catch {
    existingConfig = { mcpServers: {} };
  }

  if (existingConfig.mcpServers[localName]) {
    if (options.json) {
      console.log(
        formatJson({
          status: 'exists',
          name: localName,
          message: `Server "${localName}" already exists in config`,
        }),
      );
    } else {
      console.log(`Server "${localName}" already exists in config`);
    }
    return;
  }

  const result: AddResult = {
    name: localName,
    config,
    remote: server.remote,
    security: server.security?.scanPassed ? 'passed' : undefined,
    configRequired: configRequired.length > 0 ? configRequired : undefined,
  };

  if (options.dryRun) {
    if (options.json) {
      console.log(formatJson(result));
    } else {
      console.log(formatTextOutput(result, true));
    }
    return;
  }

  existingConfig.mcpServers[localName] = config;

  try {
    await writeFile(
      options.configPath,
      `${JSON.stringify(existingConfig, null, 2)}\n`,
    );
  } catch (error) {
    console.error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CONFIG_WRITE_ERROR',
        message: `Failed to write config file: ${options.configPath}`,
        details: (error as Error).message,
      }),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  if (options.json) {
    console.log(formatJson(result));
  } else {
    console.log(formatTextOutput(result, false));
  }
}
