const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeReturnPath,
  buildReturnPath,
  readAuthOutcome,
  chooseHomeUsername,
  createHandoffStore,
  HANDOFF_KEY,
  HANDOFF_MAX_AGE_MS,
} = require("../auth-context.js");

/* --------------------------------------------------------------------------
 * Return destinations
 * ------------------------------------------------------------------------ */

test("a return path keeps only the allowlisted profile context, in a fixed order", () => {
  assert.equal(normalizeReturnPath("/"), "/");
  assert.equal(normalizeReturnPath("/?user=octocat"), "/?user=octocat");
  assert.equal(
    normalizeReturnPath("/?view=network&user=octocat"),
    "/?user=octocat&view=network"
  );
  assert.equal(
    normalizeReturnPath("/?user=octocat&view=network&manage=unfollows"),
    "/?user=octocat&view=network&manage=unfollows"
  );
});

test("a return path can never leave this origin", () => {
  for (const hostile of [
    "https://evil.test/?user=octocat",
    "//evil.test/?user=octocat",
    "/\\evil.test",
    "\\\\evil.test",
    "javascript:alert(1)",
    "data:text/html,hi",
    "http:/evil.test",
    " /?user=octocat",
    "/%2F%2Fevil.test",
    "/api/auth/callback?code=x",
    "/index.html?user=octocat",
  ]) {
    assert.equal(normalizeReturnPath(hostile), null, `accepted ${hostile}`);
  }
});

test("unknown, credential-shaped, and invalid parameters are dropped", () => {
  assert.equal(
    normalizeReturnPath("/?user=octocat&auth=success&code=abc&state=xyz&token=t&next=//evil"),
    "/?user=octocat"
  );
  assert.equal(normalizeReturnPath("/?user=-bad-&view=network"), "/?view=network");
  assert.equal(normalizeReturnPath("/?user=octocat&view=settings"), "/?user=octocat");
  assert.equal(normalizeReturnPath("/?user=octocat&manage=everything"), "/?user=octocat");
  assert.equal(normalizeReturnPath("/#fragment"), "/");
});

test("managing unfollows always returns to the Network tab", () => {
  assert.equal(
    normalizeReturnPath("/?user=octocat&view=audit&manage=unfollows"),
    "/?user=octocat&view=network&manage=unfollows"
  );
  assert.equal(
    normalizeReturnPath("/?user=octocat&manage=unfollows"),
    "/?user=octocat&view=network&manage=unfollows"
  );
});

test("oversized or non-string return values are refused", () => {
  assert.equal(normalizeReturnPath(`/?user=octocat&pad=${"a".repeat(600)}`), null);
  assert.equal(normalizeReturnPath(null), null);
  assert.equal(normalizeReturnPath(undefined), null);
  assert.equal(normalizeReturnPath(["/"]), null);
  assert.equal(normalizeReturnPath(""), null);
});

test("a return path is built from parts with the same rules", () => {
  assert.equal(buildReturnPath({}), "/");
  assert.equal(buildReturnPath({ user: "octocat", view: "overview" }), "/?user=octocat&view=overview");
  assert.equal(
    buildReturnPath({ user: "octocat", view: "repositories", manage: "unfollows" }),
    "/?user=octocat&view=network&manage=unfollows"
  );
  assert.equal(buildReturnPath({ user: "not a login", view: "network" }), "/?view=network");
});

/* --------------------------------------------------------------------------
 * Callback outcomes
 * ------------------------------------------------------------------------ */

test("only the outcomes the callback produces are recognized", () => {
  assert.equal(readAuthOutcome("?auth=success"), "success");
  assert.equal(readAuthOutcome("?user=x&auth=manage-follows"), "manage-follows");
  assert.equal(readAuthOutcome("?auth=denied"), "denied");
  assert.equal(readAuthOutcome("?auth=error"), "error");
  assert.equal(readAuthOutcome("?auth=invalid"), "invalid");
  assert.equal(readAuthOutcome("?auth=granted-everything"), null);
  assert.equal(readAuthOutcome(""), null);
});

/* --------------------------------------------------------------------------
 * Username precedence
 * ------------------------------------------------------------------------ */

test("an explicitly requested profile wins over everything else", () => {
  assert.equal(chooseHomeUsername({ explicit: "torvalds", typed: "octocat", authLogin: "me" }), "torvalds");
});

test("a username the reader typed is never replaced by their own login", () => {
  assert.equal(chooseHomeUsername({ explicit: null, typed: "octocat", authLogin: "me" }), "octocat");
});

test("the signed-in login fills an untouched field", () => {
  assert.equal(chooseHomeUsername({ explicit: null, typed: "", authLogin: "me" }), "me");
  assert.equal(chooseHomeUsername({ explicit: null, typed: "   ", authLogin: "me" }), "me");
});

test("a signed-out visitor with no target gets an empty field", () => {
  assert.equal(chooseHomeUsername({ explicit: null, typed: "", authLogin: null }), "");
  assert.equal(chooseHomeUsername({}), "");
});

