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

function returnCookie(destination) {
  return encodeURIComponent(destination);
}

function assertNoSessionIssued(result) {
  const cookies = [].concat(result.headers["Set-Cookie"] || []);
  for (const cookie of cookies) {
    // Clearing the one-time cookies is expected; issuing or clearing a session is not.
    assert.doesNotMatch(cookie, /^gpl_session=/, `unexpected session cookie: ${cookie}`);
  }
}

function successfulGitHub(login = "example") {
  return async (url) => {
    if (url === "https://github.com/login/oauth/access_token") {
      return { ok: true, json: async () => ({ access_token: "github-user-access-token", expires_in: 28800 }) };
    }
    if (url === "https://api.github.com/user") {
      return { ok: true, json: async () => ({ login, avatar_url: `https://avatars.example/${login}.png` }) };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

const APP_ENVIRONMENT = {
  GITHUB_APP_CLIENT_ID: "client-id",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_CALLBACK_URL: "https://example.com/api/auth/callback",
  SESSION_SECRET: "a-test-session-secret-that-is-longer-than-32-characters",
};

async function runCallback({ query, cookie }) {
  const { response, result } = createResponse();
  await callbackHandler({ method: "GET", query, headers: { cookie } }, response);
  return result;
}

function readSession(result) {
  const sealed = cookieValue(result.headers["Set-Cookie"], "gpl_session");
  const session = createResponse();
  sessionHandler({ method: "GET", headers: { cookie: `gpl_session=${sealed}` } }, session.response);
  return session.result.body;
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
    const stateCookie = first.result.headers["Set-Cookie"].find((cookie) => cookie.startsWith("gpl_oauth_state="));
    assert.match(stateCookie, /HttpOnly/);
    assert.match(stateCookie, /SameSite=Lax/);
    assert.equal(first.result.headers["Cache-Control"], "private, no-store, max-age=0");
  });
});

test("callback refuses missing or incorrect OAuth state and returns the reader with context", async () => {
  const { response, result } = createResponse();
  await callbackHandler({
    method: "GET",
    query: { code: "authorization-code", state: "wrong-state" },
    headers: { cookie: `gpl_oauth_state=expected-state; gpl_oauth_return=${returnCookie("/?user=octocat&view=network")}` },
  }, response);
  assert.equal(result.statusCode, 302);
  assert.equal(result.headers.Location, "/?user=octocat&view=network&auth=invalid");
  assertNoSessionIssued(result);
  assert.doesNotMatch(JSON.stringify(result.headers), /authorization-code|expected-state/);
});

test("callback with no code is refused as invalid", async () => {
  const { response, result } = createResponse();
  await callbackHandler({
    method: "GET",
    query: { state: "matching-state" },
    headers: { cookie: "gpl_oauth_state=matching-state" },
  }, response);
  assert.equal(result.statusCode, 302);
  assert.equal(result.headers.Location, "/?auth=invalid");
  assertNoSessionIssued(result);
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
        headers: { cookie: `gpl_oauth_state=matching-state; gpl_oauth_return=${returnCookie("/?user=octocat&view=audit")}` },
      }, response);
      assert.equal(result.statusCode, 302);
      assert.equal(result.headers.Location, "/?user=octocat&view=audit&auth=error");
      assertNoSessionIssued(result);
      assert.doesNotMatch(JSON.stringify(result.headers), /secret|bad-code|client-secret/);
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
        // Ordinary sign-in, so the write capability is withheld.
        can_manage_follows: false,
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
      // A session that never went through the follow-management authorization is
      // reported as unable to manage follows, not merely left unmentioned.
      can_manage_follows: false,
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
    // A cookie was presented and is no longer usable, which the reader is told
    // apart from never having signed in.
    assert.deepEqual(result.body, { authenticated: false, expired: true });
    assert.match(result.headers["Set-Cookie"], /^gpl_session=;/);
  });
});

