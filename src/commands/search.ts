/**
 * Search command - unified local + registry search
 */

import {
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
  listServerNames,
  loadConfig,
  loadDisabledTools,
} from '../config.js';
import { globToRegex } from '../glob.js';
import { formatJson } from '../output.js';
import { type RegistryServer, searchRegistry } from '../registry.js';

export interface SearchOptions {
  query: string;
  localOnly: boolean;
  registryOnly: boolean;
  withDescriptions: boolean;
  json: boolean;
  configPath?: string;
}

interface LocalResult {
  server: string;
  tool: string;
  description?: string;
}

interface RegistryResult {
  name: string;
  description: string;
  transport: string;
}

interface SearchResults {
  local: LocalResult[];
  registry: RegistryResult[];
}

async function searchLocalTools(
  config: McpServersConfig,
  pattern: RegExp,
): Promise<LocalResult[]> {
  const serverNames = listServerNames(config);
  const results: LocalResult[] = [];
  const concurrencyLimit = getConcurrencyLimit();

  const processServer = async (serverName: string): Promise<LocalResult[]> => {
    try {
      const serverConfig = getServerConfig(config, serverName);
      const { client, close } = await connectToServer(serverName, serverConfig);

      try {
        const tools = await listTools(client);
        const serverResults: LocalResult[] = [];

        for (const tool of tools) {
          const fullPath = `${serverName}/${tool.name}`;
          const matchesName = pattern.test(tool.name);
          const matchesPath = pattern.test(fullPath);
          const matchesDescription =
            tool.description && pattern.test(tool.description);

          if (matchesName || matchesPath || matchesDescription) {
            serverResults.push({
              server: serverName,
              tool: tool.name,
              description: tool.description,
            });
          }
        }

        return serverResults;
      } finally {
        await safeClose(close);
      }
    } catch (error) {
      debug(`${serverName}: connection failed - ${(error as Error).message}`);
      return [];
    }
  };

  let currentIndex = 0;
  const allResults: LocalResult[][] = new Array(serverNames.length);

  async function worker(): Promise<void> {
    while (currentIndex < serverNames.length) {
      const index = currentIndex++;
      allResults[index] = await processServer(serverNames[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrencyLimit, serverNames.length) },
    () => worker(),
  );

  await Promise.all(workers);

  for (const serverResults of allResults) {
    if (serverResults) {
      results.push(...serverResults);
    }
  }

  return results;
}

async function searchRegistryServers(query: string): Promise<RegistryResult[]> {
  try {
    const servers = await searchRegistry(query);
    return servers.map((server) => ({
      name: server.name,
      description: server.description,
      transport: getPreferredTransport(server),
    }));
  } catch (error) {
    debug(`Registry search failed: ${(error as Error).message}`);
    return [];
  }
}

function getPreferredTransport(server: RegistryServer): string {
  if (!server.packages || server.packages.length === 0) {
    return 'unknown';
  }

  for (const pkg of server.packages) {
    if (pkg.transport.type === 'stdio') {
      return 'stdio';
    }
  }

  return server.packages[0].transport.type;
}

function formatLocalResults(
  results: LocalResult[],
  withDescriptions: boolean,
): string {
  const lines: string[] = [];

  for (const result of results) {
    const path = `${result.server}/${result.tool}`;
    if (withDescriptions && result.description) {
      lines.push(`  ${path} - ${result.description}`);
    } else {
      lines.push(`  ${path}`);
    }
  }

  return lines.join('\n');
}

function formatRegistryResults(
  results: RegistryResult[],
  withDescriptions: boolean,
): string {
  const lines: string[] = [];

  for (const result of results) {
    const entry = `  ${result.name} [${result.transport}]`;
    if (withDescriptions && result.description) {
      lines.push(`${entry} - ${result.description}`);
    } else {
      lines.push(entry);
    }
  }

  return lines.join('\n');
}

export async function searchCommand(options: SearchOptions): Promise<void> {
  const results: SearchResults = {
    local: [],
    registry: [],
  };

  const searches: Promise<void>[] = [];

  if (!options.registryOnly) {
    searches.push(
      (async () => {
        try {
          const config = await loadConfig(options.configPath);
          const pattern = globToRegex(options.query);
          const localResults = await searchLocalTools(config, pattern);

          const disabledPatterns = await loadDisabledTools();
          results.local = localResults.filter(
            (r) =>
              !findDisabledMatch(`${r.server}/${r.tool}`, disabledPatterns),
          );
        } catch (error) {
          debug(`Local search failed: ${(error as Error).message}`);
        }
      })(),
    );
  }

  if (!options.localOnly) {
    searches.push(
      (async () => {
        results.registry = await searchRegistryServers(options.query);
      })(),
    );
  }

  await Promise.all(searches);

  if (options.json) {
    console.log(formatJson(results));
    return;
  }

  const hasLocal = results.local.length > 0;
  const hasRegistry = results.registry.length > 0;

  if (!hasLocal && !hasRegistry) {
    console.log(`No results found for "${options.query}"`);
    return;
  }

  const output: string[] = [];

  if (!options.registryOnly && hasLocal) {
    output.push('Local:');
    output.push(formatLocalResults(results.local, options.withDescriptions));
  }

  if (!options.localOnly && hasRegistry) {
    if (output.length > 0) {
      output.push('');
    }
    output.push('Registry:');
    output.push(
      formatRegistryResults(results.registry, options.withDescriptions),
    );
  }

  console.log(output.join('\n'));
}
