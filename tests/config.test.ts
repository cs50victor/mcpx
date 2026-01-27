/**
 * Unit tests for config module
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  getServerConfig,
  listServerNames,
  isHttpServer,
  isStdioServer,
  loadDisabledTools,
  findDisabledMatch,
  isToolAllowedByServerConfig,
  computeConfigHash,
} from '../src/config';

describe('config', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcpx-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    test('returns empty config when allowEmpty true and no config found', async () => {
      const originalCwd = process.cwd();
      const emptyDir = await mkdtemp(join(tmpdir(), 'mcpx-empty-'));
      process.chdir(emptyDir);
      try {
        const config = await loadConfig(undefined, { allowEmpty: true });
        expect(config.mcpServers).toEqual({});
        expect(config._configSource).toBe('<none>');
      } finally {
        process.chdir(originalCwd);
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    test('still throws on explicit path not found even with allowEmpty', async () => {
      await expect(
        loadConfig('/nonexistent/path.json', { allowEmpty: true })
      ).rejects.toThrow('not found');
    });

    test('loads valid config from explicit path', async () => {
      const configPath = join(tempDir, 'mcp_servers.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: { command: 'echo', args: ['hello'] },
          },
        })
      );

      const config = await loadConfig(configPath);
      expect(config.mcpServers.test).toBeDefined();
      expect((config.mcpServers.test as any).command).toBe('echo');
    });

    test('throws on missing config file', async () => {
      const configPath = join(tempDir, 'nonexistent.json');
      await expect(loadConfig(configPath)).rejects.toThrow('not found');
    });

    test('throws on invalid JSON', async () => {
      const configPath = join(tempDir, 'invalid.json');
      await writeFile(configPath, 'not valid json');

      await expect(loadConfig(configPath)).rejects.toThrow('Invalid JSON');
    });

    test('treats non-mcpServers top-level keys as flat format servers', async () => {
      const configPath = join(tempDir, 'flat_config.json');
      await writeFile(configPath, JSON.stringify({ servers: {} }));

      await expect(loadConfig(configPath)).rejects.toThrow('missing required field');
    });

    test('substitutes environment variables', async () => {
      process.env.TEST_MCP_TOKEN = 'secret123';

      const configPath = join(tempDir, 'env_config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: {
              url: 'https://example.com',
              headers: { Authorization: 'Bearer ${TEST_MCP_TOKEN}' },
            },
          },
        })
      );

      const config = await loadConfig(configPath);
      const server = config.mcpServers.test as any;
      expect(server.headers.Authorization).toBe('Bearer secret123');

      delete process.env.TEST_MCP_TOKEN;
    });

    test('handles missing env vars gracefully with MCP_STRICT_ENV=false', async () => {
      // Set non-strict mode to allow missing env vars with warning
      process.env.MCP_STRICT_ENV = 'false';

      const configPath = join(tempDir, 'missing_env.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: {
              command: 'echo',
              env: { TOKEN: '${NONEXISTENT_VAR}' },
            },
          },
        })
      );

      const config = await loadConfig(configPath);
      const server = config.mcpServers.test as any;
      expect(server.env.TOKEN).toBe('');

      delete process.env.MCP_STRICT_ENV;
    });

    test('throws error on missing env vars in strict mode (default)', async () => {
      // Ensure strict mode is enabled (default)
      delete process.env.MCP_STRICT_ENV;

      const configPath = join(tempDir, 'missing_env_strict.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: {
              command: 'echo',
              env: { TOKEN: '${ANOTHER_NONEXISTENT_VAR}' },
            },
          },
        })
      );

      await expect(loadConfig(configPath)).rejects.toThrow('MISSING_ENV_VAR');
    });

    test('throws error on empty server config', async () => {
      const configPath = join(tempDir, 'empty_server.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            badserver: {},
          },
        })
      );

      await expect(loadConfig(configPath)).rejects.toThrow('missing required field');
    });

    test('throws error on server with both command and url', async () => {
      const configPath = join(tempDir, 'both_types.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            mixed: {
              command: 'echo',
              url: 'https://example.com',
            },
          },
        })
      );

      await expect(loadConfig(configPath)).rejects.toThrow('both "command" and "url"');
    });

    test('throws error on null server config', async () => {
      const configPath = join(tempDir, 'null_server.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            nullserver: null,
          },
        })
      );

      await expect(loadConfig(configPath)).rejects.toThrow('Invalid server configuration');
    });
  });

  describe('getServerConfig', () => {
    test('returns server config by name', async () => {
      const configPath = join(tempDir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            server1: { command: 'cmd1' },
            server2: { command: 'cmd2' },
          },
        })
      );

      const config = await loadConfig(configPath);
      const server = await getServerConfig(config, 'server1');
      expect((server as any).command).toBe('cmd1');
    });

    test('throws on unknown server not in registry', async () => {
      const configPath = join(tempDir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: { known: { command: 'cmd' } },
        })
      );

      const config = await loadConfig(configPath);
      await expect(getServerConfig(config, 'totally-unknown-xyz')).rejects.toThrow('not found');
    });

    test('falls back to registry when server not in local config', async () => {
      const configPath = join(tempDir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: { local: { command: 'cmd' } },
        })
      );

      const config = await loadConfig(configPath);
      const server = await getServerConfig(config, 'filesystem');
      expect((server as any).command).toBe('bunx');
      expect((server as any).args).toContain('@modelcontextprotocol/server-filesystem');
    });
  });

  describe('listServerNames', () => {
    test('returns all server names', async () => {
      const configPath = join(tempDir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            alpha: { command: 'a' },
            beta: { command: 'b' },
            gamma: { url: 'https://example.com' },
          },
        })
      );

      const config = await loadConfig(configPath);
      const names = listServerNames(config);
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
      expect(names).toContain('gamma');
      expect(names.length).toBe(3);
    });
  });

  describe('type guards', () => {
    test('isHttpServer identifies HTTP config', () => {
      expect(isHttpServer({ url: 'https://example.com' })).toBe(true);
      expect(isHttpServer({ command: 'echo' })).toBe(false);
    });

    test('isStdioServer identifies stdio config', () => {
      expect(isStdioServer({ command: 'echo' })).toBe(true);
      expect(isStdioServer({ url: 'https://example.com' })).toBe(false);
    });
  });

  describe('disabled tools', () => {
    test('findDisabledMatch matches exact patterns', () => {
      const patterns = new Map([['server/tool', 'test']]);
      expect(findDisabledMatch('server/tool', patterns)).toEqual({
        pattern: 'server/tool',
        source: 'test',
      });
      expect(findDisabledMatch('server/other', patterns)).toBeUndefined();
    });

    test('findDisabledMatch supports glob wildcards', () => {
      const patterns = new Map([
        ['server/*', 'test1'],
        ['*/dangerous', 'test2'],
      ]);
      expect(findDisabledMatch('server/anything', patterns)?.pattern).toBe('server/*');
      expect(findDisabledMatch('other/dangerous', patterns)?.pattern).toBe('*/dangerous');
      expect(findDisabledMatch('other/safe', patterns)).toBeUndefined();
    });

    test('loadDisabledTools reads from environment variable', async () => {
      process.env.MCP_DISABLED_TOOLS = 'server/tool1,server/tool2';
      const patterns = await loadDisabledTools();
      expect(patterns.get('server/tool1')).toBe('MCP_DISABLED_TOOLS');
      expect(patterns.get('server/tool2')).toBe('MCP_DISABLED_TOOLS');
      delete process.env.MCP_DISABLED_TOOLS;
    });

    test('loadDisabledTools returns empty map when no config', async () => {
      delete process.env.MCP_DISABLED_TOOLS;
      const patterns = await loadDisabledTools();
      expect(patterns.size).toBe(0);
    });
  });

  describe('inline config', () => {
    test('loadConfig parses inline JSON when value starts with {', async () => {
      const inlineConfig = '{"mcpServers":{"test":{"command":"echo"}}}';
      const config = await loadConfig(inlineConfig);
      expect(config.mcpServers.test).toBeDefined();
      expect((config.mcpServers.test as any).command).toBe('echo');
    });

    test('loadConfig parses inline JSON with whitespace prefix', async () => {
      const inlineConfig = '  {"mcpServers":{"test":{"url":"http://localhost"}}}';
      const config = await loadConfig(inlineConfig);
      expect((config.mcpServers.test as any).url).toBe('http://localhost');
    });

    test('loadConfig throws on invalid inline JSON', async () => {
      const badJson = '{mcpServers: invalid}';
      await expect(loadConfig(badJson)).rejects.toThrow('Invalid JSON');
    });

    test('loadConfig inline JSON treats unknown keys as flat format servers', async () => {
      const noServers = '{"servers":{}}';
      await expect(loadConfig(noServers)).rejects.toThrow('missing required field');
    });

    test('loadConfig validates inline server configs', async () => {
      const badServer = '{"mcpServers":{"test":{}}}';
      await expect(loadConfig(badServer)).rejects.toThrow('missing required field');
    });
  });

  describe('flat config format (Claude Code / Amp Code style)', () => {
    test('loadConfig parses flat format without mcpServers wrapper', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          test: { command: 'echo', args: ['hello'] },
          http: { url: 'https://example.com' },
        })
      );

      const config = await loadConfig(configPath);
      expect(config.mcpServers.test).toBeDefined();
      expect((config.mcpServers.test as any).command).toBe('echo');
      expect((config.mcpServers.http as any).url).toBe('https://example.com');
    });

    test('loadConfig parses wrapped format with mcpServers key', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: { command: 'echo' },
          },
        })
      );

      const config = await loadConfig(configPath);
      expect(config.mcpServers.test).toBeDefined();
      expect((config.mcpServers.test as any).command).toBe('echo');
    });

    test('loadConfig inline flat format works', async () => {
      const inlineConfig = '{"test":{"command":"echo"},"other":{"url":"http://localhost"}}';
      const config = await loadConfig(inlineConfig);
      expect(config.mcpServers.test).toBeDefined();
      expect(config.mcpServers.other).toBeDefined();
    });

    test('flat format validates server configs', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          badserver: {},
        })
      );

      await expect(loadConfig(configPath)).rejects.toThrow('missing required field');
    });

    test('flat format with both command and url throws error', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mixed: { command: 'echo', url: 'https://example.com' },
        })
      );

      await expect(loadConfig(configPath)).rejects.toThrow('both "command" and "url"');
    });
  });

  describe('config file search order', () => {
    test('prefers .mcp.json over mcp.json in same directory', async () => {
      const mcpJsonPath = join(tempDir, '.mcp.json');
      const altPath = join(tempDir, 'mcp.json');

      await writeFile(mcpJsonPath, JSON.stringify({ primary: { command: 'echo' } }));
      await writeFile(altPath, JSON.stringify({ secondary: { command: 'echo' } }));

      const originalCwd = process.cwd();
      process.chdir(tempDir);
      try {
        const config = await loadConfig();
        expect(config.mcpServers.primary).toBeDefined();
        expect(config.mcpServers.secondary).toBeUndefined();
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('legacy filename rejection', () => {
    test('throws error when mcp_servers.json found with rename suggestion', async () => {
      const legacyPath = join(tempDir, 'mcp_servers.json');
      await writeFile(
        legacyPath,
        JSON.stringify({ mcpServers: { test: { command: 'echo' } } })
      );

      const originalCwd = process.cwd();
      process.chdir(tempDir);
      try {
        await expect(loadConfig()).rejects.toThrow('no longer supported');
      } finally {
        process.chdir(originalCwd);
      }
    });

    test('legacy filename error includes rename command', async () => {
      const legacyPath = join(tempDir, 'mcp_servers.json');
      await writeFile(legacyPath, JSON.stringify({ mcpServers: { test: { command: 'echo' } } }));

      const originalCwd = process.cwd();
      process.chdir(tempDir);
      try {
        await expect(loadConfig()).rejects.toThrow('mv mcp_servers.json .mcp.json');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('empty config warning', () => {
    test('warns but does not error on empty servers in flat format', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(configPath, '{}');

      const config = await loadConfig(configPath);
      expect(Object.keys(config.mcpServers).length).toBe(0);
    });
  });

  describe('per-server tool filtering', () => {
    test('parses includeTools array', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          test: {
            command: 'echo',
            includeTools: ['read_*', 'list_*'],
          },
        })
      );

      const config = await loadConfig(configPath);
      const server = config.mcpServers.test as any;
      expect(server.includeTools).toEqual(['read_*', 'list_*']);
    });

    test('parses allowedTools array (alias for includeTools)', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          test: {
            command: 'echo',
            allowedTools: ['read_*'],
          },
        })
      );

      const config = await loadConfig(configPath);
      const server = config.mcpServers.test as any;
      expect(server.allowedTools).toEqual(['read_*']);
    });

    test('parses disabledTools array', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          test: {
            command: 'echo',
            disabledTools: ['delete_*', 'write_*'],
          },
        })
      );

      const config = await loadConfig(configPath);
      const server = config.mcpServers.test as any;
      expect(server.disabledTools).toEqual(['delete_*', 'write_*']);
    });

    test('throws error when both includeTools and allowedTools are present', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          test: {
            command: 'echo',
            includeTools: ['read_*'],
            allowedTools: ['write_*'],
          },
        })
      );

      await expect(loadConfig(configPath)).rejects.toThrow(
        'both "includeTools" and "allowedTools"'
      );
    });

    test('allows includeTools with disabledTools together', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          test: {
            command: 'echo',
            includeTools: ['*'],
            disabledTools: ['delete_*'],
          },
        })
      );

      const config = await loadConfig(configPath);
      const server = config.mcpServers.test as any;
      expect(server.includeTools).toEqual(['*']);
      expect(server.disabledTools).toEqual(['delete_*']);
    });
  });

  describe('isToolAllowedByServerConfig', () => {
    test('allows all tools when no filters specified', () => {
      const serverConfig = { command: 'echo' };
      expect(isToolAllowedByServerConfig('any_tool', serverConfig)).toBe(true);
    });

    test('filters by includeTools patterns', () => {
      const serverConfig = { command: 'echo', includeTools: ['read_*', 'list_*'] };
      expect(isToolAllowedByServerConfig('read_file', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('list_dir', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('write_file', serverConfig)).toBe(false);
      expect(isToolAllowedByServerConfig('delete_file', serverConfig)).toBe(false);
    });

    test('filters by allowedTools patterns (alias)', () => {
      const serverConfig = { command: 'echo', allowedTools: ['read_*'] };
      expect(isToolAllowedByServerConfig('read_file', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('write_file', serverConfig)).toBe(false);
    });

    test('filters by disabledTools patterns', () => {
      const serverConfig = { command: 'echo', disabledTools: ['delete_*', 'write_*'] };
      expect(isToolAllowedByServerConfig('read_file', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('delete_file', serverConfig)).toBe(false);
      expect(isToolAllowedByServerConfig('write_file', serverConfig)).toBe(false);
    });

    test('disabledTools takes precedence over includeTools', () => {
      const serverConfig = {
        command: 'echo',
        includeTools: ['*'],
        disabledTools: ['dangerous_*'],
      };
      expect(isToolAllowedByServerConfig('safe_tool', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('dangerous_delete', serverConfig)).toBe(false);
    });

    test('wildcard * matches any tool', () => {
      const serverConfig = { command: 'echo', includeTools: ['*'] };
      expect(isToolAllowedByServerConfig('anything', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('read_file', serverConfig)).toBe(true);
    });
  });

  describe('computeConfigHash', () => {
    test('returns consistent hash for same config', () => {
      const config = { command: 'echo', args: ['test'] };
      const hash1 = computeConfigHash(config);
      const hash2 = computeConfigHash(config);
      expect(hash1).toBe(hash2);
    });

    test('returns different hash for different config', () => {
      const config1 = { command: 'echo', args: ['test'] };
      const config2 = { command: 'echo', args: ['other'] };
      const hash1 = computeConfigHash(config1);
      const hash2 = computeConfigHash(config2);
      expect(hash1).not.toBe(hash2);
    });

    test('hash is order-independent for object keys', () => {
      const config1 = { command: 'echo', args: ['test'] };
      const config2 = { args: ['test'], command: 'echo' };
      const hash1 = computeConfigHash(config1);
      const hash2 = computeConfigHash(config2);
      expect(hash1).toBe(hash2);
    });

    test('returns string hash', () => {
      const config = { command: 'echo' };
      const hash = computeConfigHash(config);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });
  });
});
