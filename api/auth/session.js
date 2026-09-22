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

  const session = unseal(parseCookies(request)[SESSION_COOKIE]);
  if (!session || !session.user?.login || session.expiresAt <= Date.now()) {
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    response.status(200).json({ authenticated: false });
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

module.exports = sessionHandler;
