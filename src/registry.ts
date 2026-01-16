/**
 * Remote MCP server registry API client
 *
 * API: https://registry.modelcontextprotocol.io/docs
 */

const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io';

export interface RegistryTransport {
  type: 'stdio' | 'sse' | 'streamable-http';
  url?: string;
}

export interface RegistryPackageArgument {
  name: string;
  description?: string;
  isRequired?: boolean;
  format?: string;
  type?: string;
}

export interface RegistryPackage {
  registryType: string;
  identifier: string;
  version: string;
  transport: RegistryTransport;
  runtimeHint?: string;
  packageArguments?: RegistryPackageArgument[];
  environmentVariables?: RegistryPackageArgument[];
}

export interface RegistryServer {
  name: string;
  description: string;
  version?: string;
  repository?: { url: string; source?: string; subfolder?: string };
  packages: RegistryPackage[];
}

interface ServerWrapper {
  server: RegistryServer;
  _meta?: Record<string, unknown>;
}

interface SearchResponse {
  servers: ServerWrapper[];
  metadata?: { nextCursor?: string; count?: number };
}

export function getRegistryUrl(): string {
  const url = process.env.MCP_REGISTRY_URL || DEFAULT_REGISTRY_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export async function searchRegistry(query: string): Promise<RegistryServer[]> {
  const baseUrl = getRegistryUrl();
  const url = `${baseUrl}/v0/servers?search=${encodeURIComponent(query)}&version=latest&limit=100`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Registry request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as SearchResponse;
  return (data.servers || []).map((w) => w.server);
}

export async function getRegistryServer(
  name: string,
): Promise<RegistryServer | null> {
  const baseUrl = getRegistryUrl();
  const encodedName = encodeURIComponent(name);
  const url = `${baseUrl}/v0/servers/${encodedName}/versions/latest`;

  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Registry request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as ServerWrapper;
  return data.server;
}
