import type { Env } from "./index";
import { renderApprovalDialog, generateStateParam, verifyStateParam } from "./workers-oauth-utils";

/**
 * GitHubOAuthHandler handles /oauth/authorize and /oauth/callback
 * and is consumed by OAuthProvider.serve().
 */
export class GitHubOAuthHandler {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/oauth/authorize") {
      return this.handleAuthorize(request);
    }
    if (url.pathname === "/oauth/callback") {
      return this.handleCallback(request);
    }

    return new Response("Not found", { status: 404 });
  }

  // Step 1: Show GitHub OAuth consent page
  private async handleAuthorize(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const clientId = this.env.GITHUB_CLIENT_ID;

    // Preserve the MCP OAuth state from the caller
    const mcpState = url.searchParams.get("state") ?? "";
    const redirectUri = `${url.origin}/oauth/callback`;

    // Generate a signed state that embeds the original MCP state
    const statePayload = await generateStateParam(
      { mcpState },
      this.env.COOKIE_ENCRYPTION_KEY
    );

    const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
    githubAuthUrl.searchParams.set("client_id", clientId);
    githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
    githubAuthUrl.searchParams.set("scope", "repo read:user");
    githubAuthUrl.searchParams.set("state", statePayload);

    // Show an approval dialog instead of redirecting immediately
    const html = renderApprovalDialog({
      appName: "GitHub MCP Server",
      appDescription: "Access your GitHub repositories via MCP.",
      scopes: ["repo", "read:user"],
      githubAuthUrl: githubAuthUrl.toString(),
    });

    return new Response(html, {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  }

  // Step 2: Exchange GitHub code for access token
  private async handleCallback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state") ?? "";

    if (!code) {
      return new Response("Missing code", { status: 400 });
    }

    // Verify and unpack state
    let mcpState: string;
    try {
      const payload = await verifyStateParam(stateParam, this.env.COOKIE_ENCRYPTION_KEY);
      mcpState = payload.mcpState ?? "";
    } catch {
      return new Response("Invalid state parameter", { status: 400 });
    }

    // Exchange code for GitHub access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: this.env.GITHUB_CLIENT_ID,
        client_secret: this.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/oauth/callback`,
      }),
    });

    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      return new Response(
        `GitHub OAuth error: ${tokenData.error ?? "no access_token returned"}`,
        { status: 400 }
      );
    }

    const githubToken = tokenData.access_token;

    // Fetch GitHub user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${githubToken}`,
        "User-Agent": "github-mcp-cloudflare",
        Accept: "application/vnd.github+json",
      },
    });
    const user = await userRes.json() as { login?: string; name?: string; id?: number };

    // Return props that will be passed to McpAgent
    // OAuthProvider will store these and inject via props on each MCP request
    const props = {
      githubToken,
      githubLogin: user.login ?? "",
      githubName: user.name ?? user.login ?? "",
    };

    // Hand back to OAuthProvider so it can complete the MCP OAuth flow
    // by returning a special redirect with the token bound to the session
    return new Response(
      JSON.stringify({ ok: true, props, state: mcpState }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
}
