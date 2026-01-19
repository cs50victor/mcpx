/**
 * Persistent connection daemon for MCP servers
 *
 * Keeps server processes alive across CLI invocations, enabling stateful
 * workflows without reconnection overhead. Servers must be explicitly
 * started in daemon mode - regular `mcpx server/tool` calls are ephemeral.
 *
 * Usage:
 *   mcpx daemon start                  # Start daemon + all servers from config
 *   mcpx daemon start <server...>      # Start daemon + specific server(s)
 *   mcpx daemon stop                   # Stop daemon entirely
 *   mcpx daemon stop <server>          # Stop specific server, keep daemon running
 *   mcpx daemon status                 # Show daemon status and active servers
 *
 * Architecture:
 *   CLI invocation -> Unix socket -> Daemon -> MCP Server Pool
 *
 * @env MCP_DAEMON_SOCKET - Socket path (default: ~/.mcp-cli/daemon.sock)
 * @env MCP_DAEMON_IDLE_MS - Idle timeout in ms (default: 300000 = 5 min)
 */

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type ConnectedClient, connectToServer, safeClose } from './client.js';
import {
  type McpServersConfig,
  type ServerConfig,
  debug,
  isHttpServer,
} from './config.js';

const DEFAULT_SOCKET_PATH = join(homedir(), '.mcp-cli', 'daemon.sock');
const DEFAULT_IDLE_MS = 300000; // 5 minutes

function getSocketPath(): string {
  return process.env.MCP_DAEMON_SOCKET || DEFAULT_SOCKET_PATH;
}

function getIdleTimeoutMs(): number {
  const env = process.env.MCP_DAEMON_IDLE_MS;
  if (env) {
    const ms = Number.parseInt(env, 10);
    if (!Number.isNaN(ms) && ms > 0) return ms;
  }
  return DEFAULT_IDLE_MS;
}

/**
 * Get transport type for display (stdio or http)
 */
function getTransportType(config: ServerConfig): 'stdio' | 'http' {
  return isHttpServer(config) ? 'http' : 'stdio';
}

interface PoolEntry {
  connection: ConnectedClient;
  config: ServerConfig;
  configSource: string;
  lastUsed: number;
  startedAt: number;
}

interface ServerInfo {
  name: string;
  transport: 'stdio' | 'http';
  configSource: string;
  idleSeconds: number;
}

class ConnectionPool {
  private pool = new Map<string, PoolEntry>();
  private idleTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private idleTimeoutMs: number) {
    this.startIdleCheck();
  }

  async acquire(
    serverName: string,
    config: ServerConfig,
    configSource: string,
  ): Promise<{ connection: ConnectedClient; alreadyConnected: boolean }> {
    const existing = this.pool.get(serverName);
    if (existing) {
      existing.lastUsed = Date.now();
      debug(`daemon: reusing connection for ${serverName}`);
      return { connection: existing.connection, alreadyConnected: true };
    }

    debug(`daemon: creating new connection for ${serverName}`);
    const connection = await connectToServer(serverName, config);
    this.pool.set(serverName, {
      connection,
      config,
      configSource,
      lastUsed: Date.now(),
      startedAt: Date.now(),
    });
    return { connection, alreadyConnected: false };
  }

  has(serverName: string): boolean {
    return this.pool.has(serverName);
  }

  async release(serverName: string): Promise<boolean> {
    const entry = this.pool.get(serverName);
    if (entry) {
      debug(`daemon: releasing connection for ${serverName}`);
      await safeClose(entry.connection.close);
      this.pool.delete(serverName);
      return true;
    }
    return false;
  }

  async releaseAll(): Promise<string[]> {
    const names = [...this.pool.keys()];
    debug(`daemon: releasing all connections (${this.pool.size} active)`);
    const closes = [...this.pool.entries()].map(async ([name, entry]) => {
      debug(`daemon: closing ${name}`);
      await safeClose(entry.connection.close);
    });
    await Promise.all(closes);
    this.pool.clear();
    this.stopIdleCheck();
    return names;
  }

  list(): string[] {
    return [...this.pool.keys()];
  }

  listDetailed(): ServerInfo[] {
    const now = Date.now();
    return [...this.pool.entries()].map(([name, entry]) => ({
      name,
      transport: getTransportType(entry.config),
      configSource: entry.configSource,
      idleSeconds: Math.floor((now - entry.lastUsed) / 1000),
    }));
  }

  size(): number {
    return this.pool.size;
  }

  private startIdleCheck(): void {
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [name, entry] of this.pool.entries()) {
        if (now - entry.lastUsed > this.idleTimeoutMs) {
          debug(`daemon: idle timeout for ${name}`);
          this.release(name);
        }
      }
    }, 60000); // Check every minute
  }

  private stopIdleCheck(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}

