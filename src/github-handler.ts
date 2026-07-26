import type { Env } from "./index";
import { generateStateParam, verifyStateParam, renderApprovalDialog } from "./workers-oauth-utils";

/**
 * Handle GET /oauth/authorize
 * Show GitHub consent dialog
 */
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Params from Claude's OAuth request
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const mcpState = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "";

  // Sign our own state to preserve Claude's params through GitHub redirect
  const statePayload = await generateStateParam(
    { mcpState, redirectUri, clientId, codeChallenge, codeChallengeMethod },
    env.COOKIE_ENCRYPTION_KEY
  );

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  githubAuthUrl.searchParams.set("redirect_uri", `${url.origin}/oauth/callback`);
  githubAuthUrl.searchParams.set("scope", "repo read:user");
  githubAuthUrl.searchParams.set("state", statePayload);

  const html = renderApprovalDialog({
    appName: "GitHub MCP Server",
    appDescription: "Claude からあなたの GitHub リポジトリにアクセスします。",
    scopes: ["repo", "read:user"],
    githubAuthUrl: githubAuthUrl.toString(),
  });

  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

/**
 * Handle GET /oauth/callback
 * Exchange GitHub code -> GitHub token -> store -> redirect back to Claude
 */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state") ?? "";

  if (!code) {
    return new Response("Missing code", { status: 400 });
  }

  // Verify and unpack our signed state
  let payload: Record<string, string>;
  try {
    payload = await verifyStateParam(stateParam, env.COOKIE_ENCRYPTION_KEY);
  } catch {
    return new Response("Invalid state", { status: 400 });
  }

  const { mcpState, redirectUri, clientId, codeChallenge, codeChallengeMethod } = payload;

  // Exchange GitHub code for GitHub access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/oauth/callback`,
    }),
  });

  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return new Response(`GitHub OAuth error: ${tokenData.error ?? "no token"}`, { status: 400 });
  }

  // Generate a short-lived MCP authorization code
  const mcpCode = crypto.randomUUID();

  // Store GitHub token keyed by MCP code (TTL: 5 minutes)
  await env.OAUTH_KV.put(
    `code:${mcpCode}`,
    JSON.stringify({ githubToken: tokenData.access_token }),
    { expirationTtl: 300 }
  );

  // Redirect back to Claude with MCP code
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", mcpCode);
  if (mcpState) callbackUrl.searchParams.set("state", mcpState);

  return Response.redirect(callbackUrl.toString(), 302);
}
