/**
 * Tests for config command
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

describe('config command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'mcpx-config-test-')));
    configPath = join(tempDir, 'mcp_servers.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          test: { command: 'echo', args: ['hello'] },
        },
      })
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cliPath = join(import.meta.dir, '..', '..', 'src', 'index.ts');
    const result = await $`bun run ${cliPath} ${args}`.nothrow();
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    };
  }

  test('shows active config path with marker', async () => {
    const result = await runCli(['config', '-c', configPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(configPath);
    expect(result.stdout).toMatch(/>\s/); // > marker for active
  });

  test('shows all search paths', async () => {
    const result = await runCli(['config', '-c', configPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('mcp_servers.json');
    expect(result.stdout).toContain('.mcp_servers.json');
    expect(result.stdout).toContain('.config/mcp/mcp_servers.json');
  });

  test('indicates which paths exist vs not', async () => {
    const result = await runCli(['config', '-c', configPath]);

    expect(result.exitCode).toBe(0);
    // Should have visual distinction: > (active), o (exists), x (not found)
    expect(result.stdout).toMatch(/[>ox]\s/);
  });

  test('outputs JSON with --json flag', async () => {
    const result = await runCli(['config', '-c', configPath, '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.active).toBe(configPath);
    expect(Array.isArray(parsed.searchPaths)).toBe(true);
    expect(parsed.searchPaths.length).toBeGreaterThan(0);
    expect(parsed.searchPaths[0]).toHaveProperty('path');
    expect(parsed.searchPaths[0]).toHaveProperty('exists');
  });

  test('shows MCP_CONFIG_PATH when set', async () => {
    const cliPath = join(import.meta.dir, '..', '..', 'src', 'index.ts');
    const result =
      await $`MCP_CONFIG_PATH=${configPath} bun run ${cliPath} config`.nothrow();

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(configPath);
    expect(result.stdout.toString()).toContain('MCP_CONFIG_PATH');
  });
});
