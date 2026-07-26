/**
 * Shared utility functions for github-mcp-cloudflare
 */

/**
 * Build standard GitHub API request headers.
 */
export function githubApiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    "User-Agent": "github-mcp-cloudflare",
    "Content-Type": "application/json",
    Accept: "application/vnd.github+json",
  };
}

/**
 * Exchange a GitHub OAuth code for an access token.
 */
export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });

  const data = await res.json() as { access_token?: string; error?: string; error_description?: string };

  if (!data.access_token) {
    throw new Error(`GitHub token exchange failed: ${data.error ?? "unknown"} — ${data.error_description ?? ""}`);
  }

  return data.access_token;
}

/**
 * Fetch the authenticated GitHub user.
 */
export async function getGitHubUser(
  token: string
): Promise<{ login: string; name: string; id: number }> {
  const res = await fetch("https://api.github.com/user", {
    headers: githubApiHeaders(token),
  });
  const user = await res.json() as { login?: string; name?: string; id?: number };
  return {
    login: user.login ?? "",
    name: user.name ?? user.login ?? "",
    id: user.id ?? 0,
  };
}