test("logout clears authentication state", () => {
  const { response, result } = createResponse();
  logoutHandler({ method: "POST", headers: {} }, response);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { authenticated: false });
  assert.equal(result.headers["Set-Cookie"].length, 3);
  assert.match(result.headers["Set-Cookie"].join(" "), /gpl_session=;.*Max-Age=0/);
  assert.match(result.headers["Set-Cookie"].join(" "), /gpl_oauth_state=;.*Max-Age=0/);
  assert.match(result.headers["Set-Cookie"].join(" "), /gpl_oauth_return=;.*Max-Age=0/);
});

/* --------------------------------------------------------------------------
 * Returning the reader to where they started
 * ------------------------------------------------------------------------ */

test("authentication start stores a normalized same-origin return destination", async () => {
  await withEnvironment(APP_ENVIRONMENT, () => {
    const { response, result } = createResponse();
    authStartHandler({
      method: "GET",
      query: { return: "/?user=octocat&view=network&manage=unfollows&auth=success&code=leak" },
      headers: {},
    }, response);
    const cookies = result.headers["Set-Cookie"];
    const stored = cookies.find((cookie) => cookie.startsWith("gpl_oauth_return="));
    assert.match(stored, /HttpOnly/);
    assert.match(stored, /SameSite=Lax/);
    assert.match(stored, /Max-Age=600/);
    assert.equal(
      decodeURIComponent(cookieValue(cookies, "gpl_oauth_return")),
      "/?user=octocat&view=network&manage=unfollows"
    );
    // The destination never travels to GitHub.
    assert.doesNotMatch(result.headers.Location, /octocat|unfollows/);
  });
});

test("an external or malformed return destination falls back to the homepage", async () => {
  await withEnvironment(APP_ENVIRONMENT, () => {
    for (const hostile of ["https://evil.test/", "//evil.test", "/\\evil.test", "javascript:alert(1)"]) {
      const { response, result } = createResponse();
      authStartHandler({ method: "GET", query: { return: hostile }, headers: {} }, response);
      assert.equal(decodeURIComponent(cookieValue(result.headers["Set-Cookie"], "gpl_oauth_return")), "/", hostile);
    }
  });
});

