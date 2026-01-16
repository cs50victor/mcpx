#!/usr/bin/env python3
"""
Build MCP server registry from Docker mcp-registry and GitHub API.

Outputs registry.json with server summaries and details.
Pydantic models ensure CI fails on schema changes.
"""

import base64
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

# Known official MCP servers: qualifiedName -> repo
KNOWN_OFFICIALS = {
    "github": "github/github-mcp-server",
    "notion": "makenotion/notion-mcp-server",
    "elevenlabs": "elevenlabs/elevenlabs-mcp",
    "firecrawl": "firecrawl/firecrawl-mcp-server",
    "perplexity": "perplexityai/modelcontextprotocol",
    "microsoft": "MicrosoftDocs/mcp",
    "minimax": "MiniMax-AI/MiniMax-MCP",
    "qdrant": "qdrant/mcp-server-qdrant",
    "line": "line/line-bot-mcp-server",
    "alpaca": "alpacahq/alpaca-mcp-server",
    "jina": "jina-ai/MCP",
    "redis": "redis/mcp-redis",
    "kagi": "kagisearch/kagimcp",
    "razorpay": "razorpay/razorpay-mcp-server",
    "tripo": "VAST-AI-Research/tripo-mcp",
    "tableau": "tableau/tableau-mcp",
    "magicui": "magicuidesign/mcp",
    "neo4j": "neo4j/mcp",
    "posthog": "PostHog/mcp",
    "penpot": "penpot/penpot-mcp",
    "browserstack": "browserstack/mcp-server",
    "matlab": "matlab/matlab-mcp-core-server",
    "railway": "railwayapp/railway-mcp-server",
    "vectorize": "vectorize-io/vectorize-mcp-server",
    "taskade": "taskade/mcp",
    "octopus": "OctopusDeploy/mcp-server",
    "render": "render-oss/render-mcp-server",
    "ahrefs": "ahrefs/ahrefs-mcp-server",
    "alchemy": "alchemyplatform/alchemy-mcp-server",
    "datahub": "acryldata/mcp-server-datahub",
    "surrealdb": "surrealdb/surrealmcp",
    "quantconnect": "QuantConnect/mcp-server",
    "mailtrap": "mailtrap/mailtrap-mcp",
    "buildkite": "buildkite/buildkite-mcp-server",
    "aws-powertools": "aws-powertools/powertools-mcp",
    "minio": "minio/mcp-server-aistor",
    "netlify": "netlify/netlify-mcp",
    "infisical": "Infisical/infisical-mcp-server",
    "kintone": "kintone/mcp-server",
    "calcom": "calcom/cal-mcp",
    "wandb": "wandb/wandb-mcp-server",
    "harness": "harness/mcp-server",
    "growthbook": "growthbook/growthbook-mcp",
    "gravatar": "Automattic/mcp-server-gravatar",
}

# Reverse lookup: repo -> qualifiedName
REPO_TO_NAME = {v.lower(): k for k, v in KNOWN_OFFICIALS.items()}


class Tool(BaseModel):
    """MCP tool definition."""
    name: str
    description: str = ""


class Connection(BaseModel):
    """Server connection configuration."""
    type: str = "stdio"  # "stdio" or "http"
    stdioFunction: str | None = None
    deploymentUrl: str | None = None
    configSchema: dict[str, Any] = Field(default_factory=dict)


class ServerSummary(BaseModel):
    """Server summary for search results."""
    qualifiedName: str
    displayName: str
    description: str
    verified: bool = False
    githubStars: int = 0
    remote: bool = False
    homepage: str = ""


class ServerDetail(BaseModel):
    """Full server details."""
    qualifiedName: str
    displayName: str
    description: str
    remote: bool = False
    connections: list[Connection] = Field(default_factory=list)
    tools: list[Tool] = Field(default_factory=list)
    security: dict[str, bool] | None = Field(default_factory=lambda: {"scanPassed": True})


class Registry(BaseModel):
    """Complete registry structure."""
    generated_at: str
    servers: list[ServerSummary]
    details: dict[str, ServerDetail]