interface DaemonRequest {
  method:
    | 'call'
    | 'connect'
    | 'disconnect'
    | 'list'
    | 'list-detailed'
    | 'has'
    | 'shutdown';
  params?: {
    server?: string;
    config?: ServerConfig;
    configSource?: string;
    tool?: string;
    args?: Record<string, unknown>;
  };
}

interface DaemonResponse {
  ok?: boolean;
  result?: unknown;
  servers?: string[];
  serversDetailed?: ServerInfo[];
  has?: boolean;
  alreadyConnected?: boolean;
  error?: string;
}

/**
 * Start daemon and optionally connect servers
 *
 * @param config - MCP servers configuration (required if serverNames provided)
 * @param serverNames - Specific servers to start (empty = all from config)
 */
export async function startDaemon(
  config?: McpServersConfig,
  serverNames?: string[],
): Promise<void> {
  // If we're the spawned daemon process, run the server
  if (process.env._MCPX_DAEMON === '1') {
    return runDaemonServer();
  }

  const socketPath = getSocketPath();
  const daemonWasRunning = await isDaemonRunning();

  // Start daemon process if not running
  if (!daemonWasRunning) {
    // Clean up stale socket if exists
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }

    // Spawn detached daemon process
    const proc = Bun.spawn(['bun', 'run', process.argv[1], 'daemon', 'start'], {
      env: { ...process.env, _MCPX_DAEMON: '1' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    proc.unref();

    // Wait for socket to appear
    await Bun.sleep(300);
    if (!(await isDaemonRunning())) {
      console.error('Failed to start daemon process');
      console.error(`  Socket path: ${socketPath}`);
      console.error(
        '  Suggestion: Check if another process is using the socket, or try: mcpx daemon stop',
      );
      process.exit(1);
    }

    console.log(`Daemon started (pid ${proc.pid})`);
    console.log(`  Socket: ${socketPath}`);
  }

  // If no config provided, we're done (just started the daemon process)
  if (!config) {
    if (daemonWasRunning) {
      console.log('Daemon is already running');
      console.log(`  Socket: ${socketPath}`);
      console.log('  Hint: Use "mcpx daemon status" to see active servers');
    }
    return;
  }

  // Determine which servers to start
  const configSource = config._configSource || 'inline';
  const allServerNames = Object.keys(config.mcpServers);
  const toStart =
    serverNames && serverNames.length > 0 ? serverNames : allServerNames;

  // Validate server names exist in config
  const invalid = toStart.filter((name) => !config.mcpServers[name]);
  if (invalid.length > 0) {
    console.error(
      `Error: Server(s) not found in config: ${invalid.join(', ')}`,
    );
    console.error(`  Available servers: ${allServerNames.join(', ')}`);
    console.error(`  Config: ${configSource}`);
    process.exit(1);
  }

  // Connect servers
  const started: string[] = [];
  const alreadyRunning: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const name of toStart) {
    try {
      const serverConfig = config.mcpServers[name];
      const { alreadyConnected } = await connectServerToDaemon(
        name,
        serverConfig,
        configSource,
      );
      if (alreadyConnected) {
        alreadyRunning.push(name);
      } else {
        started.push(name);
      }
    } catch (err) {
      failed.push({
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Output results
  if (
    !daemonWasRunning &&
    started.length === 0 &&
    alreadyRunning.length === 0 &&
    failed.length === 0
  ) {
    // Just started daemon with no servers
    return;
  }

  console.log(`Config: ${configSource}`);

  if (started.length > 0) {
    console.log('Started:');
    for (const name of started) {
      const transport = getTransportType(config.mcpServers[name]);
      console.log(`  + ${name} (${transport})`);
    }
  }

  if (alreadyRunning.length > 0) {
    console.log('Already running:');
    for (const name of alreadyRunning) {
      console.log(`  = ${name}`);
    }
  }

  if (failed.length > 0) {
    console.log('Failed:');
    for (const { name, error } of failed) {
      console.log(`  x ${name}: ${error}`);
    }
  }

  // Helpful hints
  if (started.length > 0) {
    console.log('');
    console.log(
      'Hint: Tool calls to these servers now use persistent connections.',
    );
    console.log(`  Example: mcpx ${started[0]}/<tool> '{...}'`);
  }
}

async function runDaemonServer(): Promise<void> {
  const socketPath = getSocketPath();
  const idleMs = getIdleTimeoutMs();

  const socketDir = dirname(socketPath);
  if (!existsSync(socketDir)) {
    mkdirSync(socketDir, { recursive: true });
  }

  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const pool = new ConnectionPool(idleMs);

  const server = Bun.serve({
    unix: socketPath,
    async fetch(req): Promise<Response> {
      let request: DaemonRequest;
      try {
        request = (await req.json()) as DaemonRequest;
      } catch {
        return Response.json({ error: 'invalid JSON' } as DaemonResponse, {
          status: 400,
        });
      }

      try {
        switch (request.method) {
          case 'connect': {
            const {
              server: serverName,
              config,
              configSource,
            } = request.params ?? {};
            if (!serverName || !config) {
              return Response.json(
                { error: 'missing server or config' } as DaemonResponse,
                { status: 400 },
              );
            }
            const { alreadyConnected } = await pool.acquire(
              serverName,
              config,
              configSource || 'unknown',
            );
            return Response.json({
              ok: true,
              alreadyConnected,
            } as DaemonResponse);
          }

          case 'call': {
            const {
              server: serverName,
              config,
              configSource,
              tool,
              args,
            } = request.params ?? {};
            if (!serverName || !config || !tool) {
              return Response.json(
                { error: 'missing server, config, or tool' } as DaemonResponse,
                { status: 400 },
              );
            }
            const { connection } = await pool.acquire(
              serverName,
              config,
              configSource || 'unknown',
            );
            const result = await connection.client.callTool({
              name: tool,
              arguments: args ?? {},
            });
            return Response.json({ result } as DaemonResponse);
          }

          case 'disconnect': {
            const { server: serverName } = request.params ?? {};
            if (!serverName) {
              return Response.json(
                { error: 'missing server' } as DaemonResponse,
                { status: 400 },
              );
            }
            const released = await pool.release(serverName);
            return Response.json({ ok: released } as DaemonResponse);
          }

          case 'has': {
            const { server: serverName } = request.params ?? {};
            if (!serverName) {
              return Response.json(
                { error: 'missing server' } as DaemonResponse,
                { status: 400 },
              );
            }
            return Response.json({
              has: pool.has(serverName),
            } as DaemonResponse);
          }

          case 'list': {
            return Response.json({ servers: pool.list() } as DaemonResponse);
          }

          case 'list-detailed': {
            return Response.json({
              serversDetailed: pool.listDetailed(),
            } as DaemonResponse);
          }

          case 'shutdown': {
            const disconnected = await pool.releaseAll();
            // Schedule shutdown after response
            setTimeout(() => {
              server.stop();
              process.exit(0);
            }, 100);
            return Response.json({
              ok: true,
              servers: disconnected,
            } as DaemonResponse);
          }

          default:
            return Response.json(
              { error: `unknown method: ${request.method}` } as DaemonResponse,
              { status: 400 },
            );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message } as DaemonResponse, {
          status: 500,
        });
      }
    },
  });

  const shutdown = async () => {
    debug('daemon: shutting down');
    await pool.releaseAll();
    server.stop();
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Minimal output for background process (logged to nowhere usually)
  debug('mcp-cli daemon started');
  debug(`  Socket: ${socketPath}`);
  debug(`  Idle timeout: ${idleMs}ms`);
  debug(`  PID: ${process.pid}`);
}

export async function isDaemonRunning(): Promise<boolean> {
  const socketPath = getSocketPath();
  if (!existsSync(socketPath)) {
    return false;
  }

  try {
    const res = await fetch('http://localhost/', {
      unix: socketPath,
      method: 'POST',
      body: JSON.stringify({ method: 'list' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check if a specific server is connected in the daemon
 */
export async function isServerInDaemon(serverName: string): Promise<boolean> {
  const socketPath = getSocketPath();
  if (!existsSync(socketPath)) {
    return false;
  }

  try {
    const res = await fetch('http://localhost/', {
      unix: socketPath,
      method: 'POST',
      body: JSON.stringify({ method: 'has', params: { server: serverName } }),
    });
    if (!res.ok) return false;
    const response = (await res.json()) as DaemonResponse;
    return response.has === true;
  } catch {
    return false;
  }
}

/**
 * Connect a server to the daemon (daemon must be running)
 */
export async function connectServerToDaemon(
  serverName: string,
  config: ServerConfig,
  configSource: string,
): Promise<{ alreadyConnected: boolean }> {
  const socketPath = getSocketPath();
  const request: DaemonRequest = {
    method: 'connect',
    params: {
      server: serverName,
      config,
      configSource,
    },
  };

  const res = await fetch('http://localhost/', {
    unix: socketPath,
    method: 'POST',
    body: JSON.stringify(request),
  });

  const response = (await res.json()) as DaemonResponse;

  if (response.error) {
    throw new Error(response.error);
  }

  return { alreadyConnected: response.alreadyConnected === true };
}

/**
 * Disconnect a specific server from the daemon
 */
export async function disconnectServerFromDaemon(
  serverName: string,
): Promise<boolean> {
  const socketPath = getSocketPath();
  const request: DaemonRequest = {
    method: 'disconnect',
    params: { server: serverName },
  };

  const res = await fetch('http://localhost/', {
    unix: socketPath,
    method: 'POST',
    body: JSON.stringify(request),
  });

  const response = (await res.json()) as DaemonResponse;
  return response.ok === true;
}

export async function callViaDaemon(
  serverName: string,
  config: ServerConfig,
  configSource: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const socketPath = getSocketPath();
  const request: DaemonRequest = {
    method: 'call',
    params: {
      server: serverName,
      config,
      configSource,
      tool: toolName,
      args,
    },
  };

  const res = await fetch('http://localhost/', {
    unix: socketPath,
    method: 'POST',
    body: JSON.stringify(request),
  });

  const response = (await res.json()) as DaemonResponse;

  if (response.error) {
    throw new Error(response.error);
  }

  return response.result;
}

export async function listDaemonServers(): Promise<string[]> {
  const socketPath = getSocketPath();
  const res = await fetch('http://localhost/', {
    unix: socketPath,
    method: 'POST',
    body: JSON.stringify({ method: 'list' }),
  });
  const response = (await res.json()) as DaemonResponse;
  return response.servers ?? [];
}

export async function listDaemonServersDetailed(): Promise<ServerInfo[]> {
  const socketPath = getSocketPath();
  const res = await fetch('http://localhost/', {
    unix: socketPath,
    method: 'POST',
    body: JSON.stringify({ method: 'list-detailed' }),
  });
  const response = (await res.json()) as DaemonResponse;
  return response.serversDetailed ?? [];
}

/**
 * Stop the daemon or a specific server
 *
 * @param serverName - If provided, stop only this server (keeps daemon running)
 * @param force - If true, skip the >1 connection check for full daemon stop
 */
export async function stopDaemon(
  serverName?: string,
  force = false,
): Promise<void> {
  const socketPath = getSocketPath();
  if (!existsSync(socketPath)) {
    console.log('Daemon is not running');
    console.log(`  Socket: ${socketPath}`);
    console.log('  Hint: Start with "mcpx daemon start"');
    return;
  }

  // If serverName provided, just disconnect that server
  if (serverName) {
    const wasConnected = await disconnectServerFromDaemon(serverName);
    if (wasConnected) {
      console.log(`Stopped: ${serverName}`);
      const remaining = await listDaemonServers();
      if (remaining.length > 0) {
        console.log(`Remaining: ${remaining.join(', ')}`);
      } else {
        console.log('No servers remaining in daemon');
        console.log(
          '  Hint: Use "mcpx daemon stop" to shut down the daemon process',
        );
      }
    } else {
      console.log(`Server "${serverName}" was not running in daemon`);
      const active = await listDaemonServers();
      if (active.length > 0) {
        console.log(`Active servers: ${active.join(', ')}`);
      } else {
        console.log('No servers currently in daemon');
      }
    }
    return;
  }

  // Full daemon stop
  // Check for active connections before stopping
  if (!force) {
    try {
      const servers = await listDaemonServers();
      if (servers.length > 1) {
        console.log(
          `Error: Daemon has ${servers.length} active connections: ${servers.join(', ')}`,
        );
        console.log('  Other agents may be using these connections.');
        console.log('  To stop a specific server: mcpx daemon stop <server>');
        console.log('  To force stop all: mcpx daemon stop --force');
        process.exit(1);
      }
    } catch {
      // Daemon not responding, proceed with cleanup
    }
  }

  try {
    const res = await fetch('http://localhost/', {
      unix: socketPath,
      method: 'POST',
      body: JSON.stringify({ method: 'shutdown' }),
    });
    const response = (await res.json()) as DaemonResponse;
    const disconnected = response.servers ?? [];

    if (disconnected.length > 0) {
      console.log(
        `Daemon stopped (${disconnected.length} server(s) disconnected: ${disconnected.join(', ')})`,
      );
    } else {
      console.log('Daemon stopped (no active servers)');
    }
  } catch {
    // Socket exists but daemon not responding - clean up stale socket
    unlinkSync(socketPath);
    console.log('Cleaned up stale daemon socket (daemon was not responding)');
  }
}

export async function daemonStatus(): Promise<void> {
  const socketPath = getSocketPath();
  const running = await isDaemonRunning();

  console.log('=== mcpx daemon status ===');
  console.log('');

  if (!running) {
    console.log('Status: not running');
    console.log(`Socket: ${socketPath}`);
    console.log('');
    console.log('To start the daemon:');
    console.log(
      '  mcpx daemon start                  # Start with all servers from config',
    );
    console.log(
      '  mcpx daemon start <server>         # Start with specific server(s)',
    );
    console.log(
      '  mcpx daemon start -c \'{"mcpServers":{...}}\'  # Start with inline config',
    );
    return;
  }

  const servers = await listDaemonServersDetailed();

  console.log('Status: running');
  console.log(`Socket: ${socketPath}`);
  console.log(`Active servers: ${servers.length}`);

  if (servers.length > 0) {
    console.log('');
    console.log('Servers:');
    for (const srv of servers) {
      const idleStr = formatIdleTime(srv.idleSeconds);
      console.log(`  ${srv.name}`);
      console.log(`    Transport: ${srv.transport}`);
      console.log(`    Config: ${srv.configSource}`);
      console.log(`    Idle: ${idleStr}`);
    }
    console.log('');
    console.log('To call a tool on a daemon-managed server:');
    console.log(`  mcpx ${servers[0].name}/<tool> '{...}'`);
    console.log('');
    console.log('To stop a specific server:');
    console.log(`  mcpx daemon stop ${servers[0].name}`);
  } else {
    console.log('');
    console.log('No servers currently connected.');
    console.log('To add a server: mcpx daemon start <server>');
  }
}

function formatIdleTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function getDaemonSocketPath(): string {
  return getSocketPath();
}
