# Skills + mcpx Integration

Skills encode procedural knowledge: when and why to use tools. mcpx provides connectivity: how to access tools. Together they enable reliable agent workflows.

## The Separation

| Layer | Responsibility | Example |
|-------|---------------|---------|
| **Skill** | Workflow logic, sequencing, presentation | "For PR reviews, first fetch diff, then check CI status, then summarize" |
| **mcpx** | Tool discovery and execution | `mcpx github/get_pull_request`, `mcpx github/list_checks` |

Skills teach the agent WHEN and WHY. mcpx handles HOW.

## Example: PR Review Skill

```markdown
# PR Review Skill

When asked to review a pull request:

1. **Fetch context**
   ```bash
   mcpx github/get_pull_request '{"owner": "...", "repo": "...", "number": N}'
   mcpx github/get_pull_request_diff '{"owner": "...", "repo": "...", "number": N}'
   ```

2. **Check CI status**
   ```bash
   mcpx github/list_checks '{"owner": "...", "repo": "...", "ref": "HEAD"}'
   ```

3. **Review structure**
   - Summary (1-2 sentences)
   - Key changes (bullet points)
   - Concerns (if any)
   - CI status

4. **If changes requested**, use:
   ```bash
   mcpx github/create_review '{"event": "REQUEST_CHANGES", "body": "..."}'
   ```
```

The skill defines the workflow. mcpx commands appear without detailed explanation; the agent discovers schemas via `mcpx github/<tool>`.

## Example: Research Skill with Multiple Sources

```markdown
# Research Skill

When researching a topic:

1. **Search multiple sources in parallel**
   ```bash
   mcpx github/search_code '{"query": "..."}' &
   mcpx web/search '{"query": "..."}' &
   mcpx arxiv/search '{"query": "..."}' &
   wait
   ```

2. **Stateful browsing** (sequential, state persists):
   ```bash
   mcpx daemon start browser && \
   mcpx browser/navigate '{"url": "..."}' && \
   mcpx browser/get_text '{"selector": "article"}' && \
   mcpx daemon stop browser
   ```

3. **Synthesize findings**
   - Cross-reference sources
   - Note contradictions
   - Cite with URLs
```

## Composition Benefits

One skill can orchestrate multiple MCP servers:

```
┌─────────────────────────────────────┐
│         Research Skill              │
│  (workflow: search → read → cite)   │
└─────────────────────────────────────┘
          │         │         │
          ▼         ▼         ▼
      ┌───────┐ ┌───────┐ ┌───────┐
      │github │ │browser│ │ arxiv │
      │ MCP   │ │  MCP  │ │  MCP  │
      └───────┘ └───────┘ └───────┘
```

## Best Practices

1. **Keep skills generic about mcpx syntax** - Leave `--json` flags and error handling to the system prompt.

2. **Focus skills on domain logic** - What to check, in what order, what output format.

3. **One skill per workflow** - Separate "PR review" from "issue triage."

4. **Reference tools by name** - Use `mcpx server/tool` in examples. Agents discover schemas as needed.
