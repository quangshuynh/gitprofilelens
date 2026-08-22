const {
  SESSION_COOKIE,
  STATE_COOKIE,
  clearCookie,
  setPrivateResponseHeaders,
} = require("./session-crypto.js");

function logoutHandler(request, response) {
  setPrivateResponseHeaders(response);
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  response.setHeader("Set-Cookie", [clearCookie(SESSION_COOKIE), clearCookie(STATE_COOKIE)]);
  response.status(200).json({ authenticated: false });
}

module.exports = logoutHandler;
