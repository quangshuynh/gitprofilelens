const test = require("node:test");
const assert = require("node:assert/strict");
const unfollowHandler = require("../api/unfollow.js");
const authStartHandler = require("../api/auth/github.js");
const callbackHandler = require("../api/auth/callback.js");
const sessionHandler = require("../api/auth/session.js");
const { seal } = require("../api/auth/session-crypto.js");

// Nothing here reaches GitHub. Every test installs its own fetch, so the suite can
// be run anywhere, any number of times, without a single real relationship
// changing. The GitHub boundary being mocked is the point: an endpoint whose only
// job is to mutate must never be verified by mutating.
//
// The contract being modelled, from GitHub's REST documentation for followers:
//
//   GET    /user/following/{username}   204 followed, 404 not followed
//   DELETE /user/following/{username}   204 on success, 401/403/404 otherwise
//
// Both need the GitHub App "Followers" account permission, the DELETE at write
// level. Secondary rate limiting arrives as 403 or 429 with retry-after or an
// exhausted x-ratelimit-remaining.

const SESSION_SECRET = "a-test-session-secret-that-is-longer-than-32-characters";
const APP_ENVIRONMENT = {
  GITHUB_APP_CLIENT_ID: "client-id",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_CALLBACK_URL: "https://example.com/api/auth/callback",
  SESSION_SECRET,
};

// Sealing a test session needs the secret before the handler is ever called, so
// it is set for the whole file rather than only around each handler call.
let previousSecret;
test.before(() => {
  previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SESSION_SECRET;
});
test.after(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

/**
 * captures what a handler did to a vercel-shaped response
 * @returns {Object} the response object and a record of what reached it
 */
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

/**
 * runs a callback with environment variables set, then restores them
 * @param {Object} values variables to set for the callback
 * @param {Function} callback work to run
 * @returns {Promise<*>} the callback's result
 */
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

/**
 * builds a sealed session cookie header
 * @param {Object} overrides session fields to override
 * @returns {string} cookie header value
 */
function sessionCookie(overrides = {}) {
  return `gpl_session=${seal({
    accessToken: "github-user-access-token",
    accessTokenExpiresAt: null,
    refreshToken: null,
    user: { login: "example", avatar_url: "https://avatars.example/example.png" },
    manageFollows: true,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  })}`;
}

/**
 * builds a request in the shape the handler expects
 * @param {Object} overrides request fields to override
 * @returns {Object} request object
 */
function unfollowRequest(overrides = {}) {
  const { headers, ...rest } = overrides;
  return {
    method: "POST",
    body: { login: "octocat" },
    headers: { host: "example.com", origin: "https://example.com", ...headers },
    ...rest,
  };
}

/**
 * installs a fetch that answers the followers endpoints from a script
 *
 * Returns the calls it received so a test can assert not only what came back but
 * how many requests were spent getting there.
 *
 * @param {Object} script status and headers per method
 * @returns {Object} recorded calls and a restore function
 */
function mockGitHub(script) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method, authorization: options.headers?.Authorization });
    const entry = script[method];
    if (!entry) throw new Error(`Unexpected ${method} ${url}`);
    if (entry.throws) throw Object.assign(new Error("boom"), { name: entry.throws });
    return {
      status: entry.status,
      headers: { get: (name) => entry.headers?.[name.toLowerCase()] ?? null },
    };
  };
  return { calls, restore: () => { global.fetch = originalFetch; } };
}

/**
 * runs the handler against a mocked GitHub and returns everything observable
 * @param {Object} script github responses per method
 * @param {Object} overrides request overrides
 * @returns {Promise<Object>} response result and recorded github calls
 */
async function callUnfollow(script, overrides = {}) {
  const github = mockGitHub(script);
  try {
    return await withEnvironment(APP_ENVIRONMENT, async () => {
      const { response, result } = createResponse();
      await unfollowHandler(unfollowRequest(overrides), response);
      return { result, calls: github.calls };
    });
  } finally {
    github.restore();
  }
}

