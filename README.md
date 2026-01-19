# mcpx

On-demand MCP tool discovery for AI agents. Fetch schemas only when needed, not upfront.

## The Problem

Traditional MCP integration loads all tool definitions into the agent's context window upfront. Thousands of schema tokens are consumed before any work begins. As you add more MCP servers, this becomes untenable.

The Anthropic API requires tool definitions in the initial request, which has tradeoffs:

| Approach | Upside | Downside |
|----------|--------|----------|
| API-level tools | Native integration, typed schemas | Token bloat, cache invalidation on changes |
| CLI discovery (mcpx) | Lean context, cache-stable | Extra inference per discovery call |

With API-level tools, adding or removing tools invalidates [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching), increasing cost of subsequent requests. Even deferred loading requires declaring which tools exist at conversation start.

mcpx sidesteps these constraints by operating at the **execution layer** instead of the API layer:

```
API Layer:    tools: [bash]           ← static, always cached
Execution:    bash → mcpx discover    ← dynamic, on-demand
```

Your agent gets one tool (bash) with instructions to use mcpx. Tool discovery happens at runtime through shell commands, not API definitions. The prompt cache stays intact regardless of how many MCP servers you add.

See [Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) for the pattern this implements.

## Install

```bash
brew tap cs50victor/mcpx && brew install mcpx
```

<details>
<summary>Alternative methods</summary>

```bash
# Direct install
curl -fsSL https://raw.githubusercontent.com/cs50victor/mcpx/dev/install.sh | bash

# From source (requires bun)
bun install -g github:cs50victor/mcpx
```

</details>

## Quick Start

**1. Configure servers** — Create `~/.config/mcp/mcp_servers.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

**2. Discover → Inspect → Call**

```bash
mcpx                              # List all servers and tools
mcpx grep "*file*"                # Search tools by pattern
mcpx filesystem                   # Show server's tools with parameters
mcpx filesystem/read_file         # Get tool's JSON schema
mcpx filesystem/read_file '{"path": "./README.md"}'  # Call it
```

That's it. Your agent now has access to MCP tools without loading schemas upfront.

## Agent Integration

Add mcpx to your agent's system prompt. See [`examples/system_prompt.md`](./examples/system_prompt.md) for a drop-in template.

For programmatic orchestration patterns, see [`examples/`](./examples/):

| Example | Description |
|---------|-------------|
| [`system_prompt.md`](./examples/system_prompt.md) | Drop-in system prompt for AI agents |
| [`advanced_tool_use.sh`](./examples/advanced_tool_use.sh) | Programmatic tool orchestration |
| [`skill_integration.md`](./examples/skill_integration.md) | Combining skills + mcpx |

## CLI Reference

```
mcpx                              List servers and tools
mcpx grep <pattern>               Search tools (glob pattern)
mcpx <server>                     Show server tools and parameters
mcpx <server>/<tool>              Show tool JSON schema
mcpx <server>/<tool> <json>       Call tool with arguments
mcpx config                       Show config file locations
```

| Flag | Effect |
|------|--------|
| `-d` | Include descriptions |
| `-j` | JSON output |
| `-r` | Raw text output |
| `-c <path>` | Custom config path |

## Configuration

Config search order:
1. `-c` / `--config` flag
2. `MCP_CONFIG_PATH` env var
3. `./mcp_servers.json`
4. `~/.config/mcp/mcp_servers.json`

Environment variables: `MCP_TIMEOUT`, `MCP_CONCURRENCY`, `MCP_DEBUG`. Run `mcpx config` to see active config.

## License

MIT
