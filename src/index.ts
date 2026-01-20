#!/usr/bin/env bun
/**
 * MCP-CLI - A lightweight CLI for interacting with MCP servers
 *
 * Commands:
 *   mcp-cli info                     List all servers and tools
 *   mcp-cli info <server>            Show server details
 *   mcp-cli info <server> <tool>     Show tool schema
 *   mcp-cli grep <pattern>           Search tools by glob pattern
 *   mcp-cli call <server> <tool>     Call tool (reads JSON from stdin if no args)
 *   mcp-cli call <server> <tool> {}  Call tool with JSON args
 */

import { callCommand } from './commands/call.js';
import { grepCommand } from './commands/grep.js';
import { infoCommand } from './commands/info.js';
import { listCommand } from './commands/list.js';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_SECONDS,
} from './config.js';
import {
  ErrorCode,
  ambiguousCommandError,
  formatCliError,
  missingArgumentError,
  tooManyArgumentsError,
  unknownOptionError,
  unknownSubcommandError,
} from './errors.js';
import { VERSION } from './version.js';

interface ParsedArgs {
  command: 'info' | 'grep' | 'call' | 'help' | 'version';
  server?: string;
  tool?: string;
  pattern?: string;
  args?: string;
  withDescriptions: boolean;
  configPath?: string;
}

/**
 * Known subcommands
 */
const SUBCOMMANDS = ['info', 'grep', 'call'] as const;

/**
 * Check if a string looks like a subcommand (not a server name)
 */
function isKnownSubcommand(arg: string): boolean {
  return SUBCOMMANDS.includes(arg as (typeof SUBCOMMANDS)[number]);
}

/**
 * Check if a string looks like it could be an unknown subcommand
 * (common aliases that users might try)
 */
function isPossibleSubcommand(arg: string): boolean {
  const aliases = [
    'run',
    'execute',
    'exec',
    'invoke',
    'list',
    'ls',
    'get',
    'show',
    'describe',
    'search',
    'find',
    'query',
  ];
  return aliases.includes(arg.toLowerCase());
}

/**
 * Parse server/tool from either "server/tool" or "server tool" format
 */