test("an unauthenticated request cannot unfollow anyone", async () => {
  const { result, calls } = await callUnfollow({}, { headers: { cookie: "" } });

  assert.equal(result.status, 401);
  assert.match(result.body.error, /Sign in with GitHub/);
  // Refused before GitHub was asked anything at all.
  assert.deepEqual(calls, []);
});

test("an expired session cannot unfollow anyone", async () => {
  const { result, calls } = await callUnfollow({}, {
    headers: { cookie: sessionCookie({ expiresAt: Date.now() - 1 }) },
  });

  assert.equal(result.status, 401);
  assert.deepEqual(calls, []);
  assert.match(result.headers["Set-Cookie"], /gpl_session=;/);
});

test("a session sealed with a different secret cannot unfollow anyone", async () => {
  const foreign = await withEnvironment(
    { SESSION_SECRET: "a-completely-different-secret-value-over-32-chars" },
    () => seal({
      accessToken: "token",
      user: { login: "example" },
      manageFollows: true,
      expiresAt: Date.now() + 60_000,
    })
  );
  const { result, calls } = await callUnfollow({}, {
    headers: { cookie: `gpl_session=${foreign}` },
  });

  assert.equal(result.status, 401);
  assert.deepEqual(calls, []);
});

test("an ordinary sign-in without the follow permission is refused before GitHub", async () => {
  const { result, calls } = await callUnfollow({}, {
    headers: { cookie: sessionCookie({ manageFollows: false }) },
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.reason, "permission_required");
  assert.match(result.body.error, /permission to change who you follow/);
  assert.deepEqual(calls, [], "no GitHub request is spent on a session that may not write");
});

test("a session with no manageFollows field at all is refused", async () => {
  // An older session, sealed before this feature existed, must not be read as
  // permitted merely because the field is missing.
  const { result } = await callUnfollow({}, {
    headers: { cookie: sessionCookie({ manageFollows: undefined }) },
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.reason, "permission_required");
});

test("only POST is accepted", async () => {
  for (const method of ["GET", "DELETE", "PUT", "PATCH", "HEAD"]) {
    const { result, calls } = await callUnfollow({}, { method, headers: { cookie: sessionCookie() } });
    assert.equal(result.status, 405, `${method} must be refused`);
    assert.equal(result.headers.Allow, "POST");
    assert.deepEqual(calls, []);
  }
});

test("a cross-origin post is refused even when it carries a session", async () => {
  const { result, calls } = await callUnfollow({}, {
    headers: { cookie: sessionCookie(), origin: "https://attacker.example" },
  });

  assert.equal(result.status, 403);
  assert.match(result.body.error, /did not come from GitProfileLens/);
  assert.deepEqual(calls, []);
});

test("malformed targets are rejected without reaching GitHub", async () => {
  const targets = [
    undefined,
    "",
    "   ",
    "-leading",
    "trailing-",
    "has space",
    "has/slash",
    "double--hyphen-is-fine-but-this-is/not",
    "a".repeat(40),
    "../../user/following/someone",
    "octocat?x=1",
    { login: 5 },
    null,
  ];

  for (const login of targets) {
    const body = login && typeof login === "object" ? login : { login };
    const { result, calls } = await callUnfollow({}, { body, headers: { cookie: sessionCookie() } });
    assert.equal(result.status, 400, `${JSON.stringify(login)} must be refused`);
    assert.deepEqual(calls, []);
  }
});

test("the body cannot name who is acting", async () => {
  const github = mockGitHub({ GET: { status: 204 }, DELETE: { status: 204 } });
  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const { response, result } = createResponse();
      await unfollowHandler(unfollowRequest({
        headers: { cookie: sessionCookie() },
        body: {
          login: "octocat",
          // Every one of these is ignored: authority comes from the sealed session.
          actingUser: "someone-else",
          authenticatedLogin: "someone-else",
          token: "attacker-supplied-token",
          accessToken: "attacker-supplied-token",
        },
      }), response);
      assert.equal(result.status, 200);
    });

    assert.equal(github.calls.length, 2);
    for (const call of github.calls) {
      assert.equal(call.authorization, "Bearer github-user-access-token");
      assert.doesNotMatch(call.authorization, /attacker-supplied-token/);
      assert.match(call.url, /\/user\/following\/octocat$/);
      assert.doesNotMatch(call.url, /someone-else/);
    }
  } finally {
    github.restore();
  }
});

