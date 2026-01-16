#!/usr/bin/env python3
"""
MCP Registry FastAPI server.

Serves pre-built registry.json with search and detail endpoints.
"""

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

# Load registry at startup
REGISTRY_PATH = Path(__file__).parent / "registry.json"

if REGISTRY_PATH.exists():
    with open(REGISTRY_PATH) as f:
        REGISTRY: dict[str, Any] = json.load(f)
else:
    REGISTRY = {"generated_at": "", "servers": [], "details": {}}


app = FastAPI(
    title="MCP Registry",
    description="Registry of MCP servers with search and detail endpoints",
    version="1.0.0",
)


class ServerSummary(BaseModel):
    """Server summary for search results."""
    qualifiedName: str
    displayName: str
    description: str
    verified: bool = False
    githubStars: int = 0
    remote: bool = False
    homepage: str = ""


class Pagination(BaseModel):
    """Pagination metadata."""
    total: int


class SearchResponse(BaseModel):
    """Search endpoint response."""
    servers: list[ServerSummary]
    pagination: Pagination


class Tool(BaseModel):
    """MCP tool definition."""
    name: str
    description: str = ""


class Connection(BaseModel):
    """Server connection configuration."""
    type: str = "stdio"
    stdioFunction: str | None = None
    deploymentUrl: str | None = None
    configSchema: dict[str, Any] = {}


class ServerDetail(BaseModel):
    """Full server details."""
    qualifiedName: str
    displayName: str
    description: str
    remote: bool = False
    connections: list[Connection] = []
    tools: list[Tool] = []
    security: dict[str, bool] | None = None


@app.get("/")
def root() -> dict[str, str]:
    """Health check endpoint."""
    return {
        "status": "ok",
        "generated_at": REGISTRY.get("generated_at", "unknown"),
        "server_count": str(len(REGISTRY.get("servers", []))),
    }


@app.get("/servers", response_model=SearchResponse)
def search_servers(
    q: str = Query("", description="Search query"),
    pageSize: int = Query(20, ge=1, le=100, description="Results per page"),
    verified: bool | None = Query(None, description="Filter by verified status"),
) -> SearchResponse:
    """
    Search for MCP servers.

    Results are ranked by:
    1. Verified status (verified first)
    2. Exact match on qualifiedName
    3. GitHub stars (descending)
    """
    servers = REGISTRY.get("servers", [])
    query_lower = q.lower().strip()

    # Filter by search query
    if query_lower:
        results = []
        for s in servers:
            name_match = query_lower in s.get("qualifiedName", "").lower()
            display_match = query_lower in s.get("displayName", "").lower()
            desc_match = query_lower in s.get("description", "").lower()
            if name_match or display_match or desc_match:
                results.append(s)
    else:
        results = list(servers)

    # Filter by verified status
    if verified is not None:
        results = [s for s in results if s.get("verified", False) == verified]

    # Sort: verified first, then exact name match, then by stars
    def sort_key(s: dict[str, Any]) -> tuple[int, int, int, str]:
        is_verified = -1 if s.get("verified", False) else 0
        is_exact = -1 if s.get("qualifiedName", "").lower() == query_lower else 0
        stars = -s.get("githubStars", 0)
        name = s.get("qualifiedName", "")
        return (is_verified, is_exact, stars, name)

    results.sort(key=sort_key)

    total = len(results)
    results = results[:pageSize]

    return SearchResponse(
        servers=[ServerSummary(**s) for s in results],
        pagination=Pagination(total=total),
    )


@app.get("/servers/{name}", response_model=ServerDetail)
def get_server(name: str) -> ServerDetail:
    """Get detailed information about a specific server."""
    details = REGISTRY.get("details", {})

    if name in details:
        return ServerDetail(**details[name])

    # Try case-insensitive lookup
    name_lower = name.lower()
    for key, detail in details.items():
        if key.lower() == name_lower:
            return ServerDetail(**detail)

    raise HTTPException(status_code=404, detail=f"Server '{name}' not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
