/**
 * Tests for info command - show local or registry server details
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

describe('info command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'mcpx-info-test-')));
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

  describe('registry lookup', () => {
    test('shows registry server when not in local config', async () => {
      const result = await runCli(['github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('github');
      expect(result.stdout).toContain('(registry)');
    });

    test('shows server type for registry servers', async () => {
      const result = await runCli(['github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Type:/);
    });

    test('shows tools list for registry servers', async () => {
      const result = await runCli(['github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Tools');
    });

    test('shows add command hint', async () => {
      const result = await runCli(['github']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('To add: mcpx add github');
    });
  });

  describe('JSON output for registry', () => {
    test('outputs JSON format for registry servers', async () => {
      const result = await runCli(['github', '-j']);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('name');
      expect(parsed).toHaveProperty('displayName');
      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('tools');
      expect(Array.isArray(parsed.tools)).toBe(true);
    });

    test('JSON includes connection info', async () => {
      const result = await runCli(['github', '-j']);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('connections');
      expect(Array.isArray(parsed.connections)).toBe(true);
    });
  });

  describe('error handling', () => {
    test('fails for non-existent server in both local and registry', async () => {
      const result = await runCli(['nonexistent-server-12345-xyz-abc']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });
  });

  describe('with descriptions', () => {
    test('shows tool descriptions with -d flag', async () => {
      const result = await runCli(['github', '-d']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Tools');
    });
  });
});
