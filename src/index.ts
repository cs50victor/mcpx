#!/usr/bin/env bun

import { closest, distance } from 'fastest-levenshtein';
import { callCommand } from './commands/call.js';
import { configCommand } from './commands/config.js';
import { grepCommand } from './commands/grep.js';
import { infoCommand } from './commands/info.js';
import { listCommand } from './commands/list.js';
import { registryCommand } from './commands/registry.js';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_SECONDS,
  type McpServersConfig,
  loadConfig,
} from './config.js';

import {
  daemonStatus,
  getDaemonSocketPath,
  startDaemon,
  stopDaemon,
} from './daemon.js';
import {
  ErrorCode,
  formatCliError,
  missingArgumentError,
  unknownOptionError,
} from './errors.js';
import { VERSION } from './version.js';

/** Positional subcommands - used for parsing and typo detection */
const SUBCOMMANDS = [
  'config',
  'daemon',
  'grep',
  'list',
  'ls',
  'registry',
] as const;

interface ParsedArgs {
  command:
    | 'none'
    | 'list'
    | 'grep'
    | 'info'
    | 'call'
    | 'config'
    | 'daemon'
    | 'registry'
    | 'help'
    | 'version';
  target?: string;
  pattern?: string;
  args?: string;
  json: boolean;
  withDescriptions: boolean;
  configPath?: string;
  daemonAction?: 'start' | 'stop' | 'status';
  daemonServers?: string[];
  daemonForce?: boolean;
  registryAction?: 'help' | 'list' | 'get';
  registryServerName?: string;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: 'none',
    json: false,
    withDescriptions: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        result.command = 'help';
        return result;

      case '-v':
      case '--version':
        result.command = 'version';
        return result;

      case '-j':
      case '--json':
        result.json = true;
        break;

      case '-d':
      case '--with-descriptions':
        result.withDescriptions = true;
        break;

      case '-c':
      case '--config':
        result.configPath = args[++i];
        break;

      case '--force':
        result.daemonForce = true;
        break;

