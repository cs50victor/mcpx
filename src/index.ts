#!/usr/bin/env bun
/**
 * mcpx - A lightweight CLI for interacting with MCP servers
 *
 * Commands:
 *   mcpx                         List all servers and tools
 *   mcpx config                  Show config file locations
 *   mcpx grep <pattern>          Search tools by glob pattern
 *   mcpx <server>                Show server details
 *   mcpx <server>/<tool>         Show tool schema
 *   mcpx <server>/<tool> <json>  Call tool with arguments
 */

import { addCommand } from './commands/add.js';
import { callCommand } from './commands/call.js';
import { configCommand } from './commands/config.js';
import { grepCommand } from './commands/grep.js';
import { infoCommand } from './commands/info.js';
import { listCommand } from './commands/list.js';
import { searchCommand } from './commands/search.js';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_SECONDS,
} from './config.js';
import {
  ErrorCode,
  formatCliError,
  missingArgumentError,
  unknownOptionError,
} from './errors.js';
import { VERSION } from './version.js';

interface ParsedArgs {
  command:
    | 'list'
    | 'grep'
    | 'search'
    | 'add'
    | 'info'
    | 'call'
    | 'config'
    | 'help'
    | 'version';
  target?: string;
  pattern?: string;
  query?: string;
  serverName?: string;
  alias?: string;
  args?: string;
  json: boolean;
  withDescriptions: boolean;
  configPath?: string;
  localOnly: boolean;
  verified: boolean;
  limit: number;
  dryRun: boolean;
  preferLocal: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: 'list',
    json: false,
    withDescriptions: false,
    localOnly: false,
    verified: false,
    limit: 20,
    dryRun: false,
    preferLocal: false,
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

      case '--local':
        result.localOnly = true;
        break;

      case '--verified':
        result.verified = true;
        break;

      case '--limit':
        result.limit = Number.parseInt(args[++i], 10) || 20;
        break;

      case '--dry-run':
        result.dryRun = true;
        break;

      case '--prefer-local':
        result.preferLocal = true;
        break;

      case '--as':
        result.alias = args[++i];
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
    result.command = 'list';
  } else if (positional[0] === 'config') {
    result.command = 'config';
  } else if (positional[0] === 'grep') {
    result.command = 'grep';
    result.pattern = positional[1];
    if (!result.pattern) {
      console.error(formatCliError(missingArgumentError('grep', 'pattern')));
      process.exit(ErrorCode.CLIENT_ERROR);
    }
  } else if (positional[0] === 'search') {
    result.command = 'search';
    result.query = positional[1];
    if (!result.query) {
      console.error(formatCliError(missingArgumentError('search', 'query')));
      process.exit(ErrorCode.CLIENT_ERROR);
    }
  } else if (positional[0] === 'add') {
    result.command = 'add';
    result.serverName = positional[1];
    if (!result.serverName) {
      console.error(formatCliError(missingArgumentError('add', 'server-name')));
      process.exit(ErrorCode.CLIENT_ERROR);
    }
  } else if (positional[0].includes('/')) {
    // server/tool format
    result.target = positional[0];
    if (positional.length > 1) {
      result.command = 'call';
      // Support '-' to indicate stdin (Unix convention)
      const argsValue = positional.slice(1).join(' ');
      result.args = argsValue === '-' ? undefined : argsValue;
    } else {
      result.command = 'info';
    }
  } else {
    // Just server name
    result.command = 'info';
    result.target = positional[0];
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
mcpx v${VERSION} - A lightweight CLI for MCP servers

Usage:
  mcpx [options]                           List all servers and tools
  mcpx [options] config                    Show config file locations
  mcpx [options] grep <pattern>            Search tools by glob pattern
  mcpx [options] search <query>            Search Smithery registry
  mcpx [options] add <server>              Add registry server to config
  mcpx [options] <server>                  Show server/registry info
  mcpx [options] <server>/<tool>           Show tool schema and description
  mcpx [options] <server>/<tool> <json>    Call tool with arguments

Options:
  -h, --help               Show this help message
  -v, --version            Show version number
  -j, --json               Output as JSON (for scripting)
  -d, --with-descriptions  Include tool descriptions
  -c, --config <path>      Path to mcp_servers.json config file

Search Options:
  --local                  Search local servers only (skip registry)
  --verified               Filter to verified servers only
  --limit <n>              Limit results (default: 20)

Add Options:
  --as <alias>             Use custom local name
  --dry-run                Show what would be added without modifying config
  --prefer-local           Prefer local (stdio) over remote (http) connection

Output:
  stdout                   Tool results and data (default: text, --json for JSON)
  stderr                   Errors and diagnostics

Config File:
  The CLI looks for mcp_servers.json in:
    1. Path specified by MCP_CONFIG_PATH or -c/--config
    2. ./mcp_servers.json (current directory)
    3. ~/.mcp_servers.json
    4. ~/.config/mcp/mcp_servers.json

Examples:
  mcpx                                    # List all servers
  mcpx -d                                 # List with descriptions
  mcpx grep "*file*"                      # Search for file tools
  mcpx search github                      # Search registry for github servers
  mcpx search --verified gmail            # Search verified servers only
  mcpx add github --dry-run               # Preview adding github server
  mcpx add github --as gh                 # Add with custom alias
  mcpx github                             # Show server info (local or registry)
  mcpx filesystem/read_file               # Show tool schema
  mcpx filesystem/read_file '{"path":"./README.md"}'  # Call tool
  echo '{"path":"./file"}' | mcpx server/tool -       # Read JSON from stdin

Environment Variables:
  MCP_CONFIG_PATH          Path to config file (alternative to -c)
  MCP_DEBUG                Enable debug output
  MCP_TIMEOUT              Request timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS})
  MCP_CONCURRENCY          Max parallel server connections (default: ${DEFAULT_CONCURRENCY})
  MCP_MAX_RETRIES          Max retry attempts for transient errors (default: ${DEFAULT_MAX_RETRIES})
  MCP_RETRY_DELAY          Base retry delay in milliseconds (default: ${DEFAULT_RETRY_DELAY_MS})
  MCP_STRICT_ENV           Set to "false" to warn on missing env vars (default: true)
`);
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

    case 'search':
      await searchCommand({
        query: args.query ?? '',
        localOnly: args.localOnly,
        verified: args.verified,
        limit: args.limit,
        withDescriptions: args.withDescriptions,
        json: args.json,
        configPath: args.configPath,
      });
      break;

    case 'add':
      await addCommand({
        serverName: args.serverName ?? '',
        alias: args.alias,
        dryRun: args.dryRun,
        json: args.json,
        configPath: args.configPath ?? './mcp_servers.json',
        preferLocal: args.preferLocal,
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
main().catch((error) => {
  // Error message already formatted by command handlers
  console.error(error.message);
  process.exit(ErrorCode.CLIENT_ERROR);
});
