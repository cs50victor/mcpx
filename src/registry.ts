/**
 * Smithery registry API client
 *
 * API: https://registry.smithery.ai
 */

const DEFAULT_REGISTRY_URL = 'https://registry.smithery.ai';

export interface SmitheryServer {
  qualifiedName: string;
  displayName: string;
  description: string;
  verified: boolean;
  githubStars: number;
  remote: boolean;
  homepage: string;
}

export interface SmitheryTool {
  name: string;
  description?: string;
}

export interface SmitheryConnection {
  type: 'stdio' | 'http';
  stdioFunction?: string;
  deploymentUrl?: string;
  configSchema?: JSONSchema;
}

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  default?: unknown;
}

export interface SmitheryServerDetail {
  qualifiedName: string;
  displayName: string;
  description: string;
  remote: boolean;
  connections: SmitheryConnection[];
  security: { scanPassed: boolean } | null;
  tools: SmitheryTool[];
}

// Raw API response may have useCount (Smithery) or githubStars (our registry)
interface RawServer {
  qualifiedName: string;
  displayName: string;
  description: string;
  verified: boolean;
  useCount?: number;
  githubStars?: number;
  remote: boolean;
  homepage: string;
}

interface SearchResponse {
  servers: RawServer[];
  pagination?: { total: number };
}

export function getRegistryUrl(): string {
  const url = process.env.MCP_REGISTRY_URL || DEFAULT_REGISTRY_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export interface SearchOptions {
  verified?: boolean;
  limit?: number;
}

export async function searchRegistry(
  query: string,
  options: SearchOptions = {},
): Promise<SmitheryServer[]> {
  const baseUrl = getRegistryUrl();
  const params = new URLSearchParams({
    q: query,
    pageSize: String(options.limit ?? 20),
  });
  if (options.verified) {
    params.set('verified', 'true');
  }

  const url = `${baseUrl}/servers?${params}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Registry request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as SearchResponse;
  // Normalize useCount (Smithery) to githubStars (our registry)
  return (data.servers || []).map((server) => ({
    ...server,
    githubStars: server.githubStars ?? server.useCount ?? 0,
  }));
}

export async function getRegistryServer(
  qualifiedName: string,
): Promise<SmitheryServerDetail | null> {
  const baseUrl = getRegistryUrl();
  const url = `${baseUrl}/servers/${encodeURIComponent(qualifiedName)}`;

  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Registry request failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as SmitheryServerDetail;
}

export interface ParsedStdioConfig {
  command: string;
  args: string[];
}

export function parseStdioFunction(fn: string): ParsedStdioConfig | null {
  try {
    const commandMatch = fn.match(/command:\s*['"`]([^'"`]+)['"`]/);
    if (!commandMatch) return null;

    const command = commandMatch[1];
    const args: string[] = [];

    const argsMatch = fn.match(/args:\s*\[([^\]]*)\]/);
    if (argsMatch) {
      const argMatches = argsMatch[1].matchAll(/['"`]([^'"`]*)['"`]/g);
      for (const m of argMatches) {
        args.push(m[1]);
      }
    }

    return { command, args };
  } catch {
    return null;
  }
}

export function formatStarCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(count);
}
