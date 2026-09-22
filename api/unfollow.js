const { randomUUID } = require("node:crypto");
const { getAuthenticatedSession } = require("./auth/authenticated-session.js");
const {
  SESSION_COOKIE,
  clearCookie,
  setPrivateResponseHeaders,
} = require("./auth/session-crypto.js");

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_REQUEST_TIMEOUT_MS = 5_000;
// GitHub's own rule for a login: alphanumerics and single hyphens, 39 at most.
const USERNAME_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

/**
 * unfollows exactly one github account as the signed-in user
 *
 * This is the only endpoint in GitProfileLens that changes anything on GitHub, and
 * it is deliberately the narrowest shape that can do the job: one login per
 * request, read from the body, with the acting identity taken from the sealed
 * session rather than from anything the browser sent. There is no path parameter
 * that could name another GitHub route, no token parameter, and no batch form, so
 * the endpoint cannot be turned into a general GitHub proxy or into a bulk
 * unfollow tool by a caller that happens to have the URL.
 *
 * The contract it implements, from GitHub's REST documentation for followers:
 *
 *   GET    /user/following/{username}   204 followed, 404 not followed
 *   DELETE /user/following/{username}   204 on success
 *
 * Both need the GitHub App "Followers" account permission, the DELETE at write
 * level. A classic OAuth token would instead need the `user:follow` scope, which
 * GitProfileLens does not use.
 *
 * The read runs first so a stale page cannot be reported as a fresh unfollow:
 * DELETE answers 204 whether or not the follow existed, so without the read those
 * two outcomes would be indistinguishable. It also costs one rate-limit point
 * against the five a DELETE costs, and it surfaces a missing permission without
 * changing anything.
 *
 * @param {Object} request vercel request
 * @param {Object} response vercel response
 * @returns {Promise<void>} no return value
 */
async function unfollowHandler(request, response) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  setPrivateResponseHeaders(response);

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }
  if (!hasSameOriginRequest(request)) {
    logDiagnostic("origin_rejected", { requestId });
    response.status(403).json({ error: "This request did not come from GitProfileLens." });
    return;
  }

  const login = readTargetLogin(request.body);
  if (!login) {
    logDiagnostic("invalid_target", { requestId });
    response.status(400).json({ error: "That is not a valid GitHub username." });
    return;
  }

  let session;
  try {
    session = await getAuthenticatedSession(request, response);
  } catch (error) {
    logDiagnostic("session_error", { requestId, error: error?.name || "Error" });
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    response.status(401).json({ error: "Your GitHub session expired. Please sign in again." });
    return;
  }
  if (!session) {
    logDiagnostic("session_invalid", { requestId });
    response.status(401).json({ error: "Sign in with GitHub to manage who you follow." });
    return;
  }
  // The permission comes from an authorization the reader passed through
  // knowingly. A session that never went through it is refused here, before any
  // GitHub request, so an ordinary read-only sign-in cannot change a follow.
  if (session.manageFollows !== true) {
    logDiagnostic("permission_missing", { requestId });
    response.status(403).json({
      error: "Managing follows needs permission to change who you follow.",
      reason: "permission_required",
    });
    return;
  }
  // GitHub cannot follow you to yourself, and asking would spend a request to
  // learn it.
  if (login.toLowerCase() === String(session.user.login).toLowerCase()) {
    logDiagnostic("invalid_target", { requestId, reason: "self" });
    response.status(400).json({ error: "You cannot unfollow your own account." });
    return;
  }

  const path = `/user/following/${encodeURIComponent(login)}`;
  try {
    const following = await requestGitHub("GET", path, session.accessToken);
    if (following.status === 404) {
      logDiagnostic("already_not_following", {
        requestId,
        target: login,
        elapsed_ms: Date.now() - startedAt,
      });
      response.status(200).json({
        login,
        state: "already_not_following",
        message: `You were no longer following @${login}.`,
      });
      return;
    }
    if (following.status !== 204) {
      respondToGitHubFailure(response, following, requestId, login, startedAt);
      return;
    }

    const removed = await requestGitHub("DELETE", path, session.accessToken);
    if (removed.status !== 204) {
      respondToGitHubFailure(response, removed, requestId, login, startedAt);
      return;
    }

    logDiagnostic("unfollowed", { requestId, target: login, elapsed_ms: Date.now() - startedAt });
    response.status(200).json({
      login,
      state: "unfollowed",
      message: `Unfollowed @${login}.`,
    });
  } catch (error) {
    logDiagnostic("github_unreachable", {
      requestId,
      target: login,
      reason: error?.failureType || "network",
      elapsed_ms: Date.now() - startedAt,
    });
    response.status(502).json({
      error: "GitHub could not be reached. Nothing was changed.",
      reason: "github_unavailable",
    });
  }
}

/**
 * translates a refusal from github into one the reader can act on
 *
 * Every branch leaves the relationship exactly as GitHub has it, and says so. The
 * one thing this must never do is report a refusal as a completed unfollow.
 *
 * @param {Object} response vercel response
 * @param {Object} result github result carrying status and headers
 * @param {string} requestId diagnostic correlation id
 * @param {string} login target login
 * @param {number} startedAt handler start time
 * @returns {void} no return value
 */
