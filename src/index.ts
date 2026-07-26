import { z } from "zod";
import { handleAuthorize, handleCallback } from "./github-handler";

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  OAUTH_KV: KVNamespace;
}

const githubHeaders = (token: string) => ({
  Authorization: `token ${token}`,
  "User-Agent": "github-mcp-cloudflare",
  "Content-Type": "application/json",
  Accept: "application/vnd.github+json",
});

const jsonRpc = (id: unknown, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json" },
  });

const jsonRpcError = (id: unknown, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { "Content-Type": "application/json" },
  });

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  { name: "get_repo", description: "Get information about a GitHub repository.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"] } },
  { name: "list_issues", description: "List issues in a GitHub repository.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"] } },
  { name: "list_pull_requests", description: "List pull requests in a GitHub repository.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"] } },
  { name: "list_contents", description: "List files and directories in a GitHub repository.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string", default: "" }, ref: { type: "string" } }, required: ["owner", "repo"] } },
  { name: "get_contents", description: "Read the content of a file in a GitHub repository.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } }, required: ["owner", "repo", "path"] } },
  { name: "create_or_update_file", description: "Create or update a file in a GitHub repository.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, content: { type: "string" }, message: { type: "string" }, branch: { type: "string", default: "main" }, sha: { type: "string" } }, required: ["owner", "repo", "path", "content", "message"] } },
  { name: "create_branch", description: "Create a new branch in a GitHub repository.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, branch: { type: "string" }, from_branch: { type: "string", default: "main" } }, required: ["owner", "repo", "branch"] } },
  { name: "create_pull_request", description: "Create a pull request in a GitHub repository.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, title: { type: "string" }, body: { type: "string", default: "" }, head: { type: "string" }, base: { type: "string", default: "main" } }, required: ["owner", "repo", "title", "head"] } },
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

async function callTool(name: string, args: Record<string, unknown>, token: string): Promise<{ content: { type: string; text: string }[] }> {
  const gh = (path: string, opts?: RequestInit) =>
    fetch(`https://api.github.com${path}`, { ...opts, headers: { ...githubHeaders(token), ...(opts?.headers ?? {}) } });

  const text = async (res: Response) => JSON.stringify(await res.json(), null, 2);

  switch (name) {
    case "get_repo": {
      const { owner, repo } = args as { owner: string; repo: string };
      return { content: [{ type: "text", text: await text(await gh(`/repos/${owner}/${repo}`)) }] };
    }
    case "list_issues": {
      const { owner, repo } = args as { owner: string; repo: string };
      return { content: [{ type: "text", text: await text(await gh(`/repos/${owner}/${repo}/issues`)) }] };
    }
    case "list_pull_requests": {
      const { owner, repo } = args as { owner: string; repo: string };
      return { content: [{ type: "text", text: await text(await gh(`/repos/${owner}/${repo}/pulls`)) }] };
    }
    case "list_contents": {
      const { owner, repo, path = "", ref } = args as { owner: string; repo: string; path?: string; ref?: string };
      const cleanPath = (path as string).replace(/^\/+/, "");
      const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`);
      if (ref) url.searchParams.set("ref", ref as string);
      const res = await fetch(url.toString(), { headers: githubHeaders(token) });
      const data = await res.json() as unknown;
      if (!res.ok) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      if (!Array.isArray(data)) return { content: [{ type: "text", text: `'${cleanPath || "/"}' is a file. Use get_contents.` }] };
      const entries = (data as Array<{ type: string; name: string; path: string; size: number; sha: string }>)
        .map(i => ({ type: i.type, name: i.name, path: i.path, size: i.type === "file" ? i.size : undefined, sha: i.sha }));
      const summary = entries.map(e => e.type === "dir" ? `📁 ${e.name}/` : `📄 ${e.name} (${e.size ?? 0} bytes)`).join("\n");
      return { content: [{ type: "text", text: `Contents of '${cleanPath || "/"}' (${entries.length} items):\n\n${summary}` }] };
    }
    case "get_contents": {
      const { owner, repo, path, ref } = args as { owner: string; repo: string; path: string; ref?: string };
      const cleanPath = path.replace(/^\/+/, "");
      const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`);
      if (ref) url.searchParams.set("ref", ref);
      const res = await fetch(url.toString(), { headers: githubHeaders(token) });
      const data = await res.json() as unknown;
      if (!res.ok) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      if (Array.isArray(data)) return { content: [{ type: "text", text: `'${cleanPath}' is a directory. Use list_contents.` }] };
      const file = data as { path: string; size: number; sha: string; content: string };
      let decoded: string;
      try { decoded = decodeURIComponent(escape(atob(file.content.replace(/\n/g, "")))); }
      catch { decoded = `(Binary)`; }
      return { content: [{ type: "text", text: `File: ${file.path}\nSHA: ${file.sha}\nSize: ${file.size} bytes\n\n---\n${decoded}` }] };
    }
    case "create_or_update_file": {
      const { owner, repo, path, content, message, branch = "main", sha } = args as { owner: string; repo: string; path: string; content: string; message: string; branch?: string; sha?: string };
      const body: Record<string, unknown> = { message, content: btoa(unescape(encodeURIComponent(content))), branch };
      if (sha) body.sha = sha;
      return { content: [{ type: "text", text: await text(await gh(`/repos/${owner}/${repo}/contents/${path}`, { method: "PUT", body: JSON.stringify(body) })) }] };
    }
    case "create_branch": {
      const { owner, repo, branch, from_branch = "main" } = args as { owner: string; repo: string; branch: string; from_branch?: string };
      const refRes = await gh(`/repos/${owner}/${repo}/git/ref/heads/${from_branch}`);
      const refData = await refRes.json() as { object?: { sha?: string } };
      const sha = refData?.object?.sha;
      if (!sha) return { content: [{ type: "text", text: `Error: could not resolve SHA for '${from_branch}'` }] };
      return { content: [{ type: "text", text: await text(await gh(`/repos/${owner}/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) })) }] };
    }
    case "create_pull_request": {
      const { owner, repo, title, body = "", head, base = "main" } = args as { owner: string; repo: string; title: string; body?: string; head: string; base?: string };
      return { content: [{ type: "text", text: await text(await gh(`/repos/${owner}/${repo}/pulls`, { method: "POST", body: JSON.stringify({ title, body, head, base }) })) }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 MCP dispatcher (Cloudflare Workers native)
// ---------------------------------------------------------------------------

async function handleMcp(request: Request, token: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { id, method, params } = body;

  switch (method) {
    case "initialize":
      return jsonRpc(id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "github-mcp", version: "3.0.0" },
        capabilities: { tools: {} },
      });

    case "notifications/initialized":
      return new Response(null, { status: 204 });

    case "tools/list":
      return jsonRpc(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = (params as { name: string; arguments?: Record<string, unknown> })?.name;
      const toolArgs = (params as { name: string; arguments?: Record<string, unknown> })?.arguments ?? {};
      try {
        const result = await callTool(toolName, toolArgs, token);
        return jsonRpc(id, result);
      } catch (e) {
        return jsonRpcError(id, -32603, String(e));
      }
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(JSON.stringify({
        status: "ok", service: "github-mcp-cloudflare", version: "3.0.0",
        endpoints: { mcp: "/mcp  (OAuth 2.1 Bearer)", authorize: "/oauth/authorize", callback: "/oauth/callback" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return new Response(JSON.stringify({
        issuer: url.origin,
        authorization_endpoint: `${url.origin}/oauth/authorize`,
        token_endpoint: `${url.origin}/oauth/token`,
        registration_endpoint: `${url.origin}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return new Response(JSON.stringify({
        resource: url.origin,
        authorization_servers: [url.origin],
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/oauth/authorize") return handleAuthorize(request, env);
    if (url.pathname === "/oauth/callback") return handleCallback(request, env);
    if (url.pathname === "/oauth/token") return handleOAuthToken(request, env);
    if (url.pathname === "/oauth/register") return handleClientRegistration(request, env);

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer realm="github-mcp", resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`
          }
        });
      }
      return handleMcp(request, authHeader.slice(7));
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
  let params: URLSearchParams;
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await request.text());
  } else {
    const json = await request.json() as Record<string, string>;
    params = new URLSearchParams(json);
  }
  const code = params.get("code");
  const grantType = params.get("grant_type");
  if (grantType !== "authorization_code" || !code) {
    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const stored = await env.OAUTH_KV.get(`code:${code}`, "json") as { githubToken: string } | null;
  if (!stored) {
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  await env.OAUTH_KV.delete(`code:${code}`);
  return new Response(JSON.stringify({
    access_token: stored.githubToken, token_type: "bearer", scope: "repo read:user",
  }), { headers: { "Content-Type": "application/json" } });
}

async function handleClientRegistration(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json() as Record<string, unknown>;
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify({ clientId, clientSecret, ...body }), { expirationTtl: 60 * 60 * 24 * 30 });
  return new Response(JSON.stringify({
    client_id: clientId, client_secret: clientSecret,
    redirect_uris: body.redirect_uris ?? [],
    grant_types: ["authorization_code"], response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  }), { status: 201, headers: { "Content-Type": "application/json" } });
}
