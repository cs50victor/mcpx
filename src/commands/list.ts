import {
  type ToolInfo,
  connectToServer,
  debug,
  getConcurrencyLimit,
  listTools,
  safeClose,
} from '../client.js';
import {
  type McpServersConfig,
  findDisabledMatch,
  getServerConfig,
  isToolAllowedByServerConfig,
  listServerNames,
  loadConfig,
  loadDisabledTools,
} from '../config.js';
import { ErrorCode } from '../errors.js';
import { formatJson, formatServerList } from '../output.js';

export interface ListOptions {
  withDescriptions: boolean;
  json: boolean;
  configPath?: string;
}

interface ServerWithTools {
  name: string;
  tools: ToolInfo[];
  error?: string;
  serverConfig?: import('../config.js').ServerConfig;
  instructions?: string;
}

/**
 * Process items with limited concurrency, preserving order
 * Uses a worker pool pattern where each worker grabs the next item from a shared index
 */
async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  maxConcurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await processor(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}

async function fetchServerTools(
  serverName: string,
  config: McpServersConfig,
): Promise<ServerWithTools> {
  try {
    const serverConfig = getServerConfig(config, serverName);
    const { client, close, instructions } = await connectToServer(
      serverName,
      serverConfig,
    );

    try {
      const tools = await listTools(client);
      debug(`${serverName}: loaded ${tools.length} tools`);
      return { name: serverName, tools, serverConfig, instructions };
    } finally {
      await safeClose(close);
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    debug(`${serverName}: connection failed - ${errorMsg}`);
    return {
      name: serverName,
      tools: [],
      error: errorMsg,
    };
  }
}

export async function listCommand(options: ListOptions): Promise<void> {
  let config: McpServersConfig;

  try {
    config = await loadConfig(options.configPath);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const serverNames = listServerNames(config);

  if (serverNames.length === 0) {
    console.error('Warning: No servers configured. Add servers to .mcp.json');
    return;
  }

  const concurrencyLimit = getConcurrencyLimit();
  debug(
    `Processing ${serverNames.length} servers with concurrency ${concurrencyLimit}`,
  );

  const servers = await processWithConcurrency(
    serverNames,
    (name) => fetchServerTools(name, config),
    concurrencyLimit,
  );

  servers.sort((a, b) => a.name.localeCompare(b.name));

  const disabledPatterns = await loadDisabledTools();
  for (const server of servers) {
    server.tools = server.tools.filter((t) => {
      if (!findDisabledMatch(`${server.name}/${t.name}`, disabledPatterns)) {
        if (server.serverConfig) {
          return isToolAllowedByServerConfig(t.name, server.serverConfig);
        }
        return true;
      }
      return false;
    });
  }

  const displayServers = servers.map((s) => ({
    name: s.name,
    tools: s.error
      ? [
          {
            name: `<error: ${s.error}>`,
            description: undefined,
            inputSchema: {},
          },
        ]
      : s.tools,
    instructions: s.instructions,
  }));

  if (options.json) {
    const jsonOutput = servers.map((s) => ({
      name: s.name,
      tools: s.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      error: s.error,
      instructions: s.instructions,
    }));
    console.log(formatJson(jsonOutput));
  } else {
    console.log(formatServerList(displayServers, options.withDescriptions));
  }
}
