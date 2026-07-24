import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  GITHUB_TOKEN: string;
  MCP_OBJECT: DurableObjectNamespace;
}

const headers = (token: string) => ({
  Authorization: `token ${token}`,
  "User-Agent": "github-mcp-cloudflare",
  "Content-Type": "application/json",
  Accept: "application/vnd.github+json",
});

export class GitHubMCP extends McpAgent {
  server = new McpServer({ name: "github-mcp", version: "1.0.0" });

  async init() {
    const token = () => (this.env as Env).GITHUB_TOKEN;

    // ----------------------------------------
    // 読み取り系
    // ----------------------------------------

    this.server.tool(
      "get_repo",
      "GitHubリポジトリの情報を取得する",
      {
        owner: z.string().describe("リポジトリオーナー名"),
        repo: z.string().describe("リポジトリ名"),
      },
      async ({ owner, repo }) => {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: headers(token()),
        });
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "list_issues",
      "GitHubリポジトリの Issue 一覧を取得する",
      { owner: z.string(), repo: z.string() },
      async ({ owner, repo }) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues`,
          { headers: headers(token()) }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "list_pull_requests",
      "GitHubリポジトリの Pull Request 一覧を取得する",
      { owner: z.string(), repo: z.string() },
      async ({ owner, repo }) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls`,
          { headers: headers(token()) }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ----------------------------------------
    // 書き込み系
    // ----------------------------------------

    this.server.tool(
      "create_or_update_file",
      "ファイルを作成または更新してコミットする。新規ファイルなら sha は不要。既存ファイル更新時は sha が必須。",
      {
        owner: z.string().describe("リポジトリオーナー名"),
        repo: z.string().describe("リポジトリ名"),
        path: z.string().describe("ファイルパス（例: src/hello.ts）"),
        content: z.string().describe("ファイルの内容（プレーンテキスト）"),
        message: z.string().describe("コミットメッセージ"),
        branch: z.string().default("main").describe("ブランチ名（デフォルト: main）"),
        sha: z.string().optional().describe("既存ファイルを更新する際に必要な blob SHA"),
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
          { method: "PUT", headers: headers(token()), body: JSON.stringify(body) }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "create_branch",
      "GitHubリポジトリに新しいブランチを作成する",
      {
        owner: z.string(),
        repo: z.string(),
        branch: z.string().describe("作成するブランチ名"),
        from_branch: z.string().default("main").describe("基点にするブランチ名（デフォルト: main）"),
      },
      async ({ owner, repo, branch, from_branch }) => {
        // 基点ブランチの最新 SHA を取得
        const refRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${from_branch}`,
          { headers: headers(token()) }
        );
        const refData = await refRes.json() as { object?: { sha?: string } };
        const sha = refData?.object?.sha;
        if (!sha) {
          return { content: [{ type: "text" as const, text: `エラー: ${from_branch} の SHA を取得できませんでした` }] };
        }

        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/refs`,
          {
            method: "POST",
            headers: headers(token()),
            body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
          }
        );
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    this.server.tool(
      "create_pull_request",
      "GitHubリポジトリに Pull Request を作成する",
      {
        owner: z.string(),
        repo: z.string(),
        title: z.string().describe("PR タイトル"),
        body: z.string().default("").describe("PR 本文（ディスクリプション）"),
        head: z.string().describe("マージ元ブランチ名"),
        base: z.string().default("main").describe("マージ先ブランチ名（デフォルト: main）"),
      },
      async ({ owner, repo, title, body, head, base }) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls`,
          {
            method: "POST",
            headers: headers(token()),
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
  fetch: (req: Request, env: Env) =>
    GitHubMCP.serve("/mcp").fetch(req, env),
};