test("a raw JSON string body is parsed, and a non-JSON body is refused", async () => {
  const accepted = await callUnfollow(
    { GET: { status: 204 }, DELETE: { status: 204 } },
    { body: JSON.stringify({ login: "octocat" }), headers: { cookie: sessionCookie() } }
  );
  assert.equal(accepted.result.status, 200);

  const refused = await callUnfollow({}, {
    body: "login=octocat",
    headers: { cookie: sessionCookie() },
  });
  assert.equal(refused.result.status, 400);
  assert.deepEqual(refused.calls, []);
});

test("unfollowing your own account is refused without spending a request", async () => {
  const { result, calls } = await callUnfollow({}, {
    body: { login: "ExAmPlE" },
    headers: { cookie: sessionCookie() },
  });

  assert.equal(result.status, 400);
  assert.match(result.body.error, /your own account/);
  assert.deepEqual(calls, []);
});

test("a confirmed unfollow reads first and then writes exactly once", async () => {
  const { result, calls } = await callUnfollow(
    { GET: { status: 204 }, DELETE: { status: 204 } },
    { headers: { cookie: sessionCookie() } }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.state, "unfollowed");
  assert.equal(result.body.login, "octocat");
  assert.match(result.body.message, /Unfollowed @octocat/);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "DELETE"]);
  assert.equal(calls[1].url, "https://api.github.com/user/following/octocat");
});

test("an account already unfollowed elsewhere is reported honestly and never written", async () => {
  // The page went stale: the reader unfollowed this account on github.com after
  // the Network tab loaded. DELETE would answer 204 here too, which is exactly why
  // the read happens first.
  const { result, calls } = await callUnfollow(
    { GET: { status: 404 } },
    { headers: { cookie: sessionCookie() } }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.state, "already_not_following");
  assert.match(result.body.message, /no longer following @octocat/);
  assert.deepEqual(calls.map((call) => call.method), ["GET"], "no write is spent on a relationship that is already over");
});

test("a GitHub refusal of the write leaves the relationship alone and says so", async () => {
  const { result } = await callUnfollow(
    { GET: { status: 204 }, DELETE: { status: 500 } },
    { headers: { cookie: sessionCookie() } }
  );

  assert.equal(result.status, 502);
  assert.equal(result.body.reason, "github_unavailable");
  assert.match(result.body.error, /was not unfollowed/);
  assert.equal(result.body.state, undefined, "a failure never carries a success state");
});

