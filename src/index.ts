import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  GITHUB_TOKEN: string;
  MCP_OBJECT: DurableObjectNamespace;
}

export class GitHubMCP extends McpAgent {
  server = new McpServer({ name: "github-mcp", version: "1.0.0" });

  async init() {
    // リポジトリ情報を取得
    this.server.tool(
      "get_repo",
      "GitHubリポジトリの情報を取得する",
      { owner: z.string().describe("リポジトリオーナー名"), repo: z.string().describe("リポジトリ名") },
      async ({ owner, repo }) => {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: {
            Authorization: `token ${(this.env as Env).GITHUB_TOKEN}`,
            "User-Agent": "github-mcp-cloudflare",
          },
        });
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // Issue一覧を取得
    this.server.tool(
      "list_issues",
      "GitHubリポジトリのIssue一覧を取得する",
      { owner: z.string(), repo: z.string() },
      async ({ owner, repo }) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues`,
          {
            headers: {
              Authorization: `token ${(this.env as Env).GITHUB_TOKEN}`,
              "User-Agent": "github-mcp-cloudflare",
            },
          }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // PRの一覧を取得
    this.server.tool(
      "list_pull_requests",
      "GitHubリポジトリのPull Request一覧を取得する",
      { owner: z.string(), repo: z.string() },
      async ({ owner, repo }) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls`,
          {
            headers: {
              Authorization: `token ${(this.env as Env).GITHUB_TOKEN}`,
              "User-Agent": "github-mcp-cloudflare",
            },
          }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );
  }
}

export default {
  fetch: (req: Request, env: Env) =>
    GitHubMCP.serve("/mcp").fetch(req, env),
};
