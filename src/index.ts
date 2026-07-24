import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  GITHUB_TOKEN: string;
  MCP_API_KEY: string;
  MCP_OBJECT: DurableObjectNamespace;
}

const githubHeaders = (token: string) => ({
  Authorization: `token ${token}`,
  "User-Agent": "github-mcp-cloudflare",
  "Content-Type": "application/json",
  Accept: "application/vnd.github+json",
});

/**
 * API Key authentication middleware
 * Supported auth methods (in priority order):
 *   1. Authorization: Bearer <token>  (recommended for Perplexity / OAuth2 clients)
 *   2. X-API-Key: <token>
 *   3. x-api-key: <token>
 *   4. ?api_key=<token>               (query parameter)
 */
function authenticate(request: Request, env: Env): Response | null {
  const url = new URL(request.url);

  // Health check endpoints do not require authentication
  if (url.pathname === "/" || url.pathname === "/health") return null;

  // Only enforce auth on /mcp
  if (!url.pathname.startsWith("/mcp")) return null;

  // Skip auth if MCP_API_KEY is not configured (dev fallback)
  if (!env.MCP_API_KEY) return null;

  let apiKey: string | null = null;

  // 1. Authorization: Bearer <token>
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) apiKey = match[1];
  }

  // 2. X-API-Key / x-api-key header
  if (!apiKey) {
    apiKey = request.headers.get("X-API-Key") ?? request.headers.get("x-api-key");
  }

  // 3. Query parameter
  if (!apiKey) {
    apiKey = url.searchParams.get("api_key");
  }

  if (!apiKey || apiKey !== env.MCP_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Invalid or missing API key. Provide it via 'Authorization: Bearer <key>', 'X-API-Key: <key>' header, or '?api_key=<key>' query parameter.",
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
          "WWW-Authenticate": "Bearer realm=\"github-mcp-cloudflare\""
        }
      }
    );
  }

  return null;
}

export class GitHubMCP extends McpAgent {
  server = new McpServer({ name: "github-mcp", version: "1.0.0" });

  async init() {
    const token = () => (this.env as Env).GITHUB_TOKEN;

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
      "List files and directories at a given path in a GitHub repository. Use path '/' or '' for the root directory.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
        path: z.string().default("").describe("Directory path to list (e.g. 'src' or 'src/components'). Leave empty or use '/' for root."),
        ref: z.string().optional().describe("Branch, tag, or commit SHA (default: repository's default branch)"),
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

        // GitHub returns an array for directories, object for files
        if (!Array.isArray(data)) {
          return {
            content: [{
              type: "text" as const,
              text: `Error: '${cleanPath || "/"}' is a file, not a directory. Use get_contents to read file content.`,
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
          .map((e) =>
            e.type === "dir"
              ? `📁 ${e.name}/`
              : `📄 ${e.name} (${e.size ?? 0} bytes)`
          )
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: `Contents of '${cleanPath || "/"}' (${entries.length} items):\n\n${summary}\n\n---\nFull metadata:\n${JSON.stringify(entries, null, 2)}`,
          }],
        };
      }
    );

    this.server.tool(
      "get_contents",
      "Read the content of a specific file in a GitHub repository. Returns decoded text content.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path (e.g. 'src/index.ts' or 'README.md')"),
        ref: z.string().optional().describe("Branch, tag, or commit SHA (default: repository's default branch)"),
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
              text: `Error: '${cleanPath}' is a directory, not a file. Use list_contents to browse directories.`,
            }],
          };
        }

        const file = data as { type: string; name: string; path: string; size: number; sha: string; encoding: string; content: string; html_url: string };

        if (file.type !== "file") {
          return { content: [{ type: "text" as const, text: `Unexpected type: ${file.type}` }] };
        }

        // Decode base64 content
        let decoded: string;
        try {
          decoded = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
        } catch {
          decoded = `(Binary file — base64 content below)\n${file.content}`;
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
      "Create or update a file in a GitHub repository and commit it. SHA is required when updating an existing file; omit it for new files.",
      {
        owner: z.string().describe("Repository owner (username or organization)"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path (e.g. src/hello.ts)"),
        content: z.string().describe("File content as plain text"),
        message: z.string().describe("Commit message"),
        branch: z.string().default("main").describe("Target branch (default: main)"),
        sha: z.string().optional().describe("Blob SHA of the existing file; required when updating"),
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
        from_branch: z.string().default("main").describe("Source branch to branch from (default: main)"),
      },
      async ({ owner, repo, branch, from_branch }) => {
        const refRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${from_branch}`,
          { headers: githubHeaders(token()) }
        );
        const refData = await refRes.json() as { object?: { sha?: string } };
        const sha = refData?.object?.sha;
        if (!sha) {
          return { content: [{ type: "text" as const, text: `Error: could not resolve SHA for branch '${from_branch}'` }] };
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
        body: z.string().default("").describe("Pull request description body"),
        head: z.string().describe("Name of the branch to merge from"),
        base: z.string().default("main").describe("Name of the branch to merge into (default: main)"),
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

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const url = new URL(request.url);

    // Health check endpoints (no auth required)
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "github-mcp-cloudflare",
          version: "1.0.0",
          mcp_endpoint: "/mcp",
          auth_methods: ["Authorization: Bearer <key>", "X-API-Key: <key>", "?api_key=<key>"]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Authenticate all /mcp requests
    const authError = authenticate(request, env);
    if (authError) return authError;

    // Delegate everything under /mcp to the MCP SDK handler
    return GitHubMCP.serve("/mcp").fetch(request, env);
  },
};
