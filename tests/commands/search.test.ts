// NOTE(victor): Tests use --registry flag to avoid slow local server connections. Local search tested via unit tests.

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
    test('searches registry for postgres', async () => {
      const result = await runCli(['search', 'postgres', '--registry']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Registry:');
      expect(result.stdout).toContain('postgres');
    });

    test('searches registry for filesystem', async () => {
      const result = await runCli(['search', 'filesystem', '--registry']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Registry:');
      expect(result.stdout).toContain('filesystem');
    });

    test('handles no matches gracefully', async () => {
      const result = await runCli(['search', 'xyznonexistent12345zzz', '--registry']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No results found');
    });
  });

  describe('--local flag', () => {
    test('only searches local servers (no Registry section)', async () => {
      const result = await runCli(['search', 'filesystem', '--local']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('Registry:');
    });
  });

  describe('--registry flag', () => {
    test('only searches registry (no Local section)', async () => {
      const result = await runCli(['search', 'filesystem', '--registry']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('Local:');
      expect(result.stdout).toContain('Registry:');
    });
  });

  describe('--json flag', () => {
    test('outputs JSON format', async () => {
      const result = await runCli(['search', 'filesystem', '-j', '--registry']);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('local');
      expect(parsed).toHaveProperty('registry');
      expect(Array.isArray(parsed.local)).toBe(true);
      expect(Array.isArray(parsed.registry)).toBe(true);
    });

    test('JSON output includes server details', async () => {
      const result = await runCli(['search', 'filesystem', '-j', '--registry']);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.registry.length).toBeGreaterThan(0);
      const server = parsed.registry[0];
      expect(server).toHaveProperty('name');
      expect(server).toHaveProperty('description');
      expect(server).toHaveProperty('transport');
    });
  });

  describe('-d flag (with descriptions)', () => {
    test('shows descriptions in text output', async () => {
      const result = await runCli(['search', 'filesystem', '-d', '--registry']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Registry:');
      // Descriptions appear after " - "
      expect(result.stdout).toContain(' - ');
    });
  });

  describe('output format', () => {
    test('shows transport type for registry servers', async () => {
      const result = await runCli(['search', 'filesystem', '--registry']);

      expect(result.exitCode).toBe(0);
      // Transport should be shown in brackets
      expect(result.stdout).toMatch(/\[stdio\]|\[sse\]|\[streamable-http\]|\[unknown\]/);
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
