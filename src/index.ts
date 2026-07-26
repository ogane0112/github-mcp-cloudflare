import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

// ---------------------------------------------------------------------------
// Build MCP server with GitHub token bound at request time
// ---------------------------------------------------------------------------

function buildMcpServer(token: string): McpServer {
  const server = new McpServer({ name: "github-mcp", version: "3.0.0" });

  server.tool("get_repo", "Get information about a GitHub repository.",
    { owner: z.string(), repo: z.string() },
    async ({ owner, repo }) => {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: githubHeaders(token) });
      return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
    }
  );

  server.tool("list_issues", "List issues in a GitHub repository.",
    { owner: z.string(), repo: z.string() },
    async ({ owner, repo }) => {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, { headers: githubHeaders(token) });
      return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
    }
  );

  server.tool("list_pull_requests", "List pull requests in a GitHub repository.",
    { owner: z.string(), repo: z.string() },
    async ({ owner, repo }) => {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, { headers: githubHeaders(token) });
      return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
    }
  );

  server.tool("list_contents", "List files and directories in a GitHub repository.",
    { owner: z.string(), repo: z.string(), path: z.string().default(""), ref: z.string().optional() },
    async ({ owner, repo, path, ref }) => {
      const cleanPath = path.replace(/^\/+/, "");
      const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`);
      if (ref) url.searchParams.set("ref", ref);
      const res = await fetch(url.toString(), { headers: githubHeaders(token) });
      const data = await res.json() as unknown;
      if (!res.ok) return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      if (!Array.isArray(data)) return { content: [{ type: "text" as const, text: `'${cleanPath || "/"}' is a file. Use get_contents.` }] };
      const entries = (data as Array<{ type: string; name: string; path: string; size: number; sha: string }>)
        .map(i => ({ type: i.type, name: i.name, path: i.path, size: i.type === "file" ? i.size : undefined, sha: i.sha }));
      const summary = entries.map(e => e.type === "dir" ? `📁 ${e.name}/` : `📄 ${e.name} (${e.size ?? 0} bytes)`).join("\n");
      return { content: [{ type: "text" as const, text: `Contents of '${cleanPath || "/"}' (${entries.length} items):\n\n${summary}\n\n---\n${JSON.stringify(entries, null, 2)}` }] };
    }
  );

  server.tool("get_contents", "Read the content of a file in a GitHub repository.",
    { owner: z.string(), repo: z.string(), path: z.string(), ref: z.string().optional() },
    async ({ owner, repo, path, ref }) => {
      const cleanPath = path.replace(/^\/+/, "");
      const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`);
      if (ref) url.searchParams.set("ref", ref);
      const res = await fetch(url.toString(), { headers: githubHeaders(token) });
      const data = await res.json() as unknown;
      if (!res.ok) return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      if (Array.isArray(data)) return { content: [{ type: "text" as const, text: `'${cleanPath}' is a directory. Use list_contents.` }] };
      const file = data as { path: string; size: number; sha: string; content: string };
      let decoded: string;
      try { decoded = decodeURIComponent(escape(atob(file.content.replace(/\n/g, "")))); }
      catch { decoded = `(Binary)\n${file.content}`; }
      return { content: [{ type: "text" as const, text: `File: ${file.path}\nSHA: ${file.sha}\nSize: ${file.size} bytes\n\n---\n${decoded}` }] };
    }
  );

  server.tool("create_or_update_file", "Create or update a file in a GitHub repository.",
    { owner: z.string(), repo: z.string(), path: z.string(), content: z.string(), message: z.string(), branch: z.string().default("main"), sha: z.string().optional() },
    async ({ owner, repo, path, content, message, branch, sha }) => {
      const body: Record<string, unknown> = { message, content: btoa(unescape(encodeURIComponent(content))), branch };
      if (sha) body.sha = sha;
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        { method: "PUT", headers: githubHeaders(token), body: JSON.stringify(body) });
      return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
    }
  );

  server.tool("create_branch", "Create a new branch in a GitHub repository.",
    { owner: z.string(), repo: z.string(), branch: z.string(), from_branch: z.string().default("main") },
    async ({ owner, repo, branch, from_branch }) => {
      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${from_branch}`, { headers: githubHeaders(token) });
      const refData = await refRes.json() as { object?: { sha?: string } };
      const sha = refData?.object?.sha;
      if (!sha) return { content: [{ type: "text" as const, text: `Error: could not resolve SHA for '${from_branch}'` }] };
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`,
        { method: "POST", headers: githubHeaders(token), body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
      return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
    }
  );

  server.tool("create_pull_request", "Create a pull request in a GitHub repository.",
    { owner: z.string(), repo: z.string(), title: z.string(), body: z.string().default(""), head: z.string(), base: z.string().default("main") },
    async ({ owner, repo, title, body, head, base }) => {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`,
        { method: "POST", headers: githubHeaders(token), body: JSON.stringify({ title, body, head, base }) });
      return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(JSON.stringify({
        status: "ok", service: "github-mcp-cloudflare", version: "3.0.0",
        endpoints: { mcp: "/mcp  (OAuth 2.1 Bearer)", authorize: "/oauth/authorize", callback: "/oauth/callback" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // OAuth discovery
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

    // OAuth authorize
    if (url.pathname === "/oauth/authorize") {
      return handleAuthorize(request, env);
    }

    // OAuth callback
    if (url.pathname === "/oauth/callback") {
      return handleCallback(request, env);
    }

    // OAuth token exchange
    if (url.pathname === "/oauth/token") {
      return handleOAuthToken(request, env);
    }

    // Dynamic client registration
    if (url.pathname === "/oauth/register") {
      return handleClientRegistration(request, env);
    }

    // MCP endpoint — stateless, token extracted from Bearer header each request
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

      const githubToken = authHeader.slice(7);
      const server = buildMcpServer(githubToken);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      await server.connect(transport);
      const response = await transport.handleRequest(request);
      await server.close();
      return response;
    }

    return new Response("Not found", { status: 404 });
  },
};

// ---------------------------------------------------------------------------
// OAuth token endpoint
// ---------------------------------------------------------------------------
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
    access_token: stored.githubToken,
    token_type: "bearer",
    scope: "repo read:user",
  }), { headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Dynamic client registration
// ---------------------------------------------------------------------------
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
