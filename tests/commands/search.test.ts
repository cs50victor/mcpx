import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

describe('search command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'mcpx-search-test-')));
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

  describe('basic search', () => {
    test('searches Smithery registry for github', async () => {
      const result = await runCli(['search', 'github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Registry');
      expect(result.stdout).toContain('github');
      expect(result.stdout).toContain('sorted by stars');
    });

    test('shows star counts in output', async () => {
      const result = await runCli(['search', 'github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\(\d+(\.\d+)?k? stars\)/);
    });

    test('shows official badge for verified servers', async () => {
      const result = await runCli(['search', 'github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\[official\]/);
    });

    test('shows remote/local type tag', async () => {
      const result = await runCli(['search', 'github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\[remote\]|\[local\]/);
    });
  });

  describe('--local flag', () => {
    test('only searches local servers (no Registry section)', async () => {
      const result = await runCli(['search', 'filesystem', '--local']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('Registry');
    });
  });

  describe('--verified flag', () => {
    test('filters to verified servers only', async () => {
      const result = await runCli(['search', 'github', '--verified']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Registry');
    });
  });

  describe('--limit flag', () => {
    test('limits number of results', async () => {
      const result = await runCli(['search', 'mcp', '--limit', '5']);

      expect(result.exitCode).toBe(0);
      const lines = result.stdout.split('\n').filter(l => l.startsWith('  '));
      expect(lines.length).toBeLessThanOrEqual(5);
    });
  });

  describe('--json flag', () => {
    test('outputs JSON format', async () => {
      const result = await runCli(['search', 'github', '-j']);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('local');
      expect(parsed).toHaveProperty('registry');
      expect(Array.isArray(parsed.local)).toBe(true);
      expect(Array.isArray(parsed.registry)).toBe(true);
    });

    test('JSON output includes Smithery server details', async () => {
      const result = await runCli(['search', 'github', '-j']);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.registry.length).toBeGreaterThan(0);
      const server = parsed.registry[0];
      expect(server).toHaveProperty('name');
      expect(server).toHaveProperty('description');
      expect(server).toHaveProperty('githubStars');
      expect(server).toHaveProperty('verified');
      expect(server).toHaveProperty('remote');
    });
  });

  describe('-d flag (with descriptions)', () => {
    test('shows descriptions in text output', async () => {
      const result = await runCli(['search', 'github', '-d']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Registry');
      expect(result.stdout).toContain(' - ');
    });
  });

  describe('argument validation', () => {
    test('requires query argument', async () => {
      const result = await runCli(['search']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Missing required argument');
    });
  });
});