function parseServerTool(args: string[]): { server: string; tool?: string } {
  if (args.length === 0) {
    return { server: '' };
  }

  const first = args[0];

  // Check for slash format: server/tool
  if (first.includes('/')) {
    const slashIndex = first.indexOf('/');
    return {
      server: first.substring(0, slashIndex),
      tool: first.substring(slashIndex + 1) || undefined,
    };
  }

  // Space format: server tool
  return {
    server: first,
    tool: args[1],
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: 'info',
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

      case '-d':
      case '--with-descriptions':
        result.withDescriptions = true;
        break;

      case '-c':
      case '--config':
        result.configPath = args[++i];
        if (!result.configPath) {
          console.error(
            formatCliError(missingArgumentError('-c/--config', 'path')),
          );
          process.exit(ErrorCode.CLIENT_ERROR);
        }
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

  // No positional args = list all (info with no target)
  if (positional.length === 0) {
    result.command = 'info';
    return result;
  }

  const firstArg = positional[0];

  // =========================================================================
  // Explicit subcommand routing
  // =========================================================================

  if (firstArg === 'info') {
    result.command = 'info';
    const remaining = positional.slice(1);
    const { server, tool } = parseServerTool(remaining);
    result.server = server || undefined;
    result.tool = tool;
    return result;
  }

  if (firstArg === 'grep') {
    result.command = 'grep';
    result.pattern = positional[1];
    if (!result.pattern) {
      console.error(formatCliError(missingArgumentError('grep', 'pattern')));
      process.exit(ErrorCode.CLIENT_ERROR);
    }
    if (positional.length > 2) {
      console.error(
        formatCliError(tooManyArgumentsError('grep', positional.length - 1, 1)),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }
    return result;
  }

  if (firstArg === 'call') {
    result.command = 'call';
    const remaining = positional.slice(1);

    if (remaining.length === 0) {
      console.error(
        formatCliError(missingArgumentError('call', 'server and tool')),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    // Parse server/tool from remaining args
    const { server, tool } = parseServerTool(remaining);
    result.server = server;

    if (!tool) {
      // Check if it was slash format without tool
      if (remaining[0].includes('/') && !remaining[0].split('/')[1]) {
        console.error(formatCliError(missingArgumentError('call', 'tool')));
        process.exit(ErrorCode.CLIENT_ERROR);
      }
      // Space format with only server
      if (remaining.length < 2) {
        console.error(formatCliError(missingArgumentError('call', 'tool')));
        process.exit(ErrorCode.CLIENT_ERROR);
      }
    }

    result.tool = tool;

    // Determine where args start
    let argsStartIndex: number;
    if (remaining[0].includes('/')) {
      // slash format: call server/tool '{}' → args at index 1
      argsStartIndex = 1;
    } else {
      // space format: call server tool '{}' → args at index 2
      argsStartIndex = 2;
    }

    // Collect remaining args as JSON (support '-' for stdin)
    const jsonArgs = remaining.slice(argsStartIndex);
    if (jsonArgs.length > 0) {
      const argsValue = jsonArgs.join(' ');
      result.args = argsValue === '-' ? undefined : argsValue;
    }

    return result;
  }

  // =========================================================================
  // Check for unknown subcommand (common aliases)
  // =========================================================================

  if (isPossibleSubcommand(firstArg)) {
    console.error(formatCliError(unknownSubcommandError(firstArg)));
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  // =========================================================================
  // Backward compatibility: server/tool format without subcommand
  // =========================================================================

  if (firstArg.includes('/')) {
    const { server, tool } = parseServerTool([firstArg]);
    result.server = server;
    result.tool = tool;

    if (positional.length > 1) {
      // Has args, treat as call
      result.command = 'call';
      const argsValue = positional.slice(1).join(' ');
      result.args = argsValue === '-' ? undefined : argsValue;
    } else {
      // No args, treat as info
      result.command = 'info';
    }
    return result;
  }

  // =========================================================================
  // Ambiguous command detection: server tool without subcommand
  // =========================================================================

  if (positional.length >= 2) {
    const serverName = positional[0];
    const possibleTool = positional[1];

    // Check if second arg looks like a tool name (not JSON)
    const looksLikeJson =
      possibleTool.startsWith('{') || possibleTool.startsWith('[');
    const looksLikeToolName = /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(possibleTool);

    if (!looksLikeJson && looksLikeToolName) {
      const hasArgs = positional.length > 2;
      console.error(
        formatCliError(
          ambiguousCommandError(serverName, possibleTool, hasArgs),
        ),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }
  }

  // =========================================================================
  // Default: single server name → info
  // =========================================================================

  result.command = 'info';
  result.server = firstArg;
  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
mcp-cli v${VERSION} - A lightweight CLI for MCP servers

Usage:
  mcp-cli [options] info                        List all servers and tools
  mcp-cli [options] info <server>               Show server details
  mcp-cli [options] info <server> <tool>        Show tool schema
  mcp-cli [options] grep <pattern>              Search tools by glob pattern
  mcp-cli [options] call <server> <tool>        Call tool (reads JSON from stdin if no args)
  mcp-cli [options] call <server> <tool> <json> Call tool with JSON arguments

Formats (both work):
  mcp-cli info server tool                      Space-separated
  mcp-cli info server/tool                      Slash-separated
  mcp-cli call server tool '{}'                 Space-separated
  mcp-cli call server/tool '{}'                 Slash-separated

Options:
  -h, --help               Show this help message
  -v, --version            Show version number
  -d, --with-descriptions  Include tool descriptions
  -c, --config <path>      Path to mcp_servers.json config file

Output:
  info/grep                Human-readable text to stdout
  call                     Raw JSON to stdout (for piping)
  Errors                   Always to stderr

Examples:
  mcp-cli info                                   # List all servers
  mcp-cli info -d                                # List with descriptions
  mcp-cli grep "*file*"                          # Search for file tools
  mcp-cli info filesystem                        # Show server tools
  mcp-cli info filesystem read_file              # Show tool schema
  mcp-cli call filesystem read_file '{}'         # Call tool
  cat input.json | mcp-cli call server tool      # Read from stdin (no '-' needed)

Backward Compatible:
  mcp-cli                                        # Same as: mcp-cli info
  mcp-cli filesystem/read_file '{}'              # Same as: mcp-cli call filesystem read_file '{}'

Config File:
  The CLI looks for mcp_servers.json in:
    1. Path specified by MCP_CONFIG_PATH or -c/--config
    2. ./mcp_servers.json (current directory)
    3. ~/.mcp_servers.json
    4. ~/.config/mcp/mcp_servers.json
`);
}

/**
 * Build target string from server and tool
 */
function buildTarget(server?: string, tool?: string): string {
  if (!server) return '';
  if (!tool) return server;
  return `${server}/${tool}`;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'help':
      printHelp();
      break;

    case 'version':
      console.log(`mcp-cli v${VERSION}`);
      break;

    case 'info':
      if (!args.server) {
        // No server → list all
        await listCommand({
          withDescriptions: args.withDescriptions,
          configPath: args.configPath,
        });
      } else {
        await infoCommand({
          target: buildTarget(args.server, args.tool),
          withDescriptions: args.withDescriptions,
          configPath: args.configPath,
        });
      }
      break;

    case 'grep':
      await grepCommand({
        pattern: args.pattern ?? '',
        withDescriptions: args.withDescriptions,
        configPath: args.configPath,
      });
      break;

    case 'call':
      await callCommand({
        target: buildTarget(args.server, args.tool),
        args: args.args,
        configPath: args.configPath,
      });
      break;
  }
}

// Handle graceful shutdown on SIGINT/SIGTERM
process.on('SIGINT', () => {
  process.exit(130); // 128 + SIGINT(2)
});
process.on('SIGTERM', () => {
  process.exit(143); // 128 + SIGTERM(15)
});

// Run
main()
  .then(() => {
    // Use setImmediate to let stdout flush before exiting
    setImmediate(() => process.exit(0));
  })
  .catch((error) => {
    // Error message already formatted by command handlers
    console.error(error.message);
    setImmediate(() => process.exit(ErrorCode.CLIENT_ERROR));
  });

