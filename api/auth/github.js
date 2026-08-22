const {
  STATE_COOKIE,
  STATE_DURATION_SECONDS,
  createCookie,
  createOAuthState,
  setPrivateResponseHeaders,
} = require("./session-crypto.js");

function githubAuthHandler(request, response) {
  setPrivateResponseHeaders(response);
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const callbackUrl = process.env.GITHUB_APP_CALLBACK_URL;
  if (!clientId || !callbackUrl) {
    response.status(503).json({ error: "GitHub sign-in is not configured." });
    return;
  }

  const state = createOAuthState();
  const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("state", state);

  response.setHeader("Set-Cookie", createCookie(STATE_COOKIE, state, STATE_DURATION_SECONDS));
  response.statusCode = 302;
  response.setHeader("Location", authorizationUrl.toString());
  response.end();
}

module.exports = githubAuthHandler;
