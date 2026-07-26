# github-mcp-cloudflare

Cloudflare Workers 上で動作する GitHub MCP サーバー。
**Perplexity（API Key認証）** と **Claude（OAuth 2.1認証）** の両方から利用できます。

本番URL: https://github-mcp-cloudflare.t4qjpmb66z.workers.dev

---

## エンドポイント一覧

| パス | 用途 | 認証方式 |
|------|------|----------|
| `/mcp` | Perplexity 用 MCP | API Key |
| `/oauth/mcp` | Claude 用 MCP | OAuth 2.1 |
| `/oauth/authorize` | OAuth 認可エンドポイント | — |
| `/oauth/callback` | GitHub OAuth コールバック | — |
| `/health` | ヘルスチェック | 不要 |

---

## セットアップ手順

### 1. リポジトリのクローン & 依存関係インストール

```bash
git clone https://github.com/ogane0112/github-mcp-cloudflare
cd github-mcp-cloudflare
npm install
```

### 2. GitHub OAuth App の作成

[GitHub Developer Settings](https://github.com/settings/developers) → "New OAuth App" で以下を設定:

| 項目 | 値 |
|------|----|
| Homepage URL | `https://github-mcp-cloudflare.t4qjpmb66z.workers.dev` |
| Authorization callback URL | `https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/oauth/callback` |

> ⚠️ Callback URL は `/oauth/callback` です（以前の `/callback` から変更）

### 3. Cloudflare KV Namespace の作成

```bash
wrangler kv namespace create OAUTH_KV
```

出力された `id` を `wrangler.jsonc` の `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` に貼り付けてください。

### 4. Secrets の設定

```bash
# GitHub Personal Access Token（Fine-grained 推奨）
wrangler secret put GITHUB_TOKEN

# Perplexity 用 API Key（任意の文字列）
wrangler secret put MCP_API_KEY

# GitHub OAuth App の認証情報（Claude 用）
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# Cookie 暗号化キー（openssl rand -hex 32 で生成）
wrangler secret put COOKIE_ENCRYPTION_KEY
```

### 5. デプロイ

```bash
npm run deploy
```

---

## 利用方法

### Perplexity から使う（API Key認証）

Custom Connector に以下を設定:

```
Server URL: https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/mcp
Authentication: Bearer Token
Token: <MCP_API_KEY の値>
```

### Claude から使う（OAuth認証）

Custom Connector に以下を設定:

```
Server URL: https://github-mcp-cloudflare.t4qjpmb66z.workers.dev/oauth/mcp
```

Claude が自動で OAuth フローを開始します。ブラウザで GitHub 認証を完了してください。

---

## 利用可能なツール

| ツール名 | 説明 |
|---------|------|
| `get_repo` | リポジトリ情報の取得 |
| `list_issues` | Issue 一覧の取得 |
| `list_pull_requests` | PR 一覧の取得 |
| `list_contents` | ディレクトリの一覧表示 |
| `get_contents` | ファイル内容の取得 |
| `create_or_update_file` | ファイルの作成・更新 |
| `create_branch` | ブランチの作成 |
| `create_pull_request` | PR の作成 |

---

## ローカル開発

```bash
# .dev.vars に環境変数を設定（wrangler dev 用）
cat > .dev.vars << 'EOF'
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
MCP_API_KEY=your-local-api-key
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
COOKIE_ENCRYPTION_KEY=your-32-byte-hex-key
EOF

npm run dev
```
