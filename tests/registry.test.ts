/**
 * Tests for registry module - remote MCP server registry API
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  type RegistryPackage,
  type RegistryServer,
  getRegistryServer,
  getRegistryUrl,
  searchRegistry,
} from '../src/registry.js';

describe('registry', () => {
  const originalEnv = process.env.MCP_REGISTRY_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MCP_REGISTRY_URL;
    } else {
      process.env.MCP_REGISTRY_URL = originalEnv;
    }
  });

  describe('getRegistryUrl', () => {
    test('returns default URL when env not set', () => {
      delete process.env.MCP_REGISTRY_URL;
      const url = getRegistryUrl();
      expect(url).toBe('https://registry.modelcontextprotocol.io');
    });

    test('returns custom URL from env var', () => {
      process.env.MCP_REGISTRY_URL = 'https://custom.registry.io';
      const url = getRegistryUrl();
      expect(url).toBe('https://custom.registry.io');
    });

    test('strips trailing slash from custom URL', () => {
      process.env.MCP_REGISTRY_URL = 'https://custom.registry.io/';
      const url = getRegistryUrl();
      expect(url).toBe('https://custom.registry.io');
    });
  });

  describe('searchRegistry', () => {
    test('returns array of RegistryServer objects', async () => {
      const results = await searchRegistry('filesystem');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      const server = results[0];
      expect(server).toHaveProperty('name');
      expect(server).toHaveProperty('description');
      expect(server).toHaveProperty('packages');
      expect(Array.isArray(server.packages)).toBe(true);
    });

    test('returns empty array for no matches', async () => {
      const results = await searchRegistry('xyznonexistent12345zzz');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    test('throws on network error with invalid URL', async () => {
      process.env.MCP_REGISTRY_URL = 'https://invalid.nonexistent.domain.xyz';
      await expect(searchRegistry('test')).rejects.toThrow();
    });
  });

  describe('getRegistryServer', () => {
    test('returns server details for valid name', async () => {
      const server = await getRegistryServer(
        'io.github.bytedance/mcp-server-filesystem',
      );
      expect(server).not.toBeNull();
      expect(server!.name).toBe('io.github.bytedance/mcp-server-filesystem');
      expect(server).toHaveProperty('description');
      expect(server).toHaveProperty('packages');
    });

    test('returns null for non-existent server', async () => {
      const server = await getRegistryServer(
        'nonexistent.vendor/nonexistent-server-12345',
      );
      expect(server).toBeNull();
    });
  });

  describe('RegistryServer type', () => {
    test('has expected properties', () => {
      const server: RegistryServer = {
        name: 'io.github.vendor/server-test',
        description: 'Test server',
        repository: { url: 'https://github.com/vendor/server-test' },
        packages: [
          {
            registryType: 'npm',
            identifier: '@vendor/server-test',
            version: '1.0.0',
            transport: { type: 'stdio' },
          },
        ],
      };

      expect(server.name).toBe('io.github.vendor/server-test');
      expect(server.packages[0].transport.type).toBe('stdio');
    });
  });

  describe('RegistryPackage type', () => {
    test('supports stdio transport', () => {
      const pkg: RegistryPackage = {
        registryType: 'npm',
        identifier: '@modelcontextprotocol/server-filesystem',
        version: '1.0.0',
        transport: { type: 'stdio' },
      };

      expect(pkg.transport.type).toBe('stdio');
    });

    test('supports sse transport', () => {
      const pkg: RegistryPackage = {
        registryType: 'npm',
        identifier: '@vendor/http-server',
        version: '2.0.0',
        transport: { type: 'sse', url: 'http://localhost:3000/sse' },
      };

      expect(pkg.transport.type).toBe('sse');
      expect(pkg.transport.url).toBe('http://localhost:3000/sse');
    });

    test('supports package arguments', () => {
      const pkg: RegistryPackage = {
        registryType: 'npm',
        identifier: '@vendor/server',
        version: '1.0.0',
        transport: { type: 'stdio' },
        packageArguments: [
          { name: '--port', description: 'Server port', isRequired: false },
        ],
        environmentVariables: [
          { name: 'API_KEY', description: 'API key', isRequired: true },
        ],
      };

      expect(pkg.packageArguments).toHaveLength(1);
      expect(pkg.environmentVariables).toHaveLength(1);
    });
  });
});
