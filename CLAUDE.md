# mcpx

## Registry Update Protocol

`registry/registry.json` is the source of truth for MCP server discovery. Agents depend on accurate data.

### 1. Fetch Official Docs

WebFetch the official documentation URL. Extract:
- Server URL/endpoint
- Command and args
- Required environment variables

### 2. Clone the Repository

WebFetch summaries lose detail. Clone the repo:

```bash
git clone --depth 1 <repo-url> /tmp/<repo-name>
```

### 3. Find Tool Definitions

```bash
Grep: registerTool|name.*tool|\.tool\(
Glob: **/*-tools.ts or **/tools/*.ts
```

### 4. Read the README

READMEs list documented tools. Source code may include unlisted internal tools. Trust the README.

### 5. Verify Configuration

Check for:
- URL query parameters (`?project_ref=`, `?read_only=`)
- Environment variables (add to `envVars` array)
- Required placeholders (`<project-ref>`, `/path/to/dir`)

### 6. Write the Entry

```json
{
  "name": "server-name",
  "description": "What it does",
  "toolCount": 5,
  "recommended": {
    "command": "bunx",
    "args": ["-y", "<package>", "<required-args>"]
  },
  "tools": ["tool1", "tool2"],
  "envVars": ["API_KEY"],
  "notes": "Replace <placeholder> with X. Optional: --flag for Y."
}
```

### Standards

1. Use `bunx`, not `npx`
2. List every tool
3. Match `toolCount` to array length
4. Explain placeholders in notes
5. For remote servers, use `mcp-remote`:
   ```json
   "args": ["-y", "mcp-remote", "https://example.com/mcp"]
   ```

### Example: Supabase MCP

1. WebFetch docs - got overview
2. WebSearch - found project scoping requirement
3. Clone repo to `/tmp/supabase-mcp`
4. Glob `**/*-tools.ts` - 8 tool files
5. Read README - 32 tools across 8 feature groups
6. Note URL params: `project_ref`, `read_only`, `features`

Result: accurate entry with project scoping in URL.