test("rate limiting is reported as a rate limit, not as a missing permission", async () => {
  const cases = [
    { status: 429, headers: { "retry-after": "120" }, expect: /about 2 minutes/ },
    { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" }, expect: /Try again after 2027/ },
    { status: 403, headers: { "retry-after": "30" }, expect: /about 1 minute\./ },
  ];

  for (const entry of cases) {
    const { result } = await callUnfollow(
      { GET: { status: 204 }, DELETE: { status: entry.status, headers: entry.headers } },
      { headers: { cookie: sessionCookie() } }
    );
    assert.equal(result.status, 429);
    assert.equal(result.body.reason, "rate_limited");
    assert.match(result.body.error, entry.expect);
    assert.match(result.body.error, /was not unfollowed/);
  }
});

test("a forbidden response with no rate-limit signal is reported as a permission problem", async () => {
  const { result } = await callUnfollow(
    { GET: { status: 403, headers: { "x-ratelimit-remaining": "4999" } } },
    { headers: { cookie: sessionCookie() } }
  );

  assert.equal(result.status, 403);
  assert.equal(result.body.reason, "permission_required");
  assert.match(result.body.error, /permission to manage who you follow/);
});

test("a GitHub 401 clears the session rather than retrying", async () => {
  const { result, calls } = await callUnfollow(
    { GET: { status: 401 } },
    { headers: { cookie: sessionCookie() } }
  );

  assert.equal(result.status, 401);
  assert.equal(result.body.reason, "session_expired");
  assert.match(result.headers["Set-Cookie"], /gpl_session=;/);
  assert.equal(calls.length, 1, "a refused read is not retried");
});

test("an unknown account is reported as unknown", async () => {
  // GitHub answers 404 both for "not following" and for "no such account". The
  // read cannot tell them apart, so a 404 there is treated as the safe reading:
  // the relationship is not in place. A 404 on the write is the unknown account.
  const { result } = await callUnfollow(
    { GET: { status: 204 }, DELETE: { status: 404 } },
    { headers: { cookie: sessionCookie() } }
  );

  assert.equal(result.status, 404);
  assert.equal(result.body.reason, "unknown_account");
});

test("an unexpected GitHub status is never reported as success", async () => {
  for (const status of [200, 201, 202, 302, 418, 451, 502, 503]) {
    const { result } = await callUnfollow(
      { GET: { status: 204 }, DELETE: { status } },
      { headers: { cookie: sessionCookie() } }
    );
    assert.notEqual(result.status, 200, `GitHub ${status} must not be read as a confirmed unfollow`);
    assert.equal(result.body.state, undefined);
  }
});

test("a network failure and a timeout both leave the relationship alone", async () => {
  for (const failure of ["TypeError", "AbortError"]) {
    const { result } = await callUnfollow(
      { GET: { throws: failure } },
      { headers: { cookie: sessionCookie() } }
    );
    assert.equal(result.status, 502);
    assert.equal(result.body.reason, "github_unavailable");
    assert.match(result.body.error, /Nothing was changed/);
  }
});

test("a write is never retried", async () => {
  // GitHub counts a write against a secondary limit of 80 content-generating
  // requests a minute. A handler that retried on its own behalf would be
  // generating follow activity the reader did not ask for.
  const { calls } = await callUnfollow(
    { GET: { status: 204 }, DELETE: { status: 503 } },
    { headers: { cookie: sessionCookie() } }
  );

  assert.equal(calls.filter((call) => call.method === "DELETE").length, 1);
});

test("no response body ever carries a credential", async () => {
  const scripts = [
    { GET: { status: 204 }, DELETE: { status: 204 } },
    { GET: { status: 401 } },
    { GET: { status: 204 }, DELETE: { status: 429, headers: { "retry-after": "60" } } },
    { GET: { status: 404 } },
  ];

  for (const script of scripts) {
    const { result } = await callUnfollow(script, { headers: { cookie: sessionCookie() } });
    const serialized = JSON.stringify(result.body);
    assert.doesNotMatch(serialized, /github-user-access-token|gpl_session|Bearer|client-secret/);
  }
});

test("the endpoint cannot be steered at another GitHub route", async () => {
  // There is no path parameter to poison: a login that survives validation is
  // percent-encoded into exactly one known path.
  const github = mockGitHub({ GET: { status: 404 } });
  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const { response } = createResponse();
      await unfollowHandler(unfollowRequest({
        body: { login: "octocat" },
        headers: { cookie: sessionCookie() },
      }), response);
    });
    assert.deepEqual(
      github.calls.map((call) => call.url),
      ["https://api.github.com/user/following/octocat"]
    );
  } finally {
    github.restore();
  }
});

