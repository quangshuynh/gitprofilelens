const {
  SESSION_COOKIE,
  parseCookies,
  unseal,
  clearCookie,
  setPrivateResponseHeaders,
} = require("./session-crypto.js");

function sessionHandler(request, response) {
  setPrivateResponseHeaders(response);
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const presented = parseCookies(request)[SESSION_COOKIE];
  const session = unseal(presented);
  if (!session || !session.user?.login || session.expiresAt <= Date.now() || !canStillAct(session)) {
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    // A reader who presented a session that is no longer usable is told so,
    // which lets the interface say "sign in again" rather than presenting them
    // as someone who was never signed in. No reason beyond that is disclosed.
    response.status(200).json(presented ? { authenticated: false, expired: true } : { authenticated: false });
    return;
  }

  response.status(200).json({
    authenticated: true,
    user: { login: session.user.login, avatar_url: session.user.avatar_url },
    // A capability flag, not a credential. The browser learns whether this session
    // may change follows; it never learns anything it could change them with.
    can_manage_follows: session.manageFollows === true,
  });
}

/**
 * reports whether the sealed GitHub access can still be used or renewed
 *
 * Mirrors the rule authenticated-session.js applies before every GitHub request,
 * so the browser is never told it is signed in on the strength of a token the
 * server would refuse to use.
 *
 * @param {Object} session unsealed session
 * @returns {boolean} true when the access token is current or renewable
 */
function canStillAct(session) {
  if (!session.accessTokenExpiresAt || session.accessTokenExpiresAt > Date.now()) return true;
  return Boolean(session.refreshToken) && session.refreshTokenExpiresAt > Date.now();
}

module.exports = sessionHandler;
