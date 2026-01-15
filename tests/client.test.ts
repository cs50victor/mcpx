/**
 * Unit tests for MCP client module
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  type HttpServerConfig,
  type StdioServerConfig,
  isHttpServer,
  isStdioServer,
  getMaxRetries,
  getRetryDelayMs,
  getTimeoutMs,
  getConcurrencyLimit,
} from '../src/config';

describe('client', () => {
  describe('server config type guards', () => {
    test('identifies HTTP server configs', () => {
      const httpConfig: HttpServerConfig = {
        url: 'https://mcp.example.com',
        headers: { Authorization: 'Bearer token' },
      };

      expect(isHttpServer(httpConfig)).toBe(true);
      expect(isStdioServer(httpConfig)).toBe(false);
    });

    test('identifies stdio server configs', () => {
      const stdioConfig: StdioServerConfig = {
        command: 'node',
        args: ['./server.js'],
        env: { DEBUG: 'true' },
      };

      expect(isStdioServer(stdioConfig)).toBe(true);
      expect(isHttpServer(stdioConfig)).toBe(false);
    });

    test('handles minimal HTTP config', () => {
      const minimalHttp: HttpServerConfig = {
        url: 'https://example.com',
      };

      expect(isHttpServer(minimalHttp)).toBe(true);
    });

    test('handles minimal stdio config', () => {
      const minimalStdio: StdioServerConfig = {
        command: 'echo',
      };

      expect(isStdioServer(minimalStdio)).toBe(true);
    });
  });

  describe('getTimeoutMs', () => {
    const originalEnv = process.env.MCP_TIMEOUT;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.MCP_TIMEOUT = originalEnv;
      } else {
        delete process.env.MCP_TIMEOUT;
      }
    });

    test('returns default of 1800000ms (30 minutes)', () => {
      delete process.env.MCP_TIMEOUT;
      expect(getTimeoutMs()).toBe(1800000);
    });

    test('respects MCP_TIMEOUT env var', () => {
      process.env.MCP_TIMEOUT = '60';
      expect(getTimeoutMs()).toBe(60000);
    });

    test('ignores invalid values', () => {
      process.env.MCP_TIMEOUT = 'invalid';
      expect(getTimeoutMs()).toBe(1800000);
    });

    test('ignores negative values', () => {
      process.env.MCP_TIMEOUT = '-5';
      expect(getTimeoutMs()).toBe(1800000);
    });

    test('ignores zero', () => {
      process.env.MCP_TIMEOUT = '0';
      expect(getTimeoutMs()).toBe(1800000);
    });
  });

  describe('getConcurrencyLimit', () => {
    const originalEnv = process.env.MCP_CONCURRENCY;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.MCP_CONCURRENCY = originalEnv;
      } else {
        delete process.env.MCP_CONCURRENCY;
      }
    });

    test('returns default of 5', () => {
      delete process.env.MCP_CONCURRENCY;
      expect(getConcurrencyLimit()).toBe(5);
    });

    test('respects MCP_CONCURRENCY env var', () => {
      process.env.MCP_CONCURRENCY = '10';
      expect(getConcurrencyLimit()).toBe(10);
    });

    test('ignores negative values', () => {
      process.env.MCP_CONCURRENCY = '-3';
      expect(getConcurrencyLimit()).toBe(5);
    });

    test('ignores zero', () => {
      process.env.MCP_CONCURRENCY = '0';
      expect(getConcurrencyLimit()).toBe(5);
    });

    test('ignores invalid values', () => {
      process.env.MCP_CONCURRENCY = 'many';
      expect(getConcurrencyLimit()).toBe(5);
    });
  });

  describe('getMaxRetries', () => {
    const originalEnv = process.env.MCP_MAX_RETRIES;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.MCP_MAX_RETRIES = originalEnv;
      } else {
        delete process.env.MCP_MAX_RETRIES;
      }
    });

    test('returns default of 3', () => {
      delete process.env.MCP_MAX_RETRIES;
      expect(getMaxRetries()).toBe(3);
    });

    test('respects MCP_MAX_RETRIES env var', () => {
      process.env.MCP_MAX_RETRIES = '5';
      expect(getMaxRetries()).toBe(5);
    });

    test('allows zero (disable retries)', () => {
      process.env.MCP_MAX_RETRIES = '0';
      expect(getMaxRetries()).toBe(0);
    });

    test('ignores negative values', () => {
      process.env.MCP_MAX_RETRIES = '-1';
      expect(getMaxRetries()).toBe(3);
    });
  });

  describe('getRetryDelayMs', () => {
    const originalEnv = process.env.MCP_RETRY_DELAY;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.MCP_RETRY_DELAY = originalEnv;
      } else {
        delete process.env.MCP_RETRY_DELAY;
      }
    });

    test('returns default of 1000ms', () => {
      delete process.env.MCP_RETRY_DELAY;
      expect(getRetryDelayMs()).toBe(1000);
    });

    test('respects MCP_RETRY_DELAY env var', () => {
      process.env.MCP_RETRY_DELAY = '2000';
      expect(getRetryDelayMs()).toBe(2000);
    });

    test('ignores zero', () => {
      process.env.MCP_RETRY_DELAY = '0';
      expect(getRetryDelayMs()).toBe(1000);
    });

    test('ignores negative values', () => {
      process.env.MCP_RETRY_DELAY = '-500';
      expect(getRetryDelayMs()).toBe(1000);
    });
  });

  // Note: Actually testing connectToServer requires a real MCP server
  // Those tests are in the integration test suite
});
