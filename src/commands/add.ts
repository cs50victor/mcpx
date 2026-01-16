/**
 * Add command - add registry server to local config
 */

import { readFile, writeFile } from 'node:fs/promises';
import { ErrorCode, formatCliError } from '../errors.js';
import { formatJson } from '../output.js';
import {
  type RegistryPackage,
  type RegistryServer,
  getRegistryServer,
} from '../registry.js';

export interface AddOptions {
  serverName: string;
  alias?: string;
  dryRun: boolean;
  json: boolean;
  configPath: string;
}

interface StdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface AddResult {
  name: string;
  config: StdioConfig;
  envVars?: string[];
}

function deriveLocalName(registryName: string): string {
  const parts = registryName.split('/');
  let name = parts[parts.length - 1];

  name = name.replace(/^mcp-/, '');
  name = name.replace(/^server-/, '');
  name = name.replace(/-mcp$/, '');
  name = name.replace(/-server$/, '');

  return name;
}

function selectPackage(server: RegistryServer): RegistryPackage | null {
  if (!server.packages || server.packages.length === 0) {
    return null;
  }

  for (const pkg of server.packages) {
    if (pkg.transport.type === 'stdio') {
      return pkg;
    }
  }

  return server.packages[0];
}

function packageToConfig(pkg: RegistryPackage): StdioConfig {
  const runtime = pkg.runtimeHint || 'npx';

  if (pkg.registryType === 'npm') {
    return {
      command: runtime,
      args: runtime === 'npx' ? ['-y', pkg.identifier] : [pkg.identifier],
    };
  }

  return {
    command: pkg.identifier,
  };
}

function getRequiredEnvVars(pkg: RegistryPackage): string[] {
  const envVars: string[] = [];

  if (pkg.environmentVariables) {
    for (const env of pkg.environmentVariables) {
      if (env.isRequired) {
        envVars.push(env.name);
      }
    }
  }

  return envVars;
}

function formatTextOutput(result: AddResult, dryRun: boolean): string {
  const lines: string[] = [];
  const action = dryRun ? 'Would add' : 'Added';

  lines.push(`${action} "${result.name}":`);
  lines.push(`  command: ${result.config.command}`);

  if (result.config.args && result.config.args.length > 0) {
    lines.push(`  args: ${result.config.args.join(' ')}`);
  }

  if (result.envVars && result.envVars.length > 0) {
    lines.push('');
    lines.push('Required environment variables:');
    for (const envVar of result.envVars) {
      lines.push(`  export ${envVar}="<value>"`);
    }
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

  const pkg = selectPackage(server);

  if (!pkg) {
    console.error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'NO_PACKAGES',
        message: `Server "${options.serverName}" has no installable packages`,
        suggestion: 'Check the registry for alternative servers',
      }),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const localName = options.alias || deriveLocalName(options.serverName);
  const config = packageToConfig(pkg);
  const envVars = getRequiredEnvVars(pkg);

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
    envVars: envVars.length > 0 ? envVars : undefined,
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
