# github-mcp-cloudflare

Cloudflare Workers 上にデプロイするカスタム GitHub MCP サーバー。
Perplexity の Custom Remote Connector から利用することを主目的としています。

## 機能

- `get_repo` - GitHub リポジトリ情報を取得
- `list_issues` - Issue 一覧を取得
- `list_pull_requests` - Pull Request 一覧を取得
- `create_or_update_file` - ファイルを作成・更新してコミット
- `create_branch` - ブランチを作成
- `create_pull_request` - Pull Request を作成

## エンドポイント

| パス | 認証 | 説明 |
|---|---|---|
| `GET /` | 不要 | ヘルスチェック |
| `GET /health` | 不要 | ヘルスチェック |
| `GET /mcp` | 必要 | MCP 接続確認（200 OK を返す） |
| `POST /mcp` | 必要 | MCP メインエンドポイント |

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

以下の**いずれか**の方式で API Key を渡すことができます。
優先順位: Bearer > X-API-Key > api_key クエリパラメータ

```http
# 方式1: Authorization Bearer（Perplexity 推奨）
Authorization: Bearer <your-api-key>

# 方式2: X-API-Key ヘッダー
X-API-Key: <your-api-key>

# 方式3: クエリパラメータ
https://xxx.workers.dev/mcp?api_key=<your-api-key>
```

認証失敗時は以下の JSON とともに `401` を返します:

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

## Perplexity カスタムコネクター設定

> Perplexity の MCP 接続確認では `GET /mcp` に対してリクエストを送る場合があります。
> 本実装では `GET /mcp` も認証付きで `200 OK` を返します。

### Authentication: API Key 方式（推奨）

| 項目 | 値 |
|---|---|
| Name | `github-mcp-cloudflare` |
| MCP Server URL | `https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp` |
| Authentication | `API Key` |
| Header name | `X-API-Key` |
| API Key 値 | `wrangler secret put MCP_API_KEY` で設定した値 |
| Transport | `Streamable HTTP` |

### Authentication: Bearer Token 方式（代替）

Perplexity が `Authorization: Bearer` を使う場合はこちら。

| 項目 | 値 |
|---|---|
| Name | `github-mcp-cloudflare` |
| MCP Server URL | `https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp` |
| Authentication | `Bearer Token` |
| Token | `wrangler secret put MCP_API_KEY` で設定した値 |
| Transport | `Streamable HTTP` |

### 接続確認（curl）

```bash
# ヘルスチェック（認証不要）
curl https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/

# MCP エンドポイント確認（Bearer）
curl -H "Authorization: Bearer YOUR_KEY" \
  https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp

# MCP エンドポイント確認（X-API-Key）
curl -H "X-API-Key: YOUR_KEY" \
  https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp
```

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