/* --------------------------------------------------------------------------
 * One-shot audit handoff
 * ------------------------------------------------------------------------ */

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const payload = {
  login: "Octocat",
  audit: { user: { login: "Octocat" }, repositories: [{ name: "hello-world" }] },
  network: null,
};

test("a saved handoff is returned once for the same login, compared case-insensitively", () => {
  const storage = memoryStorage();
  let clock = 1_000;
  const store = createHandoffStore({ storage, now: () => clock });
  assert.equal(store.save(payload), true);
  clock += 5_000;
  const taken = store.take("octocat");
  assert.deepEqual(taken.audit, payload.audit);
  assert.equal(taken.login, "Octocat");
  assert.equal(store.take("octocat"), null, "a handoff is single-use");
  assert.equal(storage.values.has(HANDOFF_KEY), false);
});

test("a handoff for another profile is discarded, not returned", () => {
  const storage = memoryStorage();
  const store = createHandoffStore({ storage, now: () => 0 });
  store.save(payload);
  assert.equal(store.take("someone-else"), null);
  assert.equal(storage.values.has(HANDOFF_KEY), false);
});

test("an expired handoff is discarded", () => {
  const storage = memoryStorage();
  let clock = 0;
  const store = createHandoffStore({ storage, now: () => clock });
  store.save(payload);
  clock = HANDOFF_MAX_AGE_MS + 1;
  assert.equal(store.take("octocat"), null);
  assert.equal(HANDOFF_MAX_AGE_MS, 600_000);
});

test("a corrupt or foreign handoff is discarded", () => {
  const storage = memoryStorage();
  const store = createHandoffStore({ storage, now: () => 0 });
  storage.setItem(HANDOFF_KEY, "{not json");
  assert.equal(store.take("octocat"), null);
  storage.setItem(HANDOFF_KEY, JSON.stringify({ version: 99, login: "octocat", savedAt: 0 }));
  assert.equal(store.take("octocat"), null);
});

test("storage that refuses writes or does not exist never breaks the flow", () => {
  const refusing = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  const blocked = createHandoffStore({ storage: refusing, now: () => 0 });
  assert.equal(blocked.save(payload), false);
  assert.equal(blocked.take("octocat"), null);
  assert.doesNotThrow(() => blocked.clear());

  const absent = createHandoffStore({ storage: null, now: () => 0 });
  assert.equal(absent.save(payload), false);
  assert.equal(absent.take("octocat"), null);
});

test("a handoff without a valid login is refused rather than stored", () => {
  const storage = memoryStorage();
  const store = createHandoffStore({ storage, now: () => 0 });
  assert.equal(store.save({ ...payload, login: "not a login" }), false);
  assert.equal(storage.values.size, 0);
});

/* --------------------------------------------------------------------------
 * Remembering where an authorization started
 * ------------------------------------------------------------------------ */

const { createReturnMemory, RETURN_MEMORY_KEY, RETURN_MEMORY_MAX_AGE_MS } = require("../auth-context.js");

test("the place an authorization started is recalled once, normalized", () => {
  const storage = memoryStorage();
  const memory = createReturnMemory({ storage, now: () => 0 });
  assert.equal(memory.remember("/?user=octocat&view=network&manage=unfollows&auth=x"), true);
  assert.equal(memory.recall(), "/?user=octocat&view=network&manage=unfollows");
  assert.equal(memory.recall(), null, "recall is single-use");
  assert.equal(storage.values.has(RETURN_MEMORY_KEY), false);
});

test("a remembered place outlives the ten-minute OAuth state, but not indefinitely", () => {
  const storage = memoryStorage();
  let clock = 0;
  const memory = createReturnMemory({ storage, now: () => clock });
  memory.remember("/?user=octocat");
  clock = 30 * 60 * 1000;
  assert.equal(memory.recall(), "/?user=octocat");

  memory.remember("/?user=octocat");
  clock += RETURN_MEMORY_MAX_AGE_MS + 1;
  assert.equal(memory.recall(), null);
  assert.ok(RETURN_MEMORY_MAX_AGE_MS >= 60 * 60 * 1000);
});

test("a remembered place can never name another origin", () => {
  const storage = memoryStorage();
  const memory = createReturnMemory({ storage, now: () => 0 });
  assert.equal(memory.remember("https://evil.test/"), false);
  storage.setItem(RETURN_MEMORY_KEY, JSON.stringify({ version: 1, savedAt: 0, path: "//evil.test" }));
  assert.equal(memory.recall(), null);
});

test("blocked storage remembers nothing and never throws", () => {
  const refusing = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  const memory = createReturnMemory({ storage: refusing, now: () => 0 });
  assert.equal(memory.remember("/?user=octocat"), false);
  assert.equal(memory.recall(), null);
  assert.equal(createReturnMemory({ storage: null }).recall(), null);
});
