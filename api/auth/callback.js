const {
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_DURATION_SECONDS,
  parseCookies,
  seal,
  createCookie,
  clearCookie,
  stateMatches,
  setPrivateResponseHeaders,
} = require("./session-crypto.js");

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

async function githubCallbackHandler(request, response) {
  setPrivateResponseHeaders(response);
  response.setHeader("Set-Cookie", clearCookie(STATE_COOKIE));
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const cookies = parseCookies(request);
  const code = String(request.query?.code || "");
  const state = String(request.query?.state || "");
  if (!code || !stateMatches(cookies[STATE_COOKIE], state)) {
    response.status(400).json({ error: "GitHub sign-in could not be verified. Please try again." });
    return;
  }

  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  const callbackUrl = process.env.GITHUB_APP_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    response.status(503).json({ error: "GitHub sign-in is not configured." });
    return;
  }

  try {
    const token = await exchangeCode({ code, clientId, clientSecret, callbackUrl });
    const user = await fetchAuthenticatedUser(token.access_token);
    const now = Date.now();
    const session = {
      accessToken: token.access_token,
      accessTokenExpiresAt: token.expires_in ? now + token.expires_in * 1000 : null,
      refreshToken: token.refresh_token || null,
      refreshTokenExpiresAt: token.refresh_token_expires_in
        ? now + token.refresh_token_expires_in * 1000
        : null,
      user: { login: user.login, avatar_url: user.avatar_url },
      expiresAt: now + SESSION_DURATION_SECONDS * 1000,
    };
    response.setHeader("Set-Cookie", [
      clearCookie(STATE_COOKIE),
      createCookie(SESSION_COOKIE, seal(session), SESSION_DURATION_SECONDS),
    ]);
    response.statusCode = 302;
    response.setHeader("Location", "/?auth=success");
    response.end();
  } catch {
    response.status(502).json({ error: "GitHub sign-in failed. Please try again." });
  }
}

async function exchangeCode({ code, clientId, clientSecret, callbackUrl }, fetchImplementation = fetch) {
  const response = await fetchImplementation(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl,
    }).toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) throw new Error("Token exchange failed");
  return data;
}

async function fetchAuthenticatedUser(token, fetchImplementation = fetch) {
  const response = await fetchImplementation(USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "gitprofilelens",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.login || !data?.avatar_url) throw new Error("User lookup failed");
  return data;
}

module.exports = githubCallbackHandler;
