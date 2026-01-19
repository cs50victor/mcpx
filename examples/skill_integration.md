# Skills + mcpx Integration

Skills encode procedural knowledge (when/why to use tools). mcpx provides connectivity (how to access tools). Together they enable reliable, consistent agent workflows.

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

The skill defines the workflow. mcpx commands are referenced but not explained in detail. The agent already knows how to discover schemas via `mcpx github/<tool>`.

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

1. **Skills stay generic about mcpx syntax** - Don't explain `--json` flags or error handling in skills. The system prompt covers that.

2. **Skills focus on domain logic** - What to check, in what order, what output format.

3. **One skill per workflow** - Don't combine "PR review" and "issue triage" in one skill.

4. **Reference tools by name** - Use `mcpx server/tool` in examples. Agents will discover schemas as needed.