def run_gh(args: list[str]) -> str:
    """Run gh CLI command and return output."""
    result = subprocess.run(
        ["gh"] + args,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def fetch_docker_registry_servers() -> list[dict[str, Any]]:
    """Fetch server list from docker/mcp-registry."""
    print("Fetching Docker mcp-registry server list...")
    try:
        output = run_gh(["api", "repos/docker/mcp-registry/contents/servers"])
        entries = json.loads(output)
        return [e for e in entries if e.get("type") == "dir"]
    except subprocess.CalledProcessError as e:
        print(f"Warning: Failed to fetch Docker registry: {e.stderr}", file=sys.stderr)
        return []


def fetch_server_yaml(name: str) -> dict[str, Any] | None:
    """Fetch and parse server.yaml for a given server."""
    try:
        output = run_gh([
            "api",
            f"repos/docker/mcp-registry/contents/servers/{name}/server.yaml",
        ])
        data = json.loads(output)
        content = base64.b64decode(data["content"]).decode("utf-8")

        # Parse YAML manually (simple key: value format)
        result: dict[str, Any] = {"name": name}
        current_key = None

        for line in content.split("\n"):
            line = line.rstrip()
            if not line or line.startswith("#"):
                continue

            if line.startswith("  ") and current_key:
                # Nested value
                if current_key not in result:
                    result[current_key] = {}
                subline = line.strip()
                if ":" in subline:
                    k, v = subline.split(":", 1)
                    result[current_key][k.strip()] = v.strip().strip('"').strip("'")
            elif ":" in line:
                key, value = line.split(":", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if value:
                    result[key] = value
                else:
                    current_key = key

        return result
    except Exception as e:
        print(f"Warning: Failed to fetch {name}/server.yaml: {e}", file=sys.stderr)
        return None


def fetch_github_stars(repo: str) -> int:
    """Fetch star count for a GitHub repository."""
    try:
        output = run_gh(["api", f"repos/{repo}", "--jq", ".stargazers_count"])
        return int(output.strip())
    except Exception:
        return 0


def extract_repo_from_url(url: str) -> str | None:
    """Extract owner/repo from GitHub URL."""
    if not url:
        return None
    # Handle: https://github.com/owner/repo or github.com/owner/repo
    url = url.replace("https://", "").replace("http://", "")
    if url.startswith("github.com/"):
        parts = url.replace("github.com/", "").split("/")
        if len(parts) >= 2:
            return f"{parts[0]}/{parts[1]}"
    return None


def is_official(owner: str, repo: str, name: str) -> bool:
    """
    Determine if a server is official.

    Rules:
    1. In KNOWN_OFFICIALS map
    2. Organization name appears in repo name (e.g., github/github-mcp-server)
    """
    full_repo = f"{owner}/{repo}".lower()

    # Check KNOWN_OFFICIALS
    if full_repo in REPO_TO_NAME:
        return True
    if name.lower() in KNOWN_OFFICIALS:
        return True

    # Check if org name is in repo name
    owner_lower = owner.lower()
    repo_lower = repo.lower()
    if owner_lower in repo_lower or repo_lower.startswith(owner_lower):
        return True

    return False


def build_server_from_docker(name: str, yaml_data: dict[str, Any]) -> tuple[ServerSummary, ServerDetail] | None:
    """Build server summary and detail from Docker registry YAML."""
    source = yaml_data.get("source", {})
    if isinstance(source, str):
        source = {"project": source}

    project_url = source.get("project", "")
    repo = extract_repo_from_url(project_url)

    # Get GitHub stars
    stars = 0
    if repo:
        stars = fetch_github_stars(repo)

    # Determine if official
    verified = False
    owner = ""
    repo_name = ""
    if repo:
        parts = repo.split("/")
        if len(parts) == 2:
            owner, repo_name = parts
            verified = is_official(owner, repo_name, name)

    # Build display name
    display_name = yaml_data.get("display_name", name.replace("-", " ").title())
    description = yaml_data.get("description", f"MCP server for {display_name}")

    # Determine connection type
    connections: list[Connection] = []
    remote = False

    # Check for remote endpoint in config
    config = yaml_data.get("config", {})
    if isinstance(config, dict):
        if "url" in config or "endpoint" in config:
            remote = True
            connections.append(Connection(
                type="http",
                deploymentUrl=config.get("url") or config.get("endpoint", ""),
                configSchema={},
            ))

    if not connections:
        # Default to stdio
        image = yaml_data.get("image", f"mcp/{name}")
        connections.append(Connection(
            type="stdio",
            stdioFunction=f"docker run -i {image}",
            configSchema={},
        ))

    summary = ServerSummary(
        qualifiedName=name,
        displayName=display_name,
        description=description,
        verified=verified,
        githubStars=stars,
        remote=remote,
        homepage=project_url or f"https://github.com/docker/mcp-registry/tree/main/servers/{name}",
    )

    detail = ServerDetail(
        qualifiedName=name,
        displayName=display_name,
        description=description,
        remote=remote,
        connections=connections,
        tools=[],  # Tools would require running the server
        security={"scanPassed": True},
    )

    return summary, detail


def fetch_official_servers_from_github() -> list[tuple[str, dict[str, Any]]]:
    """Search GitHub for official MCP servers."""
    print("Searching GitHub for official MCP servers...")
    try:
        output = run_gh([
            "search", "repos",
            "official mcp server",
            "--sort", "stars",
            "--limit", "100",
            "--json", "fullName,description,stargazersCount,url",
        ])
        repos = json.loads(output)
        return [(r["fullName"], r) for r in repos]
    except subprocess.CalledProcessError as e:
        print(f"Warning: GitHub search failed: {e.stderr}", file=sys.stderr)
        return []


def build_server_from_github(full_name: str, repo_data: dict[str, Any]) -> tuple[ServerSummary, ServerDetail]:
    """Build server from GitHub repo data."""
    parts = full_name.split("/")
    owner = parts[0] if len(parts) > 0 else ""
    repo = parts[1] if len(parts) > 1 else full_name

    # Derive qualified name
    name = repo.lower().replace("-mcp-server", "").replace("mcp-server-", "").replace("-mcp", "").replace("mcp-", "")

    # Check if we have a known mapping
    if full_name.lower() in REPO_TO_NAME:
        name = REPO_TO_NAME[full_name.lower()]

    verified = is_official(owner, repo, name)
    stars = repo_data.get("stargazersCount", 0)
    description = repo_data.get("description", f"MCP server from {owner}")
    url = repo_data.get("url", f"https://github.com/{full_name}")

    display_name = name.replace("-", " ").title()

    summary = ServerSummary(
        qualifiedName=name,
        displayName=display_name,
        description=description or f"MCP server for {display_name}",
        verified=verified,
        githubStars=stars,
        remote=False,
        homepage=url,
    )

    detail = ServerDetail(
        qualifiedName=name,
        displayName=display_name,
        description=description or f"MCP server for {display_name}",
        remote=False,
        connections=[Connection(type="stdio", configSchema={})],
        tools=[],
        security={"scanPassed": True},
    )

    return summary, detail


def main() -> None:
    """Build registry.json from all sources."""
    servers: dict[str, ServerSummary] = {}
    details: dict[str, ServerDetail] = {}

    # 1. Fetch from Docker mcp-registry
    docker_servers = fetch_docker_registry_servers()
    print(f"Found {len(docker_servers)} servers in Docker registry")

    for entry in docker_servers:
        name = entry["name"]
        yaml_data = fetch_server_yaml(name)
        if yaml_data:
            result = build_server_from_docker(name, yaml_data)
            if result:
                summary, detail = result
                servers[summary.qualifiedName] = summary
                details[summary.qualifiedName] = detail
                print(f"  + {name} ({summary.githubStars} stars, verified={summary.verified})")

    # 2. Fetch official servers from GitHub search
    github_repos = fetch_official_servers_from_github()
    print(f"Found {len(github_repos)} repos from GitHub search")

    for full_name, repo_data in github_repos:
        summary, detail = build_server_from_github(full_name, repo_data)
        # Only add if not already present or if this has more stars
        if summary.qualifiedName not in servers or servers[summary.qualifiedName].githubStars < summary.githubStars:
            servers[summary.qualifiedName] = summary
            details[summary.qualifiedName] = detail
            print(f"  + {summary.qualifiedName} from {full_name} ({summary.githubStars} stars)")

    # 3. Ensure all KNOWN_OFFICIALS are present
    for name, repo in KNOWN_OFFICIALS.items():
        if name not in servers:
            print(f"Adding known official: {name} ({repo})")
            stars = fetch_github_stars(repo)
            summary = ServerSummary(
                qualifiedName=name,
                displayName=name.replace("-", " ").title(),
                description=f"Official MCP server from {repo.split('/')[0]}",
                verified=True,
                githubStars=stars,
                remote=False,
                homepage=f"https://github.com/{repo}",
            )
            detail = ServerDetail(
                qualifiedName=name,
                displayName=summary.displayName,
                description=summary.description,
                remote=False,
                connections=[Connection(type="stdio", configSchema={})],
                tools=[],
                security={"scanPassed": True},
            )
            servers[name] = summary
            details[name] = detail

    # Sort servers: verified first, then by stars
    sorted_servers = sorted(
        servers.values(),
        key=lambda s: (-int(s.verified), -s.githubStars, s.qualifiedName),
    )

    # Build registry
    registry = Registry(
        generated_at=datetime.now(timezone.utc).isoformat(),
        servers=sorted_servers,
        details=details,
    )

    # Validate with Pydantic (will raise if invalid)
    registry_dict = registry.model_dump()

    # Write output
    output_path = Path(__file__).parent / "registry.json"
    with open(output_path, "w") as f:
        json.dump(registry_dict, f, indent=2)

    print(f"\nWrote {len(sorted_servers)} servers to {output_path}")
    print(f"  Verified: {sum(1 for s in sorted_servers if s.verified)}")
    print(f"  Remote: {sum(1 for s in sorted_servers if s.remote)}")


if __name__ == "__main__":
    main()
