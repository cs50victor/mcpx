import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import {
  getRegistryUrl,
  fetchRegistry,
  findServer,
  type Registry,
  type RegistryServer,
} from '../src/registry';

const LOCAL_REGISTRY_PATH = join(
  import.meta.dir,
  '../registry/registry.json',
);

describe('registry', () => {
  const originalEnv = process.env.MCPX_REGISTRY_URL;

  beforeEach(() => {
    process.env.MCPX_REGISTRY_URL = LOCAL_REGISTRY_PATH;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MCPX_REGISTRY_URL;
    } else {
      process.env.MCPX_REGISTRY_URL = originalEnv;
    }
  });

  describe('getRegistryUrl', () => {
    test('should_return_default_url_when_no_env_var', () => {
      delete process.env.MCPX_REGISTRY_URL;
      const url = getRegistryUrl();
      expect(url).toContain('github');
      expect(url).toContain('registry.json');
    });

    test('should_return_env_var_url_when_set', () => {
      process.env.MCPX_REGISTRY_URL = 'http://localhost:8000/custom.json';
      const url = getRegistryUrl();
      expect(url).toBe('http://localhost:8000/custom.json');
    });
  });

  describe('fetchRegistry', () => {
    test('should_return_registry_with_servers', async () => {
      const registry = await fetchRegistry();
      expect(registry.version).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(registry.servers)).toBe(true);
      expect(registry.servers.length).toBeGreaterThan(0);
    });

    test('should_have_valid_server_structure', async () => {
      const registry = await fetchRegistry();
      const server = registry.servers[0];
      expect(typeof server.name).toBe('string');
      expect(typeof server.description).toBe('string');
      expect(typeof server.toolCount).toBe('number');
      expect(server.recommended).toBeDefined();
      expect(Array.isArray(server.tools)).toBe(true);
    });

    test('should_find_filesystem_server', async () => {
      const registry = await fetchRegistry();
      const fs = registry.servers.find((s) => s.name === 'filesystem');
      expect(fs).toBeDefined();
      expect(fs!.description).toContain('file');
      expect(fs!.tools).toContain('read_file');
    });
  });

  describe('RegistryServer type', () => {
    test('should_have_optional_envVars_and_notes', async () => {
      const registry = await fetchRegistry();
      const braveSearch = registry.servers.find(
        (s) => s.name === 'brave-search',
      );
      expect(braveSearch).toBeDefined();
      expect(braveSearch!.envVars).toBeDefined();
      expect(braveSearch!.envVars).toContain('BRAVE_API_KEY');
      expect(braveSearch!.notes).toBeDefined();
    });
  });

  describe('findServer', () => {
    test('should_find_server_by_exact_name', async () => {
      const registry = await fetchRegistry();
      const server = findServer(registry, 'filesystem');
      expect(server).toBeDefined();
      expect(server!.name).toBe('filesystem');
    });

    test('should_find_server_case_insensitively', async () => {
      const registry = await fetchRegistry();
      const server = findServer(registry, 'FILESYSTEM');
      expect(server).toBeDefined();
      expect(server!.name).toBe('filesystem');
    });

    test('should_return_undefined_for_unknown_server', async () => {
      const registry = await fetchRegistry();
      const server = findServer(registry, 'nonexistent');
      expect(server).toBeUndefined();
    });
  });
});
