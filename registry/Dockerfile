# MCP Registry Server
# Build: docker build -t mcp-registry ./registry
# Run: docker run -p 8000:8000 mcp-registry

FROM python:3.12-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir fastapi uvicorn pydantic

# Copy application files
COPY registry.json .
COPY mcp_registry.py .

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/')"

# Run server
CMD ["python", "mcp_registry.py"]