test("a successful sign-in returns to the stored destination", async () => {
  const originalFetch = global.fetch;
  global.fetch = successfulGitHub();
  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const result = await runCallback({
        query: { code: "valid-code", state: "matching-state" },
        cookie: `gpl_oauth_state=matching-state; gpl_oauth_return=${returnCookie("/?user=octocat&view=network")}`,
      });
      assert.equal(result.statusCode, 302);
      assert.equal(result.headers.Location, "/?user=octocat&view=network&auth=success");
      // Both one-time cookies are spent.
      assert.match(result.headers["Set-Cookie"].join(" "), /gpl_oauth_state=;.*Max-Age=0/);
      assert.match(result.headers["Set-Cookie"].join(" "), /gpl_oauth_return=;.*Max-Age=0/);
      assert.equal(readSession(result).can_manage_follows, false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a follow-management authorization returns straight to Manage unfollows", async () => {
  const originalFetch = global.fetch;
  global.fetch = successfulGitHub();
  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const result = await runCallback({
        query: { code: "valid-code", state: "matching-state~follows" },
        cookie: "gpl_oauth_state=matching-state~follows; " +
          `gpl_oauth_return=${returnCookie("/?user=example&view=network&manage=unfollows")}`,
      });
      assert.equal(result.headers.Location, "/?user=example&view=network&manage=unfollows&auth=manage-follows");
      assert.equal(readSession(result).can_manage_follows, true);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a tampered return cookie cannot redirect anywhere else", async () => {
  const originalFetch = global.fetch;
  global.fetch = successfulGitHub();
  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const result = await runCallback({
        query: { code: "valid-code", state: "matching-state" },
        cookie: `gpl_oauth_state=matching-state; gpl_oauth_return=${returnCookie("https://evil.test/steal")}`,
      });
      assert.equal(result.headers.Location, "/?auth=success");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("cancelling on GitHub returns with context and changes no session", async () => {
  const originalFetch = global.fetch;
  let requested = false;
  global.fetch = async () => {
    requested = true;
    throw new Error("no request should be made");
  };
  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const result = await runCallback({
        query: {
          error: "access_denied",
          error_description: "The user has denied your application access.",
          state: "matching-state~follows",
        },
        cookie: "gpl_oauth_state=matching-state~follows; gpl_session=existing-session; " +
          `gpl_oauth_return=${returnCookie("/?user=example&view=network&manage=unfollows")}`,
      });
      assert.equal(result.statusCode, 302);
      assert.equal(result.headers.Location, "/?user=example&view=network&manage=unfollows&auth=denied");
      assertNoSessionIssued(result);
      assert.equal(requested, false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a GitHub error with a forged state is reported as invalid, not as a cancellation", async () => {
  await withEnvironment(APP_ENVIRONMENT, async () => {
    const result = await runCallback({
      query: { error: "access_denied", state: "forged" },
      cookie: "gpl_oauth_state=real-state",
    });
    assert.equal(result.headers.Location, "/?auth=invalid");
    assertNoSessionIssued(result);
  });
});

test("a failed user lookup after a token exchange is an error, not a sign-in", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url === "https://github.com/login/oauth/access_token") {
      return { ok: true, json: async () => ({ access_token: "github-user-access-token" }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const result = await runCallback({
        query: { code: "valid-code", state: "matching-state" },
        cookie: "gpl_oauth_state=matching-state",
      });
      assert.equal(result.headers.Location, "/?auth=error");
      assertNoSessionIssued(result);
      assert.doesNotMatch(JSON.stringify(result.headers), /github-user-access-token/);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("signing in again keeps a still-valid follow permission for the same account only", async () => {
  const originalFetch = global.fetch;
  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const existing = seal({
        accessToken: "old-token",
        expiresAt: Date.now() + 60_000,
        user: { login: "Example", avatar_url: "https://avatars.example/example.png" },
        manageFollows: true,
      });

      global.fetch = successfulGitHub("example");
      const same = await runCallback({
        query: { code: "valid-code", state: "plain-state" },
        cookie: `gpl_oauth_state=plain-state; gpl_session=${existing}`,
      });
      assert.equal(readSession(same).can_manage_follows, true, "same account keeps it");

      global.fetch = successfulGitHub("someone-else");
      const other = await runCallback({
        query: { code: "valid-code", state: "plain-state" },
        cookie: `gpl_oauth_state=plain-state; gpl_session=${existing}`,
      });
      assert.equal(readSession(other).can_manage_follows, false, "another account never inherits it");

      const expired = seal({
        accessToken: "old-token",
        expiresAt: Date.now() - 1,
        user: { login: "example", avatar_url: "https://avatars.example/example.png" },
        manageFollows: true,
      });
      global.fetch = successfulGitHub("example");
      const stale = await runCallback({
        query: { code: "valid-code", state: "plain-state" },
        cookie: `gpl_oauth_state=plain-state; gpl_session=${expired}`,
      });
      assert.equal(readSession(stale).can_manage_follows, false, "an expired session grants nothing");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a session whose access cannot be renewed is reported as expired", async () => {
  await withEnvironment({ SESSION_SECRET: APP_ENVIRONMENT.SESSION_SECRET }, () => {
    const unrenewable = seal({
      accessToken: "expired-access",
      accessTokenExpiresAt: Date.now() - 1_000,
      refreshToken: "expired-refresh",
      refreshTokenExpiresAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000,
      user: { login: "example", avatar_url: "https://avatars.example/example.png" },
    });
    const { response, result } = createResponse();
    sessionHandler({ method: "GET", headers: { cookie: `gpl_session=${unrenewable}` } }, response);
    assert.deepEqual(result.body, { authenticated: false, expired: true });
  });
});

test("a visitor with no session cookie is simply signed out", () => {
  const { response, result } = createResponse();
  sessionHandler({ method: "GET", headers: {} }, response);
  assert.deepEqual(result.body, { authenticated: false });
});
