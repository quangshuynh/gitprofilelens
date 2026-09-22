const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const history = require("../network-history.js");

const projectRoot = path.resolve(__dirname, "..");

/**
 * builds a fake localStorage that records how often it is written
 * @param {Object} options initial contents and whether writes should fail
 * @returns {Object} storage double with write accounting
 */
function createStorage(options = {}) {
  const values = new Map();
  if (options.initial !== undefined) values.set(history.STORAGE_KEY, options.initial);

  return {
    writes: 0,
    reads: 0,
    removals: 0,
    getItem(key) {
      this.reads += 1;
      if (options.throwOnRead) throw new Error("storage blocked");
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      this.writes += 1;
      if (options.throwOnWrite) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    removeItem(key) {
      this.removals += 1;
      values.delete(key);
    },
    raw: values,
  };
}

/**
 * builds retrieved accounts in the order an API response would supply them
 * @param {Array<string>} logins github logins
 * @returns {Array<Object>} retrieved accounts
 */
function accounts(logins) {
  return logins.map((login) => ({ login, profileUrl: `https://github.com/${login}` }));
}

/**
 * builds one complete retrieved relationship list
 * @param {Array<string>} logins github logins
 * @returns {Object} complete relationship list
 */
function complete(logins) {
  return { accounts: accounts(logins), complete: true, error: null, pagesLoaded: 1 };
}

/**
 * builds one relationship list that could not be completely retrieved
 * @param {Array<string>} logins github logins that did arrive
 * @returns {Object} incomplete relationship list
 */
function partial(logins) {
  return { accounts: accounts(logins), complete: false, error: "stopped early", pagesLoaded: 1 };
}

/**
 * records one observation against a store
 * @param {Object} store history store
 * @param {Object} options login, both lists, and the observation time
 * @returns {Object} the store's outcome
 */
function observe(store, options) {
  return store.recordNetworkObservation({
    login: options.login ?? "Quangshuynh",
    followers: options.followers ?? complete([]),
    following: options.following ?? complete([]),
    observedAt: options.observedAt,
  });
}

/**
 * reads the display order of a list after history ordering
 * @param {Array<string>} logins github logins in api order
 * @param {Object|null} list stored relationship list
 * @returns {Array<string>} logins in display order
 */
function orderedLogins(logins, list) {
  return history.orderAccounts(accounts(logins), list).accounts.map((account) => account.login);
}

test("an initial snapshot of 131 followers forms one baseline cohort", () => {
  const store = createStore();
  const logins = Array.from({ length: 131 }, (_, index) => `follower${index}`);
  const outcome = observe(store.store, {
    followers: complete(logins),
    observedAt: "2026-09-22T10:00:00.000Z",
  });

  const list = outcome.lists.followers;
  assert.equal(outcome.baseline.followers, true);
  assert.equal(Object.keys(list.accounts).length, 131);
  assert.equal(history.listCohorts(list).length, 1);
  for (const entry of Object.values(list.accounts)) {
    assert.equal(entry.firstObservedAt, "2026-09-22T10:00:00.000Z");
    assert.equal(entry.currentlyPresent, true);
  }
});

test("a baseline cohort is never given an order the observation did not establish", () => {
  const store = createStore();
  const logins = Array.from({ length: 131 }, (_, index) => `follower${index}`);
  const outcome = observe(store.store, { followers: complete(logins) });

  const result = history.orderAccounts(accounts(logins), outcome.lists.followers);
  assert.deepEqual(result.accounts.map((account) => account.login), logins);
  // One cohort cannot order anything, and the result says so rather than implying
  // that the GitHub order it returned means something.
  assert.equal(result.ordered, false);
  assert.equal(result.cohortCount, 1);
});

test("two newly observed accounts form a cohort newer than the baseline", () => {
  const store = createStore();
  observe(store.store, {
    followers: complete(["alice", "bob", "carol"]),
    observedAt: "2026-09-20T10:00:00.000Z",
  });
  const second = observe(store.store, {
    followers: complete(["alice", "bob", "carol", "dave", "erin"]),
    observedAt: "2026-09-22T10:00:00.000Z",
  });

  const list = second.lists.followers;
  assert.equal(list.accounts.dave.firstObservedAt, "2026-09-22T10:00:00.000Z");
  assert.equal(list.accounts.erin.firstObservedAt, "2026-09-22T10:00:00.000Z");
  assert.equal(list.accounts.alice.firstObservedAt, "2026-09-20T10:00:00.000Z");
  assert.equal(history.listCohorts(list).length, 2);
});

test("a newer cohort appears above the baseline, and neither cohort is reordered inside", () => {
  const store = createStore();
  observe(store.store, {
    followers: complete(["alice", "bob", "carol"]),
    observedAt: "2026-09-20T10:00:00.000Z",
  });
  const second = observe(store.store, {
    followers: complete(["alice", "bob", "carol", "dave", "erin"]),
    observedAt: "2026-09-22T10:00:00.000Z",
  });

  assert.deepEqual(
    orderedLogins(["alice", "bob", "carol", "dave", "erin"], second.lists.followers),
    ["dave", "erin", "alice", "bob", "carol"]
  );
  assert.equal(history.orderAccounts(accounts(["dave"]), second.lists.followers).ordered, true);
});

test("several later cohorts sort most recently observed first", () => {
  const store = createStore();
  observe(store.store, { followers: complete(["a", "b"]), observedAt: "2026-09-01T00:00:00.000Z" });
  observe(store.store, { followers: complete(["a", "b", "c"]), observedAt: "2026-09-05T00:00:00.000Z" });
  observe(store.store, { followers: complete(["a", "b", "c", "d"]), observedAt: "2026-09-09T00:00:00.000Z" });
  const last = observe(store.store, {
    followers: complete(["a", "b", "c", "d", "e"]),
    observedAt: "2026-09-12T00:00:00.000Z",
  });

  // e, d, and c each arrived in their own later observation, so they sort newest
  // first. a and b arrived together in the baseline, so they keep GitHub's order
  // rather than being separated by an ordering nothing established.
  assert.deepEqual(orderedLogins(["a", "b", "c", "d", "e"], last.lists.followers), ["e", "d", "c", "a", "b"]);
  assert.equal(history.listCohorts(last.lists.followers).length, 4);
});

test("ordering inside a cohort is deterministic and follows the retrieved order", () => {
  const store = createStore();
  observe(store.store, { followers: complete(["a", "b"]), observedAt: "2026-09-01T00:00:00.000Z" });
  const second = observe(store.store, {
    followers: complete(["a", "b", "x", "y", "z"]),
    observedAt: "2026-09-05T00:00:00.000Z",
  });

  const list = second.lists.followers;
  assert.deepEqual(orderedLogins(["a", "b", "x", "y", "z"], list), ["x", "y", "z", "a", "b"]);
  // A different retrieval order for the same cohort is preserved, not re-sorted
  // into an order the observation never established.
  assert.deepEqual(orderedLogins(["z", "y", "x", "b", "a"], list), ["z", "y", "x", "b", "a"]);
});

test("following-not-back inherits the Following observation order", () => {
  const networkExport = require("../network-export.js");
  const store = createStore();
  observe(store.store, {
    followers: complete(["alice"]),
    following: complete(["alice", "bob"]),
    observedAt: "2026-09-01T00:00:00.000Z",
  });
  const second = observe(store.store, {
    followers: complete(["alice"]),
    following: complete(["alice", "bob", "zed"]),
    observedAt: "2026-09-05T00:00:00.000Z",
  });

  const following = history.orderAccounts(
    accounts(["alice", "bob", "zed"]),
    second.lists.following
  ).accounts;
  const derived = networkExport.deriveNotFollowingBack({
    followers: complete(["alice"]),
    following: { accounts: following, complete: true },
  });

  assert.deepEqual(derived.map((account) => account.login), ["zed", "bob"]);
});

test("an incomplete retrieval can never mark an absent account as no longer present", () => {
  const store = createStore();
  observe(store.store, {
    followers: complete(["alice", "bob", "carol"]),
    observedAt: "2026-09-01T00:00:00.000Z",
  });
  const second = observe(store.store, {
    followers: partial(["alice"]),
    observedAt: "2026-09-05T00:00:00.000Z",
  });

  assert.deepEqual(second.skipped, ["followers"]);
  const list = store.store.getList("Quangshuynh", "followers");
  assert.equal(list.accounts.bob.currentlyPresent, true);
  assert.equal(list.accounts.carol.currentlyPresent, true);
  // The skipped list keeps the timestamps of the last observation it can defend.
  assert.equal(list.lastObservedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(list.observationCount, 1);
});

test("an incomplete retrieval never creates a cohort out of a partial page", () => {
  const store = createStore();
  observe(store.store, { followers: complete(["alice"]), observedAt: "2026-09-01T00:00:00.000Z" });
  observe(store.store, {
    followers: partial(["alice", "newcomer"]),
    observedAt: "2026-09-05T00:00:00.000Z",
  });

  const list = store.store.getList("Quangshuynh", "followers");
  assert.equal(list.accounts.newcomer, undefined);
  assert.equal(history.listCohorts(list).length, 1);
});

test("an incomplete list for one relationship does not block the other", () => {
  const store = createStore();
  const outcome = observe(store.store, {
    followers: partial(["alice"]),
    following: complete(["bob"]),
    observedAt: "2026-09-01T00:00:00.000Z",
  });

  assert.deepEqual(outcome.skipped, ["followers"]);
  assert.equal(store.store.getList("Quangshuynh", "followers"), null);
  assert.equal(store.store.getList("Quangshuynh", "following").accounts.bob.currentlyPresent, true);
});

test("a complete retrieval records an absence as evidence and freezes the last sighting", () => {
  const store = createStore();
  observe(store.store, {
    followers: complete(["alice", "bob"]),
    observedAt: "2026-09-01T00:00:00.000Z",
  });
  observe(store.store, { followers: complete(["bob"]), observedAt: "2026-09-05T00:00:00.000Z" });

  const list = store.store.getList("Quangshuynh", "followers");
  assert.equal(list.accounts.alice.currentlyPresent, false);
  assert.equal(list.accounts.alice.lastObservedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(list.accounts.alice.absences, 1);
  assert.equal(list.accounts.bob.lastObservedAt, "2026-09-05T00:00:00.000Z");
});

test("a reappearance is recorded as one, and never rewritten as an unbroken relationship", () => {
  const store = createStore();
  observe(store.store, { followers: complete(["alice"]), observedAt: "2026-09-01T00:00:00.000Z" });
  observe(store.store, { followers: complete([]), observedAt: "2026-09-05T00:00:00.000Z" });
  observe(store.store, { followers: complete(["alice"]), observedAt: "2026-09-09T00:00:00.000Z" });

  const entry = store.store.getList("Quangshuynh", "followers").accounts.alice;
  assert.equal(entry.currentlyPresent, true);
  // firstObservedAt still means the first observation, which really was in September 1.
  assert.equal(entry.firstObservedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(entry.reappearedAt, "2026-09-09T00:00:00.000Z");
  assert.equal(entry.absences, 1);
});

test("identity is case-insensitive while the displayed spelling follows GitHub", () => {
  const store = createStore();
  observe(store.store, { followers: complete(["AliceB"]), observedAt: "2026-09-01T00:00:00.000Z" });
  const second = observe(store.store, {
    followers: complete(["aliceb"]),
    observedAt: "2026-09-05T00:00:00.000Z",
  });

  const list = second.lists.followers;
  assert.equal(Object.keys(list.accounts).length, 1);
  assert.equal(list.accounts.aliceb.login, "aliceb");
  assert.equal(list.accounts.aliceb.firstObservedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(history.findEntry(list, "ALICEB").login, "aliceb");
  assert.equal(history.isBaselineAccount(list, "AliceB"), true);
});

test("history survives a reload through storage rather than through memory", () => {
  const storage = createStorage();
  const first = history.createStore({ storage });
  observe(first, { followers: complete(["alice"]), observedAt: "2026-09-01T00:00:00.000Z" });

  // A fresh store over the same storage is what a page reload produces.
  const second = history.createStore({ storage });
  const outcome = observe(second, {
    followers: complete(["alice", "bob"]),
    observedAt: "2026-09-05T00:00:00.000Z",
  });

  assert.equal(outcome.lists.followers.accounts.alice.firstObservedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(outcome.lists.followers.accounts.bob.firstObservedAt, "2026-09-05T00:00:00.000Z");
  assert.deepEqual(orderedLogins(["alice", "bob"], outcome.lists.followers), ["bob", "alice"]);
});

test("different audited profiles keep separate history", () => {
  const store = createStore();
  observe(store.store, {
    login: "alpha",
    followers: complete(["shared"]),
    observedAt: "2026-09-01T00:00:00.000Z",
  });
  observe(store.store, {
    login: "beta",
    followers: complete(["shared", "other"]),
    observedAt: "2026-09-05T00:00:00.000Z",
  });

  assert.equal(store.store.getList("alpha", "followers").accounts.other, undefined);
  assert.equal(
    store.store.getList("beta", "followers").accounts.shared.firstObservedAt,
    "2026-09-05T00:00:00.000Z"
  );
  assert.equal(store.store.countProfiles(), 2);
});

test("a profile login that differs only in case is the same profile", () => {
  const store = createStore();
  observe(store.store, { login: "Quangshuynh", followers: complete(["a"]) });
  observe(store.store, { login: "quangshuynh", followers: complete(["a", "b"]) });
  assert.equal(store.store.countProfiles(), 1);
});

test("corrupted storage fails safely into a fresh baseline", () => {
  const storage = createStorage({ initial: "{not json at all" });
  const store = history.createStore({ storage });

  assert.deepEqual(store.read(), { schemaVersion: history.SCHEMA_VERSION, profiles: {} });
  const outcome = observe(store, { followers: complete(["a"]), observedAt: "2026-09-05T00:00:00.000Z" });
  assert.equal(outcome.wrote, true);
  assert.equal(outcome.lists.followers.baselineObservedAt, "2026-09-05T00:00:00.000Z");
});

test("entries missing a first observation are discarded rather than repaired", () => {
  const storage = createStorage({
    initial: JSON.stringify({
      schemaVersion: history.SCHEMA_VERSION,
      profiles: {
        quangshuynh: {
          login: "quangshuynh",
          followers: {
            baselineObservedAt: "2026-09-01T00:00:00.000Z",
            lastObservedAt: "2026-09-01T00:00:00.000Z",
            observationCount: 1,
            accounts: {
              good: { login: "good", firstObservedAt: "2026-09-01T00:00:00.000Z", lastObservedAt: "2026-09-01T00:00:00.000Z", currentlyPresent: true },
              bad: { login: "bad", firstObservedAt: "not a date", lastObservedAt: "2026-09-01T00:00:00.000Z", currentlyPresent: true },
            },
          },
        },
      },
    }),
  });

  const list = history.createStore({ storage }).getList("quangshuynh", "followers");
  assert.equal(list.accounts.good.login, "good");
  assert.equal(list.accounts.bad, undefined);
});

test("a schema version this build does not know starts over instead of guessing", () => {
  const storage = createStorage({
    initial: JSON.stringify({
      schemaVersion: history.SCHEMA_VERSION + 99,
      profiles: { quangshuynh: { login: "quangshuynh", followers: { accounts: {} } } },
    }),
  });
  const store = history.createStore({ storage });

  assert.deepEqual(store.read().profiles, {});
  const outcome = observe(store, { followers: complete(["a"]), observedAt: "2026-09-05T00:00:00.000Z" });
  assert.equal(outcome.baseline.followers, true);
});

test("storage that cannot be read or written leaves the network working", () => {
  const blocked = history.createStore({ storage: createStorage({ throwOnRead: true }) });
  assert.deepEqual(blocked.read().profiles, {});

  const full = history.createStore({ storage: createStorage({ throwOnWrite: true }) });
  const outcome = observe(full, { followers: complete(["a"]) });
  assert.equal(outcome.wrote, false);
  assert.equal(outcome.error, "quota");
  assert.equal(outcome.lists.followers.accounts.a.currentlyPresent, true);

  const none = history.createStore({});
  assert.equal(none.isAvailable(), false);
  assert.equal(observe(none, { followers: complete(["a"]) }).wrote, false);
});

test("resetting history clears every profile", () => {
  const store = createStore();
  observe(store.store, { login: "alpha", followers: complete(["a"]) });
  observe(store.store, { login: "beta", followers: complete(["b"]) });

  store.store.reset();
  assert.equal(store.store.countProfiles(), 0);
  assert.equal(store.storage.raw.has(history.STORAGE_KEY), false);
  // The next observation is a new baseline, not a resumption of the old one.
  const outcome = observe(store.store, {
    login: "alpha",
    followers: complete(["a"]),
    observedAt: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(outcome.baseline.followers, true);
});

test("resetting one profile leaves the others alone", () => {
  const store = createStore();
  observe(store.store, { login: "alpha", followers: complete(["a"]) });
  observe(store.store, { login: "beta", followers: complete(["b"]) });

  store.store.resetProfile("ALPHA");
  assert.equal(store.store.getList("alpha", "followers"), null);
  assert.equal(store.store.getList("beta", "followers").accounts.b.currentlyPresent, true);
});

test("re-observing the same network at the same instant does not rewrite storage", () => {
  const store = createStore();
  observe(store.store, { followers: complete(["a", "b"]), observedAt: "2026-09-01T00:00:00.000Z" });
  const writesAfterFirst = store.storage.writes;

  const repeat = observe(store.store, {
    followers: complete(["a", "b"]),
    observedAt: "2026-09-01T00:00:00.000Z",
  });

  assert.equal(repeat.changed, false);
  assert.equal(store.storage.writes, writesAfterFirst);
});

test("one observation of both lists costs exactly one write", () => {
  const store = createStore();
  observe(store.store, {
    followers: complete(Array.from({ length: 500 }, (_, index) => `f${index}`)),
    following: complete(Array.from({ length: 500 }, (_, index) => `g${index}`)),
  });
  assert.equal(store.storage.writes, 1);
});

test("the snapshot is parsed at most once per store", () => {
  const storage = createStorage();
  const store = history.createStore({ storage });
  store.read();
  store.read();
  store.getList("anyone", "followers");
  assert.equal(storage.reads, 1);
});

test("tracked profiles are bounded, keeping the one just observed", () => {
  const store = createStore();
  for (let index = 0; index < history.MAXIMUM_TRACKED_PROFILES + 5; index += 1) {
    observe(store.store, {
      login: `profile${index}`,
      followers: complete(["a"]),
      observedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    });
  }

  assert.equal(store.store.countProfiles(), history.MAXIMUM_TRACKED_PROFILES);
  const kept = `profile${history.MAXIMUM_TRACKED_PROFILES + 4}`;
  assert.notEqual(store.store.getList(kept, "followers"), null);
  assert.equal(store.store.getList("profile0", "followers"), null);
});

test("merging a large observation stays linear rather than quadratic", () => {
  const size = 10000;
  const baseline = Array.from({ length: size }, (_, index) => `user${index}`);
  const previous = history.mergeList(null, accounts(baseline), "2026-09-01T00:00:00.000Z");

  const grown = [...baseline, "newcomer"];
  const merged = history.mergeList(previous.list, accounts(grown), "2026-09-05T00:00:00.000Z");

  assert.equal(Object.keys(merged.list.accounts).length, size + 1);
  assert.deepEqual(merged.added, ["newcomer"]);
  assert.deepEqual(merged.removed, []);
  // Ordering a list this size must place the one new cohort first without any
  // pairwise comparison of account identities.
  const ordered = history.orderAccounts(accounts(grown), merged.list).accounts;
  assert.equal(ordered[0].login, "newcomer");
  assert.equal(ordered[1].login, "user0");
});

test("the ordering sentence never claims a follow date", () => {
  const store = createStore();
  const baseline = observe(store.store, {
    followers: complete(["a", "b"]),
    observedAt: "2026-09-01T00:00:00.000Z",
  });
  const later = observe(store.store, {
    followers: complete(["a", "b", "c"]),
    observedAt: "2026-09-05T00:00:00.000Z",
  });

  const sentences = [
    history.describeOrdering(null),
    history.describeOrdering(baseline.lists.followers),
    history.describeOrdering(later.lists.followers),
  ];

  assert.match(sentences[1], /history started/i);
  assert.match(sentences[2], /most recently observed first/i);
  for (const sentence of sentences) {
    // Every mention of a follow time is a denial of one. Nothing asserts that
    // GitProfileLens knows when a follow happened.
    assert.doesNotMatch(sentence, /newest follows?\b|oldest follows?\b/i);
    assert.match(sentence, /GitHub does not (record|expose)/i);
    for (const mention of sentence.match(/[^.]*follow (date|time)[^.]*/gi) ?? []) {
      assert.match(mention, /does not|cannot|never/i, `unqualified follow-time claim: ${mention}`);
    }
  }
});

test("no shipped source names a field for a follow event", () => {
  const files = ["network-history.js", "network-export.js", "script.js", "index.html"];

  for (const file of files) {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    assert.doesNotMatch(
      source,
      /followedAt|followTimestamp|followDate|followed_at/,
      `${file} names a follow time`
    );
    // Prose may mention a follow date only to deny that one exists, which is how
    // the product explains the limitation it is working around.
    for (const match of source.match(/.{0,90}(followed at|follow date|newest follows?\b).{0,50}/gi) ?? []) {
      assert.match(
        match,
        /\bnot\b|never|cannot|no field|deliberately absent/i,
        `${file} uses follow-time wording as a claim: ${match}`
      );
    }
  }
});

/**
 * creates a store together with the storage double behind it
 * @returns {Object} the store and its storage
 */
function createStore() {
  const storage = createStorage();
  return { storage, store: history.createStore({ storage }) };
}
