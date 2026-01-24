import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RegistryServer {
  name: string;
  description: string;
  toolCount: number;
  recommended: {
    command: string;
    args: string[];
  };
  alternatives?: Array<{
    name: string;
    command: string;
    args: string[];
  }>;
  tools: string[];
  envVars?: string[];
  notes?: string;
}

export interface Registry {
  version: number;
  servers: RegistryServer[];
}

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/cs50victor/mcpx/dev/registry/registry.json';

export function getRegistryUrl(): string {
  return process.env.MCPX_REGISTRY_URL || DEFAULT_REGISTRY_URL;
}

export async function fetchRegistry(): Promise<Registry> {
  const url = getRegistryUrl();

  if (url.startsWith('file://') || !url.startsWith('http')) {
    const filePath = url.startsWith('file://')
      ? url.slice(7)
      : url.startsWith('/')
        ? url
        : join(process.cwd(), url);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as Registry;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch registry: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as Registry;
}

export function findServer(
  registry: Registry,
  name: string,
): RegistryServer | undefined {
  return registry.servers.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
}
