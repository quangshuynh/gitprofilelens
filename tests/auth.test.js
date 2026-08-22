const test = require("node:test");
const assert = require("node:assert/strict");
const authStartHandler = require("../api/auth/github.js");
const callbackHandler = require("../api/auth/callback.js");
const sessionHandler = require("../api/auth/session.js");
const logoutHandler = require("../api/auth/logout.js");
const { seal } = require("../api/auth/session-crypto.js");

function createResponse() {
  const result = { status: null, statusCode: null, body: null, headers: {}, ended: false };
  const response = {
    setHeader(name, value) { result.headers[name] = value; },
    status(statusCode) { result.status = statusCode; return response; },
    json(body) { result.body = body; },
    end() { result.ended = true; },
    set statusCode(value) { result.statusCode = value; },
    get statusCode() { return result.statusCode; },
  };
  return { response, result };
}

function withEnvironment(values, callback) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return Promise.resolve(callback()).finally(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function cookieValue(setCookie, name) {
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match?.split(";")[0].slice(name.length + 1) || "";
}

test("authentication start establishes unpredictable state and redirects to GitHub", async () => {
  await withEnvironment({
    GITHUB_APP_CLIENT_ID: "client-id",
    GITHUB_APP_CALLBACK_URL: "https://example.com/api/auth/callback",
  }, () => {
    const first = createResponse();
    const second = createResponse();
    authStartHandler({ method: "GET", headers: {} }, first.response);
    authStartHandler({ method: "GET", headers: {} }, second.response);

    const firstState = cookieValue(first.result.headers["Set-Cookie"], "gpl_oauth_state");
    const secondState = cookieValue(second.result.headers["Set-Cookie"], "gpl_oauth_state");
    const location = new URL(first.result.headers.Location);
    assert.equal(first.result.statusCode, 302);
    assert.equal(location.origin, "https://github.com");
    assert.equal(location.pathname, "/login/oauth/authorize");
    assert.equal(location.searchParams.get("client_id"), "client-id");
    assert.equal(location.searchParams.get("state"), firstState);
    assert.notEqual(firstState, secondState);
    assert.match(first.result.headers["Set-Cookie"], /HttpOnly/);
    assert.match(first.result.headers["Set-Cookie"], /SameSite=Lax/);
    assert.equal(first.result.headers["Cache-Control"], "private, no-store, max-age=0");
  });
});

test("callback rejects missing or incorrect OAuth state", async () => {
  const { response, result } = createResponse();
  await callbackHandler({
    method: "GET",
    query: { code: "authorization-code", state: "wrong-state" },
    headers: { cookie: "gpl_oauth_state=expected-state" },
  }, response);
  assert.equal(result.status, 400);
  assert.match(result.body.error, /could not be verified/i);
  assert.doesNotMatch(JSON.stringify(result.body), /authorization-code|expected-state/);
});

test("callback translates GitHub token exchange failures without leaking details", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "bad_verification_code", access_token: "secret" }) });
  try {
    await withEnvironment({
      GITHUB_APP_CLIENT_ID: "client-id",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_CALLBACK_URL: "https://example.com/api/auth/callback",
    }, async () => {
      const { response, result } = createResponse();
      await callbackHandler({
        method: "GET",
        query: { code: "bad-code", state: "matching-state" },
        headers: { cookie: "gpl_oauth_state=matching-state" },
      }, response);
      assert.equal(result.status, 502);
      assert.deepEqual(result.body, { error: "GitHub sign-in failed. Please try again." });
      assert.doesNotMatch(JSON.stringify(result.body), /secret|bad-code|client-secret/);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("successful callback stores credentials only in an encrypted HttpOnly session", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url === "https://github.com/login/oauth/access_token") {
      return {
        ok: true,
        json: async () => ({
          access_token: "github-user-access-token",
          expires_in: 28800,
          refresh_token: "github-user-refresh-token",
          refresh_token_expires_in: 15897600,
        }),
      };
    }
    if (url === "https://api.github.com/user") {
      return {
        ok: true,
        json: async () => ({ login: "example", avatar_url: "https://avatars.example/example.png" }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    await withEnvironment({
      GITHUB_APP_CLIENT_ID: "client-id",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_CALLBACK_URL: "https://example.com/api/auth/callback",
      SESSION_SECRET: "a-test-session-secret-that-is-longer-than-32-characters",
      VERCEL_ENV: "production",
    }, async () => {
      const { response, result } = createResponse();
      await callbackHandler({
        method: "GET",
        query: { code: "valid-code", state: "matching-state" },
        headers: { cookie: "gpl_oauth_state=matching-state" },
      }, response);

      assert.equal(result.statusCode, 302);
      assert.equal(result.headers.Location, "/?auth=success");
      const cookies = result.headers["Set-Cookie"];
      const sessionCookie = cookies.find((cookie) => cookie.startsWith("gpl_session="));
      assert.match(sessionCookie, /HttpOnly/);
      assert.match(sessionCookie, /Secure/);
      assert.match(sessionCookie, /SameSite=Lax/);
      assert.doesNotMatch(sessionCookie, /github-user-access-token|github-user-refresh-token/);

      const sessionValue = cookieValue(cookies, "gpl_session");
      const sessionResponse = createResponse();
      sessionHandler({ method: "GET", headers: { cookie: `gpl_session=${sessionValue}` } }, sessionResponse.response);
      assert.deepEqual(sessionResponse.result.body, {
        authenticated: true,
        user: { login: "example", avatar_url: "https://avatars.example/example.png" },
      });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("session endpoint returns safe identity and never exposes credentials", async () => {
  await withEnvironment({ SESSION_SECRET: "a-test-session-secret-that-is-longer-than-32-characters" }, () => {
    const session = seal({
      accessToken: "github-access-token",
      refreshToken: "github-refresh-token",
      expiresAt: Date.now() + 60_000,
      user: { login: "example", avatar_url: "https://avatars.example/example.png" },
    });
    const { response, result } = createResponse();
    sessionHandler({ method: "GET", headers: { cookie: `gpl_session=${session}` } }, response);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      authenticated: true,
      user: { login: "example", avatar_url: "https://avatars.example/example.png" },
    });
    assert.doesNotMatch(JSON.stringify(result.body), /token|secret|credential/i);
    assert.equal(result.headers["Cache-Control"], "private, no-store, max-age=0");
  });
});

test("invalid or expired sessions are treated as unauthenticated", async () => {
  await withEnvironment({ SESSION_SECRET: "a-test-session-secret-that-is-longer-than-32-characters" }, () => {
    const expired = seal({
      accessToken: "expired-token",
      expiresAt: Date.now() - 1,
      user: { login: "example", avatar_url: "https://avatars.example/example.png" },
    });
    const { response, result } = createResponse();
    sessionHandler({ method: "GET", headers: { cookie: `gpl_session=${expired}` } }, response);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { authenticated: false });
    assert.match(result.headers["Set-Cookie"], /^gpl_session=;/);
  });
});

test("logout clears authentication state", () => {
  const { response, result } = createResponse();
  logoutHandler({ method: "POST", headers: {} }, response);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { authenticated: false });
  assert.equal(result.headers["Set-Cookie"].length, 2);
  assert.match(result.headers["Set-Cookie"].join(" "), /gpl_session=;.*Max-Age=0/);
  assert.match(result.headers["Set-Cookie"].join(" "), /gpl_oauth_state=;.*Max-Age=0/);
});