test("follow management is a separate authorization from ordinary sign-in", async () => {
  await withEnvironment(APP_ENVIRONMENT, () => {
    const ordinary = createResponse();
    authStartHandler({ method: "GET", query: {} }, ordinary.response);
    const managing = createResponse();
    authStartHandler({ method: "GET", query: { manage: "follows" } }, managing.response);

    assert.doesNotMatch(ordinary.result.headers["Set-Cookie"], /~follows/);
    assert.match(managing.result.headers["Set-Cookie"], /~follows/);
    // GitHub still sees a state it can echo back, and the marker travels with it.
    const state = new URL(managing.result.headers.Location).searchParams.get("state");
    assert.ok(state.endsWith("~follows"));
    assert.ok(state.length > "~follows".length + 20, "the random part is still unpredictable");
  });
});

test("the permission is granted only by the authorization that asked for it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("access_token")) {
      return { ok: true, json: async () => ({ access_token: "github-user-access-token" }) };
    }
    return {
      ok: true,
      json: async () => ({ login: "example", avatar_url: "https://avatars.example/example.png" }),
    };
  };

  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      for (const [state, expected] of [["plain-state", false], ["plain-state~follows", true]]) {
        const { response, result } = createResponse();
        await callbackHandler({
          method: "GET",
          query: { code: "valid-code", state },
          headers: { cookie: `gpl_oauth_state=${state}` },
        }, response);

        const cookies = result.headers["Set-Cookie"];
        const sealed = cookies.find((cookie) => cookie.startsWith("gpl_session="))
          .split(";")[0].slice("gpl_session=".length);
        const session = createResponse();
        sessionHandler({ method: "GET", headers: { cookie: `gpl_session=${sealed}` } }, session.response);
        assert.equal(session.result.body.can_manage_follows, expected, `state ${state}`);
        assert.equal(session.result.body.authenticated, true);
        // The capability is a boolean; nothing that could act reaches the browser.
        assert.doesNotMatch(JSON.stringify(session.result.body), /github-user-access-token/);
      }
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a browser-supplied manage query cannot grant the permission on its own", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("access_token")) {
      return { ok: true, json: async () => ({ access_token: "github-user-access-token" }) };
    }
    return {
      ok: true,
      json: async () => ({ login: "example", avatar_url: "https://avatars.example/example.png" }),
    };
  };

  try {
    await withEnvironment(APP_ENVIRONMENT, async () => {
      const { response, result } = createResponse();
      // The query claims the marker; the HttpOnly state cookie, which is what the
      // callback actually reads, does not carry it.
      await callbackHandler({
        method: "GET",
        query: { code: "valid-code", state: "plain-state", manage: "follows" },
        headers: { cookie: "gpl_oauth_state=plain-state" },
      }, response);

      const sealed = result.headers["Set-Cookie"]
        .find((cookie) => cookie.startsWith("gpl_session="))
        .split(";")[0].slice("gpl_session=".length);
      const session = createResponse();
      sessionHandler({ method: "GET", headers: { cookie: `gpl_session=${sealed}` } }, session.response);
      assert.equal(session.result.body.can_manage_follows, false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a mismatched state is still refused when it carries the marker", async () => {
  await withEnvironment(APP_ENVIRONMENT, async () => {
    const { response, result } = createResponse();
    await callbackHandler({
      method: "GET",
      query: { code: "valid-code", state: "attacker-state~follows" },
      headers: { cookie: "gpl_oauth_state=real-state~follows" },
    }, response);

    assert.equal(result.status, 400);
    assert.match(result.body.error, /could not be verified/);
  });
});

test("diagnostics name the target and the status but never a credential", async () => {
  const lines = [];
  const originalInfo = console.info;
  console.info = (line) => lines.push(line);

  try {
    await callUnfollow(
      { GET: { status: 204 }, DELETE: { status: 403 } },
      { headers: { cookie: sessionCookie() } }
    );
  } finally {
    console.info = originalInfo;
  }

  const joined = lines.join("\n");
  assert.match(joined, /"component":"unfollow"/);
  assert.match(joined, /"target":"octocat"/);
  assert.match(joined, /"github_status":403/);
  assert.doesNotMatch(joined, /github-user-access-token|gpl_session|Bearer|Authorization|client-secret|valid-code/i);
});
