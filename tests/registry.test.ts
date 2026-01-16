/**
 * Tests for registry module - Smithery registry API
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  type SmitheryServer,
  type SmitheryServerDetail,
  formatStarCount,
  getRegistryServer,
  getRegistryUrl,
  parseStdioFunction,
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
    test('returns default Smithery URL when env not set', () => {
      delete process.env.MCP_REGISTRY_URL;
      const url = getRegistryUrl();
      expect(url).toBe('https://registry.smithery.ai');
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
    test('returns array of SmitheryServer objects', async () => {
      const results = await searchRegistry('github');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      const server = results[0];
      expect(server).toHaveProperty('qualifiedName');
      expect(server).toHaveProperty('displayName');
      expect(server).toHaveProperty('description');
      expect(server).toHaveProperty('verified');
      expect(server).toHaveProperty('githubStars');
      expect(typeof server.githubStars).toBe('number');
    });

    test('returns array even for obscure queries', async () => {
      const results = await searchRegistry('xyznonexistent12345zzz');
      expect(Array.isArray(results)).toBe(true);
    });

    test('respects limit option', async () => {
      const results = await searchRegistry('mcp', { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('throws on network error with invalid URL', async () => {
      process.env.MCP_REGISTRY_URL = 'https://invalid.nonexistent.domain.xyz';
      await expect(searchRegistry('test')).rejects.toThrow();
    });
  });

  describe('getRegistryServer', () => {
    test('returns server details for valid name', async () => {
      const server = await getRegistryServer('github');
      expect(server).not.toBeNull();
      expect(server!.qualifiedName).toBe('github');
      expect(server).toHaveProperty('displayName');
      expect(server).toHaveProperty('connections');
      expect(Array.isArray(server!.connections)).toBe(true);
    });

    test('returns null for non-existent server', async () => {
      const server = await getRegistryServer(
        'nonexistent-server-12345-xyz-abc',
      );
      expect(server).toBeNull();
    });

    test('includes tools in server details', async () => {
      const server = await getRegistryServer('github');
      expect(server).not.toBeNull();
      expect(server).toHaveProperty('tools');
      expect(Array.isArray(server!.tools)).toBe(true);
    });
  });

  describe('parseStdioFunction', () => {
    test('parses npx command', () => {
      const fn = "config => ({command: 'npx', args: ['-y', '@pkg/name']})";
      const result = parseStdioFunction(fn);
      expect(result).not.toBeNull();
      expect(result!.command).toBe('npx');
      expect(result!.args).toEqual(['-y', '@pkg/name']);
    });

    test('parses node command', () => {
      const fn = "config => ({command: 'node', args: ['./dist/index.js']})";
      const result = parseStdioFunction(fn);
      expect(result).not.toBeNull();
      expect(result!.command).toBe('node');
      expect(result!.args).toEqual(['./dist/index.js']);
    });

    test('returns null for invalid format', () => {
      const fn = 'invalid function';
      const result = parseStdioFunction(fn);
      expect(result).toBeNull();
    });

    test('handles double quotes', () => {
      const fn = 'config => ({command: "uvx", args: ["mcp-server"]})';
      const result = parseStdioFunction(fn);
      expect(result).not.toBeNull();
      expect(result!.command).toBe('uvx');
      expect(result!.args).toEqual(['mcp-server']);
    });
  });

  describe('formatStarCount', () => {
    test('formats small numbers as-is', () => {
      expect(formatStarCount(0)).toBe('0');
      expect(formatStarCount(100)).toBe('100');
      expect(formatStarCount(999)).toBe('999');
    });

    test('formats thousands with k suffix', () => {
      expect(formatStarCount(1000)).toBe('1k');
      expect(formatStarCount(1500)).toBe('1.5k');
      expect(formatStarCount(9881)).toBe('9.9k');
      expect(formatStarCount(26878)).toBe('26.9k');
    });
  });

  describe('SmitheryServer type', () => {
    test('has expected properties', () => {
      const server: SmitheryServer = {
        qualifiedName: 'github',
        displayName: 'GitHub',
        description: 'GitHub API access',
        verified: true,
        githubStars: 5828,
        remote: true,
        homepage: 'https://github.com/example/mcp-github',
      };

      expect(server.qualifiedName).toBe('github');
      expect(server.verified).toBe(true);
      expect(server.githubStars).toBe(5828);
      expect(server.remote).toBe(true);
    });
  });

  describe('SmitheryServerDetail type', () => {
    test('has connections and tools', () => {
      const server: SmitheryServerDetail = {
        qualifiedName: '@flrngel/mcp-painter',
        displayName: 'Drawing Tool',
        description: 'Drawing tool for AI',
        remote: false,
        connections: [
          {
            type: 'stdio',
            stdioFunction: "config => ({command: 'npx', args: ['-y', '@flrngel/mcp-painter']})",
          },
        ],
        security: { scanPassed: true },
        tools: [
          { name: 'create_canvas', description: 'Create a new canvas' },
        ],
      };

      expect(server.connections).toHaveLength(1);
      expect(server.connections[0].type).toBe('stdio');
      expect(server.tools).toHaveLength(1);
      expect(server.security?.scanPassed).toBe(true);
    });
  });
});
