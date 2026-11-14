const {
  STATE_COOKIE,
  RETURN_COOKIE,
  STATE_DURATION_SECONDS,
  createCookie,
  createOAuthState,
  setPrivateResponseHeaders,
} = require("./session-crypto.js");
const { normalizeReturnPath } = require("../../auth-context.js");

/**
 * marks an authorization the reader started in order to manage who they follow
 *
 * GitHub grants a GitHub App's user permissions as one set, so this suffix cannot
 * narrow what the token can do. What it records is intent: the reader arrived here
 * from the follow-management explanation rather than from ordinary sign-in, and
 * only a session carrying that intent is allowed to spend the write permission.
 */
const MANAGE_FOLLOWS_MARKER = "~follows";

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

  // The marker travels inside the state, which is echoed back by GitHub and
  // verified against the HttpOnly cookie before it is read. Nothing the browser
  // can set on its own reaches the session.
  const managingFollows = String(request.query?.manage || "") === "follows";
  const state = createOAuthState() + (managingFollows ? MANAGE_FOLLOWS_MARKER : "");
  const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("state", state);

  // Where the reader was when they chose to sign in, reduced to a same-origin
  // path naming only a profile, a result view, and the management view. It is
  // kept server-side in an HttpOnly cookie rather than sent to GitHub, and the
  // callback normalizes it again before redirecting, so neither a crafted link
  // nor an edited cookie can turn the redirect into one that leaves this site.
  const returnTo = normalizeReturnPath(request.query?.return) || "/";

  response.setHeader("Set-Cookie", [
    createCookie(STATE_COOKIE, state, STATE_DURATION_SECONDS),
    createCookie(RETURN_COOKIE, encodeURIComponent(returnTo), STATE_DURATION_SECONDS),
  ]);
  response.statusCode = 302;
  response.setHeader("Location", authorizationUrl.toString());
  response.end();
}

module.exports = githubAuthHandler;
module.exports.MANAGE_FOLLOWS_MARKER = MANAGE_FOLLOWS_MARKER;
