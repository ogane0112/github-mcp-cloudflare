# github-mcp-cloudflare

Cloudflare Workers 上にデプロイするカスタム GitHub MCP サーバー。

## 機能

- `get_repo` - GitHub リポジトリ情報を取得
- `list_issues` - Issue 一覧を取得
- `list_pull_requests` - Pull Request 一覧を取得
- `create_or_update_file` - ファイルを作成・更新してコミット
- `create_branch` - ブランチを作成
- `create_pull_request` - Pull Request を作成

## セットアップ

```bash
npm install
```

## ローカル開発

```bash
# .dev.vars を作成
echo "GITHUB_TOKEN=ghp_xxxx" > .dev.vars
echo "MCP_API_KEY=任意のキー" >> .dev.vars

npm run dev
```

## デプロイ

```bash
# シークレットを設定
wrangler secret put GITHUB_TOKEN
wrangler secret put MCP_API_KEY

# デプロイ
npm run deploy
```

## API Key 認証

リクエスト時に以下のいずれかで API Key を渡す：

```
# ヘッダー方式（推奨）
X-API-Key: <your-api-key>

# クエリパラメータ方式
https://xxx.workers.dev/mcp?api_key=<your-api-key>
```

## Perplexity カスタムコネクター設定

| 項目 | 値 |
|---|---|
| Name | `github-mcp-cloudflare` |
| MCP Server URL | `https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp` |
| Authentication | `API Key` |
| Header name | `X-API-Key` |
| API Key 値 | `wrangler secret put MCP_API_KEY` で設定した値 |

## Fine-grained Token の必要パーミッション

| Permission | 設定値 |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Issues | Read |
| Metadata | Read（自動付与） |

## 参考

- [Cloudflare Docs: Build a Remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare Blog: Remote MCP Servers](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
