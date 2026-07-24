# github-mcp-cloudflare

Cloudflare Workers 上にデプロイするカスタム GitHub MCP サーバー。

## 機能

- `get_repo` - GitHub リポジトリ情報を取得
- `list_issues` - Issue 一覧を取得
- `list_pull_requests` - Pull Request 一覧を取得

## セットアップ

```bash
npm install
```

## ローカル開発

```bash
npm run dev
```

## デプロイ

```bash
# GitHub Token をシークレットに設定
wrangler secret put GITHUB_TOKEN

# デプロイ
npm run deploy
```

## MCP クライアントへの接続

`claude_desktop_config.json` に追加：

```json
{
  "mcpServers": {
    "github-mcp-cloudflare": {
      "command": "npx",
      "args": ["mcp-remote", "https://github-mcp-cloudflare.<your-account>.workers.dev/mcp"]
    }
  }
}
```

## GitHub OAuth 認証付きバージョン

認証付きにする場合は以下のテンプレートを使用：

```bash
npm create cloudflare@latest -- my-github-mcp \
  --template=cloudflare/ai/demos/remote-mcp-github-oauth
```

### 必要な外部サービス設定

1. GitHub OAuth App を 2 つ作成（開発用・本番用）
2. Cloudflare KV に `OAUTH_KV` を作成
3. 環境変数に `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` を設定

## 参考

- [Cloudflare Docs: Build a Remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare Blog: Remote MCP Servers](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
