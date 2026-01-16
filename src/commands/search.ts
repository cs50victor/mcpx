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
import {
  type SmitheryServer,
  formatStarCount,
  searchRegistry,
} from '../registry.js';

export interface SearchOptions {
  query: string;
  localOnly: boolean;
  verified: boolean;
  limit: number;
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
  displayName: string;
  description: string;
  githubStars: number;
  verified: boolean;
  remote: boolean;
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

async function searchRegistryServers(
  query: string,
  options: { verified?: boolean; limit?: number },
): Promise<RegistryResult[]> {
  try {
    const servers = await searchRegistry(query, options);
    return servers.map((server: SmitheryServer) => ({
      name: server.qualifiedName,
      displayName: server.displayName,
      description: server.description,
      githubStars: server.githubStars,
      verified: server.verified,
      remote: server.remote,
    }));
  } catch (error) {
    debug(`Registry search failed: ${(error as Error).message}`);
    return [];
  }
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
    const starsStr = formatStarCount(result.githubStars);
    const verifiedBadge = result.verified ? ' [official]' : '';
    const typeTag = result.remote ? '[remote]' : '[local]';

    let entry = `  ${result.name} (${starsStr} stars)${verifiedBadge} ${typeTag}`;
    if (withDescriptions && result.description) {
      const desc =
        result.description.length > 60
          ? `${result.description.slice(0, 57)}...`
          : result.description;
      entry += ` - ${desc}`;
    }
    lines.push(entry);
  }

  return lines.join('\n');
}

export async function searchCommand(options: SearchOptions): Promise<void> {
  const results: SearchResults = {
    local: [],
    registry: [],
  };

  const searches: Promise<void>[] = [];

  if (options.localOnly) {
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
  } else {
    searches.push(
      (async () => {
        results.registry = await searchRegistryServers(options.query, {
          verified: options.verified,
          limit: options.limit,
        });
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

  if (hasLocal) {
    output.push('Local:');
    output.push(formatLocalResults(results.local, options.withDescriptions));
  }

  if (hasRegistry) {
    const sortedText = 'sorted by stars';
    output.push(
      `Registry (${results.registry.length} results, ${sortedText}):`,
    );
    output.push(
      formatRegistryResults(results.registry, options.withDescriptions),
    );
  }

  console.log(output.join('\n'));
}
