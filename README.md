# github-mcp-cloudflare

A custom GitHub MCP server deployed on Cloudflare Workers.
Designed primarily for use with Perplexity's Custom Remote Connector.

## Tools

| Tool | Description |
|---|---|
| `get_repo` | Get information about a GitHub repository |
| `list_issues` | List issues in a repository |
| `list_pull_requests` | List pull requests in a repository |
| `create_or_update_file` | Create or update a file and commit it |
| `create_branch` | Create a new branch |
| `create_pull_request` | Create a pull request |

## Endpoints

| Path | Auth | Description |
|---|---|---|
| `GET /` | Not required | Health check |
| `GET /health` | Not required | Health check |
| `POST /mcp` | Required | MCP main endpoint (Streamable HTTP) |

> **Note:** `GET /mcp` is handled directly by the MCP SDK. The previous custom `GET /mcp` response branch has been removed to improve compatibility with Perplexity.

## Setup

```bash
npm install
```

## Local Development

```bash
# Create .dev.vars
echo "GITHUB_TOKEN=ghp_xxxx" > .dev.vars
echo "MCP_API_KEY=your-key" >> .dev.vars

npm run dev
```

## Deploy

```bash
# Set secrets
wrangler secret put GITHUB_TOKEN
wrangler secret put MCP_API_KEY

# Deploy
npm run deploy
```

## Authentication

The following methods are supported (priority order: Bearer > X-API-Key > api_key query param):

```http
# Method 1: Authorization Bearer (recommended for Perplexity)
Authorization: Bearer <your-api-key>

# Method 2: X-API-Key header
X-API-Key: <your-api-key>

# Method 3: Query parameter
https://xxx.workers.dev/mcp?api_key=<your-api-key>
```

On authentication failure, the server returns `401` with a JSON body:

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key. Provide it via 'Authorization: Bearer <key>', 'X-API-Key: <key>' header, or '?api_key=<key>' query parameter.",
  "supported_auth": [
    "Authorization: Bearer <key>",
    "X-API-Key: <key>",
    "?api_key=<key>"
  ]
}
```

## Perplexity Custom Connector Setup

### Recommended: Bearer Token

| Field | Value |
|---|---|
| Name | `github-mcp-cloudflare` |
| MCP Server URL | `https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp` |
| Authentication | `Bearer Token` |
| Token | Value set via `wrangler secret put MCP_API_KEY` |
| Transport | `Streamable HTTP` |

### Alternative: API Key (X-API-Key header)

| Field | Value |
|---|---|
| Name | `github-mcp-cloudflare` |
| MCP Server URL | `https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp` |
| Authentication | `API Key` |
| Header name | `X-API-Key` |
| API Key value | Value set via `wrangler secret put MCP_API_KEY` |
| Transport | `Streamable HTTP` |

### ⚠️ Perplexity Compatibility Notes

- **Bearer Token is more reliable** than API Key for Perplexity's connector. Use Bearer Token if the tool list does not appear.
- **All tool descriptions are in English.** Japanese descriptions were found to cause issues with Perplexity's tool rendering.
- **`GET /mcp` custom response has been removed.** All `/mcp` traffic is now handled by the MCP SDK to avoid protocol conflicts.
- **Streamable HTTP requires both `application/json` and `text/event-stream` in the `Accept` header.** If you test with curl/PowerShell and get `Not Acceptable`, add the Accept header:

```powershell
# PowerShell: correct Accept header for tools/list
Invoke-WebRequest `
  -Uri "https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer YOUR_KEY"
    "Content-Type"  = "application/json"
    "Accept"        = "application/json, text/event-stream"
    "mcp-session-id" = "SESSION_ID_FROM_INITIALIZE"
  } `
  -Body '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

### Manual Verification (PowerShell)

**1. Health check (no auth)**
```powershell
iwr "https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/"
```

**2. Initialize**
```powershell
Invoke-WebRequest `
  -Uri "https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer YOUR_KEY"
    "Content-Type"  = "application/json"
    "Accept"        = "application/json, text/event-stream"
  } `
  -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

**3. tools/list** (use `mcp-session-id` from initialize response)
```powershell
Invoke-WebRequest `
  -Uri "https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp" `
  -Method POST `
  -Headers @{
    "Authorization"  = "Bearer YOUR_KEY"
    "Content-Type"   = "application/json"
    "Accept"         = "application/json, text/event-stream"
    "mcp-session-id" = "VALUE_FROM_INITIALIZE"
  } `
  -Body '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## Fine-grained Token Permissions

| Permission | Setting |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Issues | Read |
| Metadata | Read (auto-granted) |

## References

- [Cloudflare Docs: Build a Remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare Blog: Remote MCP Servers](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
- [MCP Specification: Streamable HTTP Transport](https://spec.modelcontextprotocol.io/specification/basic/transports/)
