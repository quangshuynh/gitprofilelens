const {
  SESSION_COOKIE,
  STATE_COOKIE,
  RETURN_COOKIE,
  SESSION_DURATION_SECONDS,
  parseCookies,
  seal,
  unseal,
  createCookie,
  clearCookie,
  stateMatches,
  setPrivateResponseHeaders,
} = require("./session-crypto.js");
const { MANAGE_FOLLOWS_MARKER } = require("./github.js");
const { normalizeReturnPath } = require("../../auth-context.js");

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

/**
 * finishes a GitHub authorization and returns the reader to where they started
 *
 * Every outcome a reader can reach ends in a redirect back to the page they
 * left, carrying exactly one word in `auth=` that says what happened:
 *
 *   success         ordinary sign-in completed
 *   manage-follows  the follow-management authorization completed
 *   denied          the reader cancelled on GitHub; nothing changed
 *   error           GitHub could not complete the exchange; nothing changed
 *   invalid         the request could not be verified as one this site started
 *
 * Only success and manage-follows issue a session. The others leave whatever
 * session already existed exactly as it was, so cancelling a follow-management
 * request never signs the reader out.
 *
 * @param {Object} request vercel request
 * @param {Object} response vercel response
 * @returns {Promise<void>} no return value
 */
async function githubCallbackHandler(request, response) {
  setPrivateResponseHeaders(response);
  // Both one-time cookies are spent by any visit here, whatever the outcome.
  const spent = [clearCookie(STATE_COOKIE), clearCookie(RETURN_COOKIE)];
  response.setHeader("Set-Cookie", spent);
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const cookies = parseCookies(request);
  const returnTo = readReturnDestination(cookies[RETURN_COOKIE]);
  const code = String(request.query?.code || "");
  const state = String(request.query?.state || "");
  const githubError = String(request.query?.error || "");

  // The state is checked before anything else is believed, including GitHub's
  // report that the reader cancelled: an unverified error is not evidence of
  // anything this site asked for.
  if (!stateMatches(cookies[STATE_COOKIE], state)) {
    redirectWithOutcome(response, returnTo, "invalid");
    return;
  }
  if (githubError) {
    redirectWithOutcome(response, returnTo, githubError === "access_denied" ? "denied" : "error");
    return;
  }
  if (!code) {
    redirectWithOutcome(response, returnTo, "invalid");
    return;
  }

  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  const callbackUrl = process.env.GITHUB_APP_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    response.status(503).json({ error: "GitHub sign-in is not configured." });
    return;
  }

  // Read from the cookie, which is HttpOnly and was just proven equal to what
  // GitHub echoed back, rather than from the query the browser could have edited.
  const managingFollows = String(cookies[STATE_COOKIE]).endsWith(MANAGE_FOLLOWS_MARKER);

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
      // Never inferred and never defaulted on: an ordinary sign-in leaves this
      // false, so the unfollow endpoint refuses that session outright. The one
      // exception is a still-valid session for this same account that already
      // carried it, so signing in again does not silently withdraw a permission
      // the reader granted minutes ago.
      manageFollows: managingFollows || keepsFollowPermission(cookies[SESSION_COOKIE], user.login, now),
      expiresAt: now + SESSION_DURATION_SECONDS * 1000,
    };
    response.setHeader("Set-Cookie", [
      ...spent,
      createCookie(SESSION_COOKIE, seal(session), SESSION_DURATION_SECONDS),
    ]);
    redirectWithOutcome(response, returnTo, managingFollows ? "manage-follows" : "success");
  } catch {
    redirectWithOutcome(response, returnTo, "error");
  }
}

/**
 * reads the stored return destination, falling back to the homepage
 * @param {string|undefined} value raw cookie value
 * @returns {string} a same-origin path
 */
function readReturnDestination(value) {
  try {
    return normalizeReturnPath(decodeURIComponent(value || "")) || "/";
  } catch {
    return "/";
  }
}

/**
 * redirects to a same-origin destination with the authorization outcome appended
 * @param {Object} response vercel response
 * @param {string} destination normalized same-origin path
 * @param {string} outcome one of the documented outcomes
 * @returns {void} no return value
 */
function redirectWithOutcome(response, destination, outcome) {
  response.statusCode = 302;
  response.setHeader("Location", `${destination}${destination.includes("?") ? "&" : "?"}auth=${outcome}`);
  response.end();
}

/**
 * reports whether an existing session already carried follow permission for this account
 * @param {string|undefined} sealedSession existing session cookie
 * @param {string} login account that just signed in
 * @param {number} now current time
 * @returns {boolean} true only for an unexpired session of the same account
 */
function keepsFollowPermission(sealedSession, login, now) {
  const previous = unseal(sealedSession);
  return Boolean(
    previous &&
    previous.manageFollows === true &&
    previous.expiresAt > now &&
    String(previous.user?.login || "").toLowerCase() === String(login).toLowerCase()
  );
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