function respondToGitHubFailure(response, result, requestId, login, startedAt) {
  const details = {
    requestId,
    target: login,
    github_status: result.status,
    elapsed_ms: Date.now() - startedAt,
  };

  if (result.status === 401) {
    logDiagnostic("github_unauthorized", details);
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    response.status(401).json({
      error: "Your GitHub authorization is no longer valid. Please sign in again.",
      reason: "session_expired",
    });
    return;
  }
  if (result.status === 403 || result.status === 429) {
    if (isRateLimited(result)) {
      logDiagnostic("github_rate_limit", details);
      response.status(429).json({
        error: `GitHub is rate limiting this account.${describeRetry(result)} ` +
          `@${login} was not unfollowed.`,
        reason: "rate_limited",
      });
      return;
    }
    logDiagnostic("github_forbidden", details);
    response.status(403).json({
      error: "GitHub refused this change. GitProfileLens may no longer have permission " +
        "to manage who you follow.",
      reason: "permission_required",
    });
    return;
  }
  if (result.status === 404) {
    logDiagnostic("github_not_found", details);
    response.status(404).json({
      error: `GitHub has no account named @${login}.`,
      reason: "unknown_account",
    });
    return;
  }

  logDiagnostic("github_unexpected", details);
  response.status(502).json({
    error: `GitHub answered unexpectedly. @${login} was not unfollowed.`,
    reason: "github_unavailable",
  });
}

/**
 * reads a target login from a request body, accepting nothing else
 *
 * The body may only name who to unfollow. It cannot name who is acting, which
 * identity to act as, or which token to use: those come from the sealed session
 * and are never read from the browser.
 *
 * @param {*} body parsed or raw request body
 * @returns {string|null} a syntactically valid login, or null
 */
function readTargetLogin(body) {
  let parsed = body;
  if (Buffer.isBuffer(parsed)) parsed = parsed.toString("utf8");
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const login = typeof parsed.login === "string" ? parsed.login.trim() : "";
  return USERNAME_PATTERN.test(login) ? login : null;
}

/**
 * checks that a mutating request came from this deployment's own pages
 *
 * The session cookie is already SameSite=Lax, which keeps a cross-site form post
 * from carrying it. This is the second lock: an Origin that is present and does
 * not match the host the request arrived on is refused outright.
 *
 * @param {Object} request vercel request
 * @returns {boolean} true when the request may proceed
 */
function hasSameOriginRequest(request) {
  const host = request.headers?.host;
  const origin = request.headers?.origin;
  if (!host) return false;
  // A browser always sends Origin on a cross-origin POST, so an absent one means a
  // same-origin fetch or a caller that has no cookie to borrow in the first place.
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * reports whether a github refusal was a rate limit rather than a permission
 * @param {Object} result github result carrying status and headers
 * @returns {boolean} true when github rate limited the request
 */
function isRateLimited(result) {
  if (result.status === 429) return true;
  return result.headers?.get?.("x-ratelimit-remaining") === "0" ||
    Boolean(result.headers?.get?.("retry-after"));
}

/**
 * turns github's retry headers into one sentence, without exposing the headers
 * @param {Object} result github result carrying headers
 * @returns {string} a sentence naming when to try again
 */
function describeRetry(result) {
  const retryAfter = Number(result.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    return ` Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  const reset = Number(result.headers?.get?.("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    return ` Try again after ${new Date(reset * 1000).toISOString()}.`;
  }
  return " Try again in a few minutes.";
}

/**
 * makes one github request, never retrying a write
 *
 * A failed DELETE is not retried here. GitHub counts a write against a secondary
 * limit of 80 content-generating requests a minute, and a retry the reader did not
 * ask for is exactly the automated follow activity this feature is built not to
 * be. The reader retries, or nothing does.
 *
 * @param {string} method http method
 * @param {string} path github api path
 * @param {string} token session access token
 * @param {Function} fetchImplementation fetch implementation to use
 * @returns {Promise<Object>} status and headers of the github response
 */
async function requestGitHub(method, path, token, fetchImplementation = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(`${GITHUB_API_URL}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        // GitHub documents a zero Content-Length for these bodyless writes.
        "Content-Length": "0",
        "User-Agent": "gitprofilelens",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    return { status: response.status, headers: response.headers };
  } catch (cause) {
    const error = new Error("GitHub could not be reached.");
    error.failureType = cause?.name === "AbortError" ? "timeout" : "network";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * records one sanitized diagnostic line
 *
 * A target login is public and is kept, because a failure nobody can attribute to
 * an account is not diagnosable. Nothing that could act as the reader is logged:
 * no token, no cookie, no authorization header, no oauth code.
 *
 * @param {string} event diagnostic event name
 * @param {Object} details sanitized details
 * @returns {void} no return value
 */
function logDiagnostic(event, details) {
  console.info(JSON.stringify({ component: "unfollow", event, ...details }));
}

module.exports = unfollowHandler;
module.exports.readTargetLogin = readTargetLogin;
module.exports.hasSameOriginRequest = hasSameOriginRequest;
