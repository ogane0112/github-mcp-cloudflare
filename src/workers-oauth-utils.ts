/**
 * Helpers for OAuth state management and approval dialog rendering.
 * Uses Web Crypto API (available in Cloudflare Workers).
 */

// ---------------------------------------------------------------------------
// State param (HMAC-signed JSON, base64url-encoded)
// ---------------------------------------------------------------------------

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function base64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlDecode(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function generateStateParam(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const enc = new TextEncoder();
  const data = JSON.stringify(payload);
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));

  const obj = { data, sig: base64urlEncode(sig) };
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

export async function verifyStateParam(
  stateParam: string,
  secret: string
): Promise<Record<string, string>> {
  let obj: { data: string; sig: string };
  try {
    const raw = new TextDecoder().decode(base64urlDecode(stateParam));
    obj = JSON.parse(raw);
  } catch {
    throw new Error("Invalid state encoding");
  }

  const enc = new TextEncoder();
  const key = await getHmacKey(secret);
  const sigBuf = base64urlDecode(obj.sig);
  const valid = await crypto.subtle.verify("HMAC", key, sigBuf, enc.encode(obj.data));

  if (!valid) throw new Error("State HMAC verification failed");

  return JSON.parse(obj.data) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Approval dialog HTML
// ---------------------------------------------------------------------------

interface ApprovalDialogOptions {
  appName: string;
  appDescription: string;
  scopes: string[];
  githubAuthUrl: string;
}

export function renderApprovalDialog(opts: ApprovalDialogOptions): string {
  const scopeItems = opts.scopes
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(opts.appName)} — 認証</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0d1117; color: #e6edf3;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 1rem;
  }
  .card {
    background: #161b22; border: 1px solid #30363d;
    border-radius: 12px; padding: 2rem; max-width: 440px; width: 100%;
  }
  .logo { font-size: 2rem; margin-bottom: 1rem; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  .desc { color: #8b949e; font-size: 0.875rem; margin-bottom: 1.5rem; }
  .scopes { margin-bottom: 1.5rem; }
  .scopes h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8b949e; margin-bottom: 0.5rem; }
  .scopes ul { list-style: none; padding: 0; }
  .scopes li {
    background: #21262d; border: 1px solid #30363d;
    border-radius: 6px; padding: 0.4rem 0.75rem;
    font-size: 0.875rem; font-family: monospace;
    margin-bottom: 0.35rem;
  }
  .actions { display: flex; gap: 0.75rem; }
  .btn {
    flex: 1; padding: 0.6rem 1rem; border-radius: 6px;
    font-size: 0.9rem; font-weight: 600; text-align: center;
    text-decoration: none; border: none; cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: #238636; color: #fff; }
  .btn-secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
  .footer { font-size: 0.75rem; color: #8b949e; text-align: center; margin-top: 1rem; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">🔑</div>
  <h1>${escapeHtml(opts.appName)}</h1>
  <p class="desc">${escapeHtml(opts.appDescription)}</p>
  <div class="scopes">
    <h2>要求するスコープ</h2>
    <ul>${scopeItems}</ul>
  </div>
  <div class="actions">
    <a href="${opts.githubAuthUrl}" class="btn btn-primary">GitHub で認証</a>
    <button onclick="window.history.back()" class="btn btn-secondary">キャンセル</button>
  </div>
  <p class="footer">GitHub アカウントで安全に認証します</p>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
