import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { GitHubOAuthHandler } from "./github-handler";

export interface Env {
  GITHUB_TOKEN: string;
  MCP_API_KEY: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
}

const githubHeaders = (token: string) => ({
  Authorization: `token ${token}`,
  "User-Agent": "github-mcp-cloudflare",
  "Content-Type": "application/json",
  Accept: "application/vnd.github+json",
});

/**
 * API Key authentication (for Perplexity)
 * Supported:
 *   1. Authorization: Bearer <token>
 *   2. X-API-Key: <token>
 *   3. ?api_key=<token>
 */
function authenticateApiKey(request: Request, env: Env): Response | null {
  if (!env.MCP_API_KEY) return null;

  let apiKey: string | null = null;

  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) apiKey = match[1];
  }

  if (!apiKey) {
    apiKey = request.headers.get("X-API-Key") ?? request.headers.get("x-api-key");
  }

  if (!apiKey) {
    const url = new URL(request.url);
    apiKey = url.searchParams.get("api_key");
  }

  if (apiKey && apiKey === env.MCP_API_KEY) return null; // valid

  return new Response(
    JSON.stringify({
      error: "Unauthorized",
      message: "Invalid or missing API key.",
      supported_auth: [
        "Authorization: Bearer <key>",
        "X-API-Key: <key>",
        "?api_key=<key>"
      ]
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="github-mcp-cloudflare"'
      }
    }
  );
}

// ---------------------------------------------------------------------------
// MCP Agent
// ---------------------------------------------------------------------------

export class GitHubMCP extends McpAgent {
  server = new McpServer({ name: "github-mcp", version: "2.0.0" });

  // Token used for GitHub API calls.
  // OAuth flow: stored in props by OAuthProvider
  // API key flow: GITHUB_TOKEN env var
  private githubToken(): string {
    const props = (this as unknown as { props?: { githubToken?: string } }).props;
    if (props?.githubToken) return props.githubToken;
    return (this.env as Env).GITHUB_TOKEN;
  }

