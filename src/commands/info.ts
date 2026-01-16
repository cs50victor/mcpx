/**
 * Info command - Show server or tool details (local or registry)
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectToServer, listTools, safeClose } from '../client.js';
import {
  type McpServersConfig,
  type ServerConfig,
  findDisabledMatch,
  getServerConfig,
  loadConfig,
  loadDisabledTools,
} from '../config.js';
import {
  ErrorCode,
  formatCliError,
  serverConnectionError,
  toolDisabledError,
  toolNotFoundError,
} from '../errors.js';
import {
  formatJson,
  formatServerDetails,
  formatToolSchema,
} from '../output.js';
import {
  type SmitheryServerDetail,
  getRegistryServer,
  parseStdioFunction,
} from '../registry.js';

export interface InfoOptions {
  target: string;
  json: boolean;
  withDescriptions: boolean;
  configPath?: string;
}

function parseTarget(target: string): { server: string; tool?: string } {
  const parts = target.split('/');
  if (parts.length === 1) {
    return { server: parts[0] };
  }
  return { server: parts[0], tool: parts.slice(1).join('/') };
}

function formatRegistryServerDetails(
  server: SmitheryServerDetail,
  withDescriptions: boolean,
): string {
  const lines: string[] = [];

  lines.push(`${server.qualifiedName} (registry)`);
  lines.push(`  Display: ${server.displayName}`);

  const serverType = server.remote ? 'remote (http)' : 'local (stdio)';
  lines.push(`  Type: ${serverType}`);

  if (server.security) {
    lines.push(
      `  Security: scan ${server.security.scanPassed ? 'passed' : 'failed'}`,
    );
  }

  if (server.connections && server.connections.length > 0) {
    const conn = server.connections[0];
    lines.push('');

    if (conn.type === 'http' && conn.deploymentUrl) {
      lines.push('  Connection:');
      lines.push(`    url: ${conn.deploymentUrl}`);
      lines.push('    transport: streamable-http');
    } else if (conn.type === 'stdio' && conn.stdioFunction) {
      const parsed = parseStdioFunction(conn.stdioFunction);
      if (parsed) {
        lines.push('  Install command:');
        lines.push(`    ${parsed.command} ${parsed.args.join(' ')}`);
      }
    }

    if (conn.configSchema?.properties) {
      lines.push('');
      lines.push('  Configuration:');
      const props = conn.configSchema.properties;
      const required = conn.configSchema.required || [];
      for (const [name, schema] of Object.entries(props)) {
        const req = required.includes(name) ? 'required' : 'optional';
        const type = schema.type || 'any';
        const def =
          schema.default !== undefined
            ? `, default: ${JSON.stringify(schema.default)}`
            : '';
        const desc =
          withDescriptions && schema.description
            ? ` - ${schema.description}`
            : '';
        lines.push(`    ${name} (${type}, ${req}${def})${desc}`);
      }
    }
  }

  if (server.tools && server.tools.length > 0) {
    lines.push('');
    lines.push(`  Tools (${server.tools.length}):`);
    for (const tool of server.tools.slice(0, 10)) {
      if (withDescriptions && tool.description) {
        const desc =
          tool.description.length > 50
            ? `${tool.description.slice(0, 47)}...`
            : tool.description;
        lines.push(`    - ${tool.name}: ${desc}`);
      } else {
        lines.push(`    - ${tool.name}`);
      }
    }
    if (server.tools.length > 10) {
      lines.push(`    ... and ${server.tools.length - 10} more`);
    }
  }

  lines.push('');
  lines.push(`  To add: mcpx add ${server.qualifiedName}`);

  return lines.join('\n');
}

async function showRegistryServer(
  serverName: string,
  options: InfoOptions,
): Promise<boolean> {
  const server = await getRegistryServer(serverName);
  if (!server) {
    return false;
  }

  if (options.json) {
    console.log(
      formatJson({
        name: server.qualifiedName,
        displayName: server.displayName,
        description: server.description,
        type: server.remote ? 'remote' : 'local',
        security: server.security,
        connections: server.connections,
        tools: server.tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      }),
    );
  } else {
    console.log(formatRegistryServerDetails(server, options.withDescriptions));
  }

  return true;
}

export async function infoCommand(options: InfoOptions): Promise<void> {
  let config: McpServersConfig;

  try {
    config = await loadConfig(options.configPath);
  } catch (error) {
    config = { mcpServers: {} };
  }

  const { server: serverName, tool: toolName } = parseTarget(options.target);

  let serverConfig: ServerConfig | null = null;
  try {
    serverConfig = getServerConfig(config, serverName);
  } catch {
    serverConfig = null;
  }

  if (!serverConfig) {
    const found = await showRegistryServer(serverName, options);
    if (found) {
      return;
    }

    console.error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'SERVER_NOT_FOUND',
        message: `Server "${serverName}" not found in local config or registry`,
        suggestion: `Use 'mcpx search <query>' to find available servers`,
      }),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  let client: Client;
  let close: () => Promise<void> = async () => {};

  try {
    const connection = await connectToServer(serverName, serverConfig);
    client = connection.client;
    close = connection.close;
  } catch (error) {
    console.error(
      formatCliError(
        serverConnectionError(serverName, (error as Error).message),
      ),
    );
    process.exit(ErrorCode.NETWORK_ERROR);
  }

  try {
    const disabledPatterns = await loadDisabledTools();

    if (toolName) {
      const disabledMatch = findDisabledMatch(
        `${serverName}/${toolName}`,
        disabledPatterns,
      );
      if (disabledMatch) {
        console.error(
          formatCliError(
            toolDisabledError(
              `${serverName}/${toolName}`,
              disabledMatch.pattern,
              disabledMatch.source,
            ),
          ),
        );
        process.exit(ErrorCode.CLIENT_ERROR);
      }

      const tools = await listTools(client);
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        const availableTools = tools
          .filter(
            (t) =>
              !findDisabledMatch(`${serverName}/${t.name}`, disabledPatterns),
          )
          .map((t) => t.name);
        console.error(
          formatCliError(
            toolNotFoundError(toolName, serverName, availableTools),
          ),
        );
        process.exit(ErrorCode.CLIENT_ERROR);
      }

      if (options.json) {
        console.log(
          formatJson({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }),
        );
      } else {
        console.log(formatToolSchema(serverName, tool));
      }
    } else {
      const tools = await listTools(client);

      const filteredTools = tools.filter(
        (t) => !findDisabledMatch(`${serverName}/${t.name}`, disabledPatterns),
      );

      if (options.json) {
        console.log(
          formatJson({
            name: serverName,
            source: 'local',
            config: serverConfig,
            tools: filteredTools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          }),
        );
      } else {
        console.log(
          formatServerDetails(
            serverName,
            serverConfig,
            filteredTools,
            options.withDescriptions,
          ),
        );
      }
    }
  } finally {
    await safeClose(close);
  }
}
