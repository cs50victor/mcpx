/**
 * Tests for add command - add Smithery registry servers to local config
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

describe('add command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'mcpx-add-test-')));
    configPath = join(tempDir, 'mcp_servers.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {},
      }),
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cliPath = join(import.meta.dir, '..', '..', 'src', 'index.ts');
    const result = await $`bun run ${cliPath} -c ${configPath} ${args}`.nothrow();
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    };
  }

  async function readConfig(): Promise<Record<string, unknown>> {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  }

  describe('--dry-run flag', () => {
    test('shows what would be added without modifying config', async () => {
      const result = await runCli(['add', 'github', '--dry-run']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Would add');

      const config = await readConfig();
      expect(Object.keys(config.mcpServers as object)).toHaveLength(0);
    });

    test('dry-run shows server type', async () => {
      const result = await runCli(['add', 'github', '--dry-run']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/type:/);
    });

    test('dry-run shows HTTP config for remote servers', async () => {
      const result = await runCli(['add', 'github', '--dry-run']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('url:');
      expect(result.stdout).toContain('transport: streamable-http');
    });
  });

  describe('--as flag (custom alias)', () => {
    test('uses custom alias instead of derived name', async () => {
      const result = await runCli(['add', 'github', '--as', 'gh', '--dry-run']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"gh"');
    });
  });

  describe('basic add', () => {
    test('adds server to config', async () => {
      const result = await runCli(['add', 'github']);

      expect(result.exitCode).toBe(0);

      const config = await readConfig();
      const servers = config.mcpServers as Record<string, unknown>;
      expect(Object.keys(servers).length).toBeGreaterThan(0);
    });

    test('adds HTTP config for remote server', async () => {
      const result = await runCli(['add', 'github']);

      expect(result.exitCode).toBe(0);

      const config = await readConfig();
      const servers = config.mcpServers as Record<string, Record<string, unknown>>;
      const serverConfig = Object.values(servers)[0];
      expect(serverConfig).toHaveProperty('url');
      expect(serverConfig.transport).toBe('streamable-http');
    });
  });

  describe('idempotency', () => {
    test('skips if server already exists', async () => {
      await runCli(['add', 'github']);

      const result = await runCli(['add', 'github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('already exists');
    });
  });

  describe('error handling', () => {
    test('fails for non-existent server', async () => {
      const result = await runCli([
        'add',
        'nonexistent-server-12345-xyz-abc',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    test('requires server name argument', async () => {
      const result = await runCli(['add']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Missing required argument');
    });
  });

  describe('JSON output', () => {
    test('outputs config in JSON format with dry-run', async () => {
      const result = await runCli(['add', 'github', '-j', '--dry-run']);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('name');
      expect(parsed).toHaveProperty('config');
      expect(typeof parsed.remote).toBe('boolean');
    });

    test('JSON output includes HTTP config for remote servers', async () => {
      const result = await runCli(['add', 'github', '-j', '--dry-run']);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.config).toHaveProperty('url');
      expect(parsed.config.transport).toBe('streamable-http');
    });
  });
});