  async init() {
    const token = () => this.githubToken();

    // ----------------------------------------
    // Read tools
    // ----------------------------------------

    this.server.tool(
      "get_repo",
      "Get information about a GitHub repository.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
      },
      async ({ owner, repo }) => {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: githubHeaders(token()),
        });
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "list_issues",
      "List issues in a GitHub repository.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
      },
      async ({ owner, repo }) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues`,
          { headers: githubHeaders(token()) }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "list_pull_requests",
      "List pull requests in a GitHub repository.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
      },
      async ({ owner, repo }) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls`,
          { headers: githubHeaders(token()) }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "list_contents",
      "List files and directories at a given path in a GitHub repository.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
        path: z.string().default("").describe("Directory path. Leave empty for root."),
        ref: z.string().optional().describe("Branch, tag, or commit SHA"),
      },
      async ({ owner, repo, path, ref }) => {
        const cleanPath = path.replace(/^\/+/, "");
        const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`);
        if (ref) url.searchParams.set("ref", ref);

        const res = await fetch(url.toString(), { headers: githubHeaders(token()) });
        const data = await res.json() as unknown;

        if (!res.ok) {
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (!Array.isArray(data)) {
          return {
            content: [{
              type: "text" as const,
              text: `'${cleanPath || "/"}' is a file, not a directory. Use get_contents to read file content.`,
            }],
          };
        }

        const entries = (data as Array<{ type: string; name: string; path: string; size: number; sha: string; html_url: string }>)
          .map((item) => ({
            type: item.type,
            name: item.name,
            path: item.path,
            size: item.type === "file" ? item.size : undefined,
            sha: item.sha,
            html_url: item.html_url,
          }));

        const summary = entries
          .map((e) => e.type === "dir" ? `📁 ${e.name}/` : `📄 ${e.name} (${e.size ?? 0} bytes)`)
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: `Contents of '${cleanPath || "/"}' (${entries.length} items):\n\n${summary}\n\n---\n${JSON.stringify(entries, null, 2)}`,
          }],
        };
      }
    );

    this.server.tool(
      "get_contents",
      "Read the content of a specific file in a GitHub repository.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path (e.g. 'src/index.ts')"),
        ref: z.string().optional().describe("Branch, tag, or commit SHA"),
      },
      async ({ owner, repo, path, ref }) => {
        const cleanPath = path.replace(/^\/+/, "");
        const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`);
        if (ref) url.searchParams.set("ref", ref);

        const res = await fetch(url.toString(), { headers: githubHeaders(token()) });
        const data = await res.json() as unknown;

        if (!res.ok) {
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (Array.isArray(data)) {
          return {
            content: [{
              type: "text" as const,
              text: `'${cleanPath}' is a directory. Use list_contents to browse.`,
            }],
          };
        }

        const file = data as { type: string; name: string; path: string; size: number; sha: string; encoding: string; content: string; html_url: string };

        if (file.type !== "file") {
          return { content: [{ type: "text" as const, text: `Unexpected type: ${file.type}` }] };
        }

        let decoded: string;
        try {
          decoded = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
        } catch {
          decoded = `(Binary file)\n${file.content}`;
        }

        return {
          content: [{
            type: "text" as const,
            text: `File: ${file.path}\nSHA: ${file.sha}\nSize: ${file.size} bytes\nURL: ${file.html_url}\n\n---\n${decoded}`,
          }],
        };
      }
    );

    // ----------------------------------------
    // Write tools
    // ----------------------------------------

    this.server.tool(
      "create_or_update_file",
      "Create or update a file in a GitHub repository. SHA is required when updating an existing file.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path (e.g. src/hello.ts)"),
        content: z.string().describe("File content as plain text"),
        message: z.string().describe("Commit message"),
        branch: z.string().default("main").describe("Target branch (default: main)"),
        sha: z.string().optional().describe("Blob SHA of existing file; required when updating"),
      },
      async ({ owner, repo, path, content, message, branch, sha }) => {
        const body: Record<string, unknown> = {
          message,
          content: btoa(unescape(encodeURIComponent(content))),
          branch,
        };
        if (sha) body.sha = sha;

        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
          { method: "PUT", headers: githubHeaders(token()), body: JSON.stringify(body) }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "create_branch",
      "Create a new branch in a GitHub repository.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
        branch: z.string().describe("Name of the new branch to create"),
        from_branch: z.string().default("main").describe("Source branch (default: main)"),
      },
      async ({ owner, repo, branch, from_branch }) => {
        const refRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${from_branch}`,
          { headers: githubHeaders(token()) }
        );
        const refData = await refRes.json() as { object?: { sha?: string } };
        const sha = refData?.object?.sha;
        if (!sha) {
          return { content: [{ type: "text" as const, text: `Error: could not resolve SHA for '${from_branch}'` }] };
        }
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/refs`,
          {
            method: "POST",
            headers: githubHeaders(token()),
            body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
          }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "create_pull_request",
      "Create a pull request in a GitHub repository.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
        title: z.string().describe("Pull request title"),
        body: z.string().default("").describe("Pull request description"),
        head: z.string().describe("Branch to merge from"),
        base: z.string().default("main").describe("Branch to merge into (default: main)"),
      },
      async ({ owner, repo, title, body, head, base }) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls`,
          {
            method: "POST",
            headers: githubHeaders(token()),
            body: JSON.stringify({ title, body, head, base }),
          }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "github-mcp-cloudflare",
          version: "2.0.0",
          endpoints: {
            mcp_apikey: "/mcp  (Authorization: Bearer <key>)",
            mcp_oauth: "/oauth/mcp  (OAuth 2.1 via Claude)",
            authorize: "/oauth/authorize",
            callback: "/oauth/callback",
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── OAuth routes (/oauth/*) ────────────────────────────────────────────
    if (url.pathname.startsWith("/oauth/")) {
      return OAuthProvider.serve(
        {
          apiHandler: GitHubMCP.serve("/oauth/mcp"),
          authorizeHandler: new GitHubOAuthHandler(env),
          clientRegistrationHandler: undefined,
        },
        {
          kv: env.OAUTH_KV,
          cookieEncryptionKey: env.COOKIE_ENCRYPTION_KEY,
          pathPrefix: "/oauth",
        }
      ).fetch(request, env);
    }

    // ── API Key route (/mcp) ───────────────────────────────────────────────
    if (url.pathname.startsWith("/mcp")) {
      const authError = authenticateApiKey(request, env);
      if (authError) return authError;
      return GitHubMCP.serve("/mcp").fetch(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
