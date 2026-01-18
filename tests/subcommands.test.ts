import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { $ } from 'bun';

const CLI_PATH = join(import.meta.dir, '..', 'src', 'index.ts');

describe('subcommand sync', () => {
  describe('valid subcommands are recognized', () => {
    test('config', async () => {
      const result = await $`bun run ${CLI_PATH} config`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
    });

    test('daemon', async () => {
      const result = await $`bun run ${CLI_PATH} daemon`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
      expect(result.stderr.toString()).toContain('start|stop|status');
    });

    test('grep', async () => {
      const result = await $`bun run ${CLI_PATH} grep`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
      expect(result.stderr.toString()).toContain('pattern');
    });
  });

  describe('typos trigger fuzzy matching', () => {
    test('deamon -> daemon', async () => {
      const result = await $`bun run ${CLI_PATH} deamon status`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Did you mean 'daemon'");
    });

    test('confg -> config', async () => {
      const result = await $`bun run ${CLI_PATH} confg`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Did you mean 'config'");
    });

    test('grp -> grep', async () => {
      const result = await $`bun run ${CLI_PATH} grp pattern`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Did you mean 'grep'");
    });

    test('daemn -> daemon', async () => {
      const result = await $`bun run ${CLI_PATH} daemn`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Did you mean 'daemon'");
    });
  });

  describe('non-typos fall through to server lookup', () => {
    test('xyz (distance > 2)', async () => {
      const result = await $`bun run ${CLI_PATH} xyz`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
      expect(result.stderr.toString()).toContain('not found');
    });

    test('playwright treated as server name', async () => {
      const result = await $`bun run ${CLI_PATH} playwright`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
    });
  });
});
