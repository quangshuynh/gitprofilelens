const {
  SESSION_COOKIE,
  SESSION_DURATION_SECONDS,
  parseCookies,
  unseal,
  seal,
  createCookie,
  clearCookie,
} = require("./session-crypto.js");

const TOKEN_URL = "https://github.com/login/oauth/access_token";

async function getAuthenticatedSession(request, response, fetchImplementation = fetch) {
  const session = unseal(parseCookies(request)[SESSION_COOKIE]);
  if (!session || !session.accessToken || !session.user?.login || session.expiresAt <= Date.now()) {
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    return null;
  }

  if (!session.accessTokenExpiresAt || session.accessTokenExpiresAt > Date.now() + 60_000) {
    return session;
  }
  if (!session.refreshToken || session.refreshTokenExpiresAt <= Date.now()) {
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    return null;
  }

  const refreshed = await refreshAccessToken(session.refreshToken, fetchImplementation);
  const now = Date.now();
  const updated = {
    ...session,
    accessToken: refreshed.access_token,
    accessTokenExpiresAt: refreshed.expires_in ? now + refreshed.expires_in * 1000 : null,
    refreshToken: refreshed.refresh_token || session.refreshToken,
    refreshTokenExpiresAt: refreshed.refresh_token_expires_in
      ? now + refreshed.refresh_token_expires_in * 1000
      : session.refreshTokenExpiresAt,
    expiresAt: now + SESSION_DURATION_SECONDS * 1000,
  };
  response.setHeader(
    "Set-Cookie",
    createCookie(SESSION_COOKIE, seal(updated), SESSION_DURATION_SECONDS)
  );
  return updated;
}

async function refreshAccessToken(refreshToken, fetchImplementation) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub sign-in is not configured.");

  const response = await fetchImplementation(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) throw new Error("GitHub session refresh failed.");
  return data;
}

module.exports = { getAuthenticatedSession };