      default:
        // Single '-' is allowed (stdin indicator), but other dash-prefixed args are options
        if (arg.startsWith('-') && arg !== '-') {
          console.error(formatCliError(unknownOptionError(arg)));
          process.exit(ErrorCode.CLIENT_ERROR);
        }
        positional.push(arg);
    }
  }

  // Determine command from positional arguments
  if (positional.length === 0) {
    result.command = 'none';
  } else if (positional[0] === 'list' || positional[0] === 'ls') {
    result.command = 'list';
  } else if (positional[0] === 'config') {
    result.command = 'config';
  } else if (positional[0] === 'daemon') {
    result.command = 'daemon';
    const action = positional[1] as 'start' | 'stop' | 'status' | undefined;
    if (!action || !['start', 'stop', 'status'].includes(action)) {
      console.error(
        formatCliError(missingArgumentError('daemon', 'start|stop|status')),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }
    result.daemonAction = action;
    // Collect server names after the action (e.g., daemon start server1 server2)
    if (positional.length > 2) {
      result.daemonServers = positional.slice(2);
    }
  } else if (positional[0] === 'grep') {
    result.command = 'grep';
    result.pattern = positional[1];
    if (!result.pattern) {
      console.error(formatCliError(missingArgumentError('grep', 'pattern')));
      process.exit(ErrorCode.CLIENT_ERROR);
    }
  } else if (positional[0] === 'registry') {
    result.command = 'registry';
    const action = positional[1];
    if (!action) {
      result.registryAction = 'help';
    } else if (action === 'list') {
      result.registryAction = 'list';
    } else if (action === 'get') {
      result.registryAction = 'get';
      result.registryServerName = positional[2];
    } else {
      result.registryAction = 'get';
      result.registryServerName = action;
    }
  } else if (positional[0].includes('/')) {
    // server/tool format
    result.target = positional[0];
    if (positional.length > 1) {
      result.command = 'call';
      // NOTE(victor): '-' indicates stdin (Unix convention)
      const argsValue = positional.slice(1).join(' ');
      result.args = argsValue === '-' ? undefined : argsValue;
    } else {
      result.command = 'info';
    }
  } else {
    // Check for typos in subcommands before treating as server name
    const input = positional[0];
    const match = closest(input, SUBCOMMANDS as unknown as string[]);
    const dist = distance(input, match);
    if (dist > 0 && dist <= 2) {
      console.error(`Unknown command: '${input}'. Did you mean '${match}'?`);
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    result.command = 'info';
    result.target = positional[0];
  }

  return result;
}

function printHelp(): void {
  const socketPath = getDaemonSocketPath();
  console.log(`
mcpx v${VERSION} - Dynamic MCP tool discovery and invocation for AI agents

Usage:
  mcpx                                     Show this help message
  mcpx list                                List all servers and tools
  mcpx ls                                  Alias for list
  mcpx [options] config                    Show config file locations
  mcpx [options] grep <pattern>            Search tools by glob pattern
  mcpx [options] <server>                  Show server tools and parameters
  mcpx [options] <server>/<tool>           Show tool schema and description
  mcpx [options] <server>/<tool> <json>    Call tool with arguments
  mcpx daemon <start|stop|status>          Manage persistent connection daemon
  mcpx registry                            Show registry command help
  mcpx registry list                       List available MCP servers from registry
  mcpx registry get <name>                 Show server details and config

Options:
  -h, --help               Show this help message
  -v, --version            Show version number
  -j, --json               Output as JSON (for scripting)
  -d, --with-descriptions  Include tool descriptions
  -c, --config <path|json> Config file path or inline JSON (if starts with '{')

Output:
  stdout                   Tool results and data (default: text, --json for JSON)
  stderr                   Errors and diagnostics

Environment Variables:
  MCP_CONFIG_PATH          Path to config file (alternative to -c)
  MCP_DEBUG                Enable debug output
  MCP_TIMEOUT              Request timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS})
  MCP_CONCURRENCY          Max parallel server connections (default: ${DEFAULT_CONCURRENCY})
  MCP_MAX_RETRIES          Max retry attempts for transient errors (default: ${DEFAULT_MAX_RETRIES})
  MCP_RETRY_DELAY          Base retry delay in milliseconds (default: ${DEFAULT_RETRY_DELAY_MS})
  MCP_STRICT_ENV           Set to "false" to warn on missing env vars (default: true)
  MCP_DAEMON_SOCKET        Daemon socket path (default: ${socketPath})
  MCP_DAEMON_IDLE_MS       Daemon idle timeout in ms (default: 300000)
  MCPX_REGISTRY_URL        Custom registry URL (default: GitHub-hosted registry)

Examples:
  mcpx list                               # List all servers
  mcpx list -d                            # List with descriptions
  mcpx grep "*file*"                      # Search for file tools
  mcpx filesystem                         # Show server tools
  mcpx filesystem/read_file               # Show tool schema
  mcpx filesystem/read_file '{"path":"./README.md"}'  # Call tool
  echo '{"path":"./file"}' | mcpx server/tool -       # Read JSON from stdin

  # Inline config (flat format):
  mcpx -c '{"s":{"command":"npx","args":["-y","@mcp/server"]}}' s/tool

Registry (discover MCP servers):
  mcpx registry                           # Show registry help
  mcpx registry list                      # List all available servers
  mcpx registry list --json               # List as JSON
  mcpx registry get filesystem            # Show filesystem server config
  mcpx registry get playwright --json     # Get config as JSON for .mcp.json

Daemon Mode (persistent connections for stateful servers):
  mcpx daemon start                          # Start daemon + all servers from config
  mcpx daemon start <server...>              # Start daemon + specific server(s)
  mcpx daemon start browser -c '{...}'       # Start with inline config
  mcpx daemon stop                           # Stop daemon entirely
  mcpx daemon stop <server>                  # Stop specific server, keep daemon
  mcpx daemon stop --force                   # Force stop (bypasses >1 connection check)
  mcpx daemon status                         # Show daemon status + active servers

  Required for stateful servers where sequential operations share state
  (e.g., browser sessions, database transactions, file handles).

  Without daemon: each 'mcpx server/tool' call connects, runs, disconnects.
  With daemon: 'mcpx daemon start server' keeps connection alive, then
               'mcpx server/tool' reuses that persistent connection.

Config File:
  The CLI looks for config in:
    1. Path specified by MCP_CONFIG_PATH or -c/--config
    2. ./.mcp.json (current directory, preferred)
    3. ./mcp.json
    4. ~/.mcp.json
    5. ~/.config/mcp/mcp.json

  Supported formats:
    Flat:    {"server": {"command": "...", "args": [...]}}
    Wrapped: {"mcpServers": {"server": {"command": "..."}}}
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'none':
    case 'help':
      printHelp();
      break;

    case 'version':
      console.log(`mcpx v${VERSION}`);
      break;

    case 'list':
      await listCommand({
        withDescriptions: args.withDescriptions,
        json: args.json,
        configPath: args.configPath,
      });
      break;

    case 'grep':
      await grepCommand({
        pattern: args.pattern ?? '',
        withDescriptions: args.withDescriptions,
        json: args.json,
        configPath: args.configPath,
      });
      break;

    case 'info':
      await infoCommand({
        target: args.target ?? '',
        json: args.json,
        withDescriptions: args.withDescriptions,
        configPath: args.configPath,
      });
      break;

    case 'call':
      await callCommand({
        target: args.target ?? '',
        args: args.args,
        json: args.json,
        configPath: args.configPath,
      });
      break;

    case 'config':
      await configCommand({
        json: args.json,
        configPath: args.configPath,
      });
      break;

    case 'registry':
      await registryCommand({
        action: args.registryAction ?? 'list',
        serverName: args.registryServerName,
        json: args.json,
      });
      break;

    case 'daemon':
      switch (args.daemonAction) {
        case 'start': {
          // NOTE(victor): subprocess bypasses config - receives server configs via IPC
          if (process.env._MCPX_DAEMON === '1') {
            await startDaemon(undefined, undefined);
            break;
          }
          let config: McpServersConfig;
          try {
            config = await loadConfig(args.configPath);
          } catch (error) {
            console.error((error as Error).message);
            process.exit(ErrorCode.CLIENT_ERROR);
          }
          await startDaemon(config, args.daemonServers);
          break;
        }
        case 'stop':
          await stopDaemon(args.daemonServers?.[0], args.daemonForce);
          break;
        case 'status':
          await daemonStatus();
          break;
      }
      break;
  }
}

process.on('SIGINT', () => {
  process.exit(130);
});
process.on('SIGTERM', () => {
  process.exit(143);
});

main().catch((error) => {
  console.error(error.message);
  process.exit(ErrorCode.CLIENT_ERROR);
});
