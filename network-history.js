/**
 * initializes the network observation history module for browsers and node tests
 * @param {Object} root global object receiving the browser module
 * @param {Function} factory function that creates the history api
 * @returns {void} no return value
 */
(function initializeNetworkHistoryModule(root, factory) {
  const historyModule = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = historyModule;
  }

  root.GitProfileNetworkHistory = historyModule;
})(
  typeof globalThis !== "undefined" ? globalThis : window,
  /**
   * creates the locally observed relationship history api
   *
   * What this module does and does not claim
   * ----------------------------------------
   * GitHub exposes no follow timestamp and documents no ordering for the follower
   * and following endpoints (docs/network-ordering.md records the evidence). This
   * module therefore never records when a follow happened. It records when
   * GitProfileLens *observed* a relationship on this device, which is a fact about
   * this browser rather than a fact about GitHub.
   *
   * Every stored and exported field is named for that distinction:
   * `firstObservedAt`, `lastObservedAt`, `currentlyPresent`. No field is named for
   * a follow event, and a test scans the shipped source to keep it that way.
   *
   * @returns {Object} history api
   */
  function createNetworkHistoryModule() {
  /**
   * Storage schema version.
   *
   * A stored snapshot carrying any other version is not migrated and not trusted:
   * it is replaced by a fresh baseline. Guessing at the meaning of a shape this
   * build does not know would manufacture history, which is the one thing this
   * module exists to avoid.
   */
  const SCHEMA_VERSION = 1;

  /** Where the snapshot lives. Versioned so an old build never reads a new shape. */
  const STORAGE_KEY = "gitprofilelens.network-history.v1";

  /** The relationship lists a profile can accumulate history for. */
  const RELATIONSHIPS = ["followers", "following"];

  /**
   * How many audited profiles keep history before the least recently observed is dropped.
   *
   * History is a convenience for profiles the reader returns to, not an archive.
   * Browser storage is a small shared quota of no portable size, so the snapshot
   * is bounded rather than allowed to grow with every username ever typed into
   * the search box. This bound is not on its own enough to guarantee the snapshot
   * fits — see `createStore` for the measured sizes and what a refused write does.
   */
  const MAXIMUM_TRACKED_PROFILES = 20;

  /**
   * folds a github login to the identity github itself compares
   * @param {*} value raw login
   * @returns {string} normalized login, empty when unusable
   */
  function normalizeLogin(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  /**
   * converts an observation time into a stable iso string
   * @param {*} value date, timestamp, or iso string
   * @returns {string} iso timestamp
   */
  function toIsoTime(value) {
    const date = value instanceof Date ? value : new Date(value ?? Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  /**
   * reports whether a value is a usable iso timestamp
   * @param {*} value candidate timestamp
   * @returns {boolean} true when the value parses as a date
   */
  function isUsableTime(value) {
    return typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value));
  }

  /**
   * builds the empty snapshot a first run starts from
   * @returns {Object} empty versioned snapshot
   */
  function createEmptySnapshot() {
    return { schemaVersion: SCHEMA_VERSION, profiles: {} };
  }

  /**
   * validates one stored relationship entry, rejecting anything unusable
   *
   * A corrupted entry is dropped rather than repaired. A repaired entry would
   * carry an invented `firstObservedAt`, which is exactly the false chronology
   * this module refuses to produce.
   *
   * @param {*} entry stored relationship entry
   * @returns {Object|null} sanitized entry, or null when it cannot be trusted
   */
  function sanitizeEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const login = typeof entry.login === "string" ? entry.login.trim() : "";
    if (!login) return null;
    if (!isUsableTime(entry.firstObservedAt) || !isUsableTime(entry.lastObservedAt)) return null;

    const sanitized = {
      login,
      firstObservedAt: entry.firstObservedAt,
      lastObservedAt: entry.lastObservedAt,
      currentlyPresent: entry.currentlyPresent === true,
    };
    // Present only for a relationship that went absent and was later seen again.
    if (isUsableTime(entry.reappearedAt)) sanitized.reappearedAt = entry.reappearedAt;
    if (Number.isInteger(entry.absences) && entry.absences > 0) sanitized.absences = entry.absences;
    // Present only where GitProfileLens itself performed the unfollow and GitHub
    // confirmed it. Kept apart from `absences`, which counts the weaker evidence
    // of an account simply not turning up in a retrieval.
    if (isUsableTime(entry.unfollowConfirmedAt)) sanitized.unfollowConfirmedAt = entry.unfollowConfirmedAt;
    return sanitized;
  }

  /**
   * validates one stored relationship list
   * @param {*} list stored list
   * @returns {Object|null} sanitized list, or null when it cannot be trusted
   */
  function sanitizeList(list) {
    if (!list || typeof list !== "object") return null;
    if (!isUsableTime(list.baselineObservedAt) || !isUsableTime(list.lastObservedAt)) return null;
    if (!list.accounts || typeof list.accounts !== "object") return null;

    const accounts = {};
    for (const [key, entry] of Object.entries(list.accounts)) {
      const normalized = normalizeLogin(key);
      const sanitized = sanitizeEntry(entry);
      if (normalized && sanitized) accounts[normalized] = sanitized;
    }

    return {
      baselineObservedAt: list.baselineObservedAt,
      lastObservedAt: list.lastObservedAt,
      observationCount: Number.isInteger(list.observationCount) && list.observationCount > 0
        ? list.observationCount
        : 1,
      accounts,
    };
  }

  /**
   * validates a parsed snapshot, discarding anything this build cannot read
   *
   * A version this build does not know is not migrated. Nothing in an unknown
   * shape can be interpreted safely, and a wrong interpretation would surface as
   * confident ordering, so the snapshot is replaced by an empty one and the next
   * observation starts a fresh baseline.
   *
   * @param {*} parsed parsed storage contents
   * @returns {Object} usable snapshot, empty when the stored one was not usable
   */
  function sanitizeSnapshot(parsed) {
    if (!parsed || typeof parsed !== "object") return createEmptySnapshot();
    if (parsed.schemaVersion !== SCHEMA_VERSION) return createEmptySnapshot();
    if (!parsed.profiles || typeof parsed.profiles !== "object") return createEmptySnapshot();

    const profiles = {};
    for (const [key, profile] of Object.entries(parsed.profiles)) {
      const normalized = normalizeLogin(key);
      if (!normalized || !profile || typeof profile !== "object") continue;

      const sanitizedProfile = {
        login: typeof profile.login === "string" && profile.login.trim() ? profile.login.trim() : key,
      };
      let usableLists = 0;
      for (const relationship of RELATIONSHIPS) {
        const list = sanitizeList(profile[relationship]);
        if (list) {
          sanitizedProfile[relationship] = list;
          usableLists += 1;
        }
      }
      if (usableLists > 0) profiles[normalized] = sanitizedProfile;
    }

    return { schemaVersion: SCHEMA_VERSION, profiles };
  }

  /**
   * reports the most recent observation recorded anywhere in one profile
   * @param {Object} profile stored profile
   * @returns {number} epoch milliseconds, or 0 when nothing is recorded
   */
  function profileLastObservedTime(profile) {
    let latest = 0;
    for (const relationship of RELATIONSHIPS) {
      const list = profile[relationship];
      if (!list) continue;
      const time = Date.parse(list.lastObservedAt);
      if (!Number.isNaN(time) && time > latest) latest = time;
    }
    return latest;
  }

  /**
   * drops the least recently observed profiles once the snapshot exceeds its bound
   * @param {Object} snapshot snapshot being written
   * @param {string} keepNormalized profile that must survive the prune
   * @returns {void} no return value
   */
  function pruneProfiles(snapshot, keepNormalized) {
    const keys = Object.keys(snapshot.profiles);
    if (keys.length <= MAXIMUM_TRACKED_PROFILES) return;

    const ordered = keys
      .filter((profileKey) => profileKey !== keepNormalized)
      .sort((a, b) =>
        profileLastObservedTime(snapshot.profiles[b]) - profileLastObservedTime(snapshot.profiles[a]));

    for (const profileKey of ordered.slice(MAXIMUM_TRACKED_PROFILES - 1)) {
      delete snapshot.profiles[profileKey];
    }
  }

  /**
   * merges one complete observation of a relationship list into its stored history
   *
   * Cohort semantics, which are the point of this function
   * ------------------------------------------------------
   * Every relationship first seen in the same observation receives the *same*
   * `firstObservedAt`. That is the honest reading of what a snapshot establishes:
   * observing 131 followers at once proves all 131 existed by that moment and
   * proves nothing about their order relative to each other. Using a per-account
   * insertion time would turn loop iteration order into apparent chronology, which
   * would be a fabricated ordering wearing the costume of evidence.
   *
   * The first observation of a list is therefore one baseline cohort, and each
   * later observation adds at most one new cohort.
   *
   * @param {Object|null} previous stored list, or null on the first observation
   * @param {Array<Object>} accounts accounts observed, in the order github returned them
   * @param {string} observedAt iso observation time shared by everything seen now
   * @returns {Object} the merged list and whether anything about it changed
   */
  function mergeList(previous, accounts, observedAt) {
    const seen = new Map();
    for (const account of accounts) {
      const normalized = normalizeLogin(account?.login);
      // Later duplicates cannot add information; the first spelling is kept.
      if (normalized && !seen.has(normalized)) seen.set(normalized, String(account.login).trim());
    }

    if (!previous) {
      const merged = {
        baselineObservedAt: observedAt,
        lastObservedAt: observedAt,
        observationCount: 1,
        accounts: {},
      };
      for (const [normalized, login] of seen) {
        merged.accounts[normalized] = {
          login,
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          currentlyPresent: true,
        };
      }
      return { list: merged, changed: true, baseline: true, added: [...seen.keys()], removed: [] };
    }

    const merged = {
      baselineObservedAt: previous.baselineObservedAt,
      lastObservedAt: observedAt,
      observationCount: previous.observationCount + 1,
      accounts: {},
    };
    const added = [];
    const removed = [];
    let changed = previous.lastObservedAt !== observedAt;

    for (const [normalized, login] of seen) {
      const existing = previous.accounts[normalized];
      if (!existing) {
        merged.accounts[normalized] = {
          login,
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          currentlyPresent: true,
        };
        added.push(normalized);
        changed = true;
        continue;
      }

      const entry = {
        // GitHub renders a login in one casing at a time; the current one wins.
        login,
        firstObservedAt: existing.firstObservedAt,
        lastObservedAt: observedAt,
        currentlyPresent: true,
      };
      if (existing.reappearedAt) entry.reappearedAt = existing.reappearedAt;
      if (existing.absences) entry.absences = existing.absences;

      // A relationship that was absent and is present again is recorded as a
      // reappearance rather than quietly re-described as uninterrupted. Its
      // firstObservedAt is not rewritten, because the first observation really did
      // happen then; what the gap means on GitHub's side is unknowable from here.
      if (existing.currentlyPresent === false) {
        entry.reappearedAt = observedAt;
        changed = true;
      }
      if (existing.login !== login) changed = true;
      merged.accounts[normalized] = entry;
    }

    for (const [normalized, existing] of Object.entries(previous.accounts)) {
      if (seen.has(normalized)) continue;
      // Absent from a *complete* list, so the absence is evidence rather than a
      // hole in retrieval. lastObservedAt freezes at the last positive sighting.
      merged.accounts[normalized] = {
        ...existing,
        currentlyPresent: false,
        absences: existing.currentlyPresent === false
          ? existing.absences ?? 1
          : (existing.absences ?? 0) + 1,
      };
      if (existing.currentlyPresent !== false) {
        removed.push(normalized);
        changed = true;
      }
    }

    return { list: merged, changed, baseline: false, added, removed };
  }

  /**
   * groups a list's relationships into the cohorts its observations established
   * @param {Object|null} list stored relationship list
   * @returns {Array<string>} distinct first-observation times, newest first
   */
  function listCohorts(list) {
    if (!list) return [];
    const times = new Set();
    for (const entry of Object.values(list.accounts)) times.add(entry.firstObservedAt);
    return [...times].sort((a, b) => Date.parse(b) - Date.parse(a));
  }

  /**
   * orders accounts most recently first observed first, without inventing order
   *
   * The sort key is the cohort time, never a per-account position, so every
   * relationship first seen in the same observation compares equal and keeps the
   * neutral order it arrived in. JavaScript's sort is required to be stable, so
   * "keeps the order it arrived in" is a guarantee rather than an accident.
   *
   * A list with no recorded history is returned untouched in GitHub's order, which
   * is what the interface already describes when no history exists.
   *
   * @param {Array<Object>} accounts accounts in the order github returned them
   * @param {Object|null} list stored relationship list for these accounts
   * @returns {Object} the ordered accounts and whether history actually ordered them
   */
  function orderAccounts(accounts, list) {
    const source = Array.isArray(accounts) ? accounts : [];
    if (!list) {
      return { accounts: source, ordered: false, baselineObservedAt: null, cohortCount: 0 };
    }

    const cohorts = listCohorts(list);
    const rank = new Map(cohorts.map((time, index) => [time, index]));
    // An account with no recorded cohort cannot be placed by evidence, so it sorts
    // with the baseline rather than being promoted to look newly observed.
    const unknownRank = cohorts.length;

    const ordered = source
      .map((account, index) => ({ account, index }))
      .sort((a, b) => {
        const entryA = list.accounts[normalizeLogin(a.account?.login)];
        const entryB = list.accounts[normalizeLogin(b.account?.login)];
        const rankA = entryA ? rank.get(entryA.firstObservedAt) ?? unknownRank : unknownRank;
        const rankB = entryB ? rank.get(entryB.firstObservedAt) ?? unknownRank : unknownRank;
        return rankA - rankB || a.index - b.index;
      })
      .map((entry) => entry.account);

    return {
      accounts: ordered,
      ordered: cohorts.length > 1,
      baselineObservedAt: list.baselineObservedAt,
      cohortCount: cohorts.length,
    };
  }

  /**
   * reads one account's stored observation record
   * @param {Object|null} list stored relationship list
   * @param {*} login github login
   * @returns {Object|null} the stored entry, or null when it is not recorded
   */
  function findEntry(list, login) {
    if (!list) return null;
    return list.accounts[normalizeLogin(login)] ?? null;
  }

  /**
   * reports whether an account belongs to a list's first, order-free baseline cohort
   * @param {Object|null} list stored relationship list
   * @param {*} login github login
   * @returns {boolean} true when the account was present at the first observation
   */
  function isBaselineAccount(list, login) {
    const entry = findEntry(list, login);
    return Boolean(entry) && entry.firstObservedAt === list.baselineObservedAt;
  }

  /**
   * describes, in one sentence, what the ordering of a list currently means
   *
   * The wording never says "newest follows". Everything it can truthfully claim is
   * about observation on this device, so that is what it says.
   *
   * @param {Object|null} list stored relationship list
   * @returns {string} sentence for the interface and the Markdown export
   */
  function describeOrdering(list) {
    if (!list) {
      return "Accounts appear in the order the GitHub API returned them. GitHub does not record " +
        "when a follow happened, so this is not a follow chronology.";
    }
    if (listCohorts(list).length <= 1) {
      return "Relationship history started on this device at the first observation, so every " +
        "account below was first seen together and their historical order is unknown. GitHub " +
        "does not record when a follow happened; ordering becomes useful as later observations " +
        "accumulate.";
    }
    return "Most recently observed first. GitHub does not expose follow dates, so GitProfileLens " +
      "orders these accounts by when it first observed them on this device. Accounts first seen " +
      "in the same observation keep GitHub's order, because their order relative to each other " +
      "is unknown.";
  }

  /**
   * creates a history store bound to one storage implementation
   *
   * Why browser storage, and why this shape
   * ---------------------------------------
   * GitProfileLens is a static page plus stateless functions: there is no account
   * system, no database, and no per-reader server state to extend. Observation
   * history is also inherently per-device evidence, so uploading it would both
   * require infrastructure the product does not have and turn a local note into a
   * server-side record of whose followers someone looked at. `localStorage` fits
   * the data: one small JSON object, read once per Network load, written at most
   * once per observation, and never on the critical path of a request.
   *
   * The snapshot is not guaranteed to fit, and is not claimed to. Measured, it
   * costs about 154 bytes per relationship: roughly 84 KB for a live-sized
   * profile, about 3.1 MB for one profile at the pagination caps, and about 59 MB
   * for twenty such profiles. There is no portable quota to design against, so
   * rather than pretending the bound is tighter than it is, a refused write is a
   * first-class outcome: prior history survives, this session does not run ahead
   * of what was stored, the profile in view is preferred over the others, and the
   * interface says what happened. Ordinary use is far inside any plausible quota;
   * twenty live-sized profiles come to roughly 1.7 MB.
   *
   * @param {Object} options storage implementation and optional key override
   * @returns {Object} history store
   */
  function createStore(options = {}) {
    const storage = options.storage ?? null;
    const key = options.key ?? STORAGE_KEY;
    // Parsed at most once per store, so repeated reads during one render never
    // re-parse the snapshot. Writes keep it in step with what was persisted.
    let cached = null;

    /**
     * reports whether persistence is usable at all
     * @returns {boolean} true when a storage implementation was supplied
     */
    function isAvailable() {
      return Boolean(storage);
    }

    /**
     * reads and validates the stored snapshot, parsing it at most once
     * @returns {Object} usable snapshot
     */
    function read() {
      if (cached) return cached;
      if (!storage) {
        cached = createEmptySnapshot();
        return cached;
      }

      let raw = null;
      try {
        raw = storage.getItem(key);
      } catch {
        // Storage can be blocked outright; history is optional, the Network is not.
        cached = createEmptySnapshot();
        return cached;
      }

      if (!raw) {
        cached = createEmptySnapshot();
        return cached;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      cached = sanitizeSnapshot(parsed);
      return cached;
    }

    /**
     * persists a snapshot, adopting it only if it actually reached storage
     *
     * The cache is what the rest of the session reads, so adopting a snapshot the
     * browser refused would leave this session ordering by cohorts that do not
     * exist on disk and silently reverting on the next reload. A feature whose
     * whole purpose is to avoid claiming more than the evidence supports cannot
     * also show an order its own storage never accepted. A refused write therefore
     * leaves the previous snapshot in place, in memory and on disk alike.
     *
     * A failed `setItem` does not modify the existing entry, so prior history
     * survives a refusal intact.
     *
     * @param {Object} snapshot snapshot to persist
     * @returns {Object} whether the write reached storage
     */
    function write(snapshot) {
      if (!storage) return { wrote: false, error: "unavailable" };
      try {
        storage.setItem(key, JSON.stringify(snapshot));
        cached = snapshot;
        return { wrote: true, error: null };
      } catch {
        // A full quota costs future history, never the network the reader asked for.
        return { wrote: false, error: "quota" };
      }
    }

    /**
     * writes a snapshot, surrendering other profiles' history before giving up
     *
     * A single large network can exceed the origin's quota on its own, and the
     * reader is looking at one profile, not twenty. So a refused write is retried
     * with only the profile being observed, which is the history most likely to be
     * wanted and the only one this observation can improve. If even that is
     * refused, nothing is written and prior history stands.
     *
     * @param {Object} snapshot snapshot to persist
     * @param {string} keepNormalized profile whose history matters most
     * @returns {Object} whether a write reached storage, and what it cost
     */
    function writeWithFallback(snapshot, keepNormalized) {
      const written = write(snapshot);
      if (written.wrote || written.error !== "quota") return { ...written, dropped: 0 };

      const others = Object.keys(snapshot.profiles).filter((name) => name !== keepNormalized);
      if (others.length === 0) return { ...written, dropped: 0 };

      const reduced = {
        schemaVersion: SCHEMA_VERSION,
        profiles: { [keepNormalized]: snapshot.profiles[keepNormalized] },
      };
      const retried = write(reduced);
      return { ...retried, dropped: retried.wrote ? others.length : 0 };
    }

    /**
     * reads one profile's stored history for one relationship
     * @param {*} login audited profile login
     * @param {string} relationship followers or following
     * @returns {Object|null} stored list, or null when none exists
     */
    function getList(login, relationship) {
      const profile = read().profiles[normalizeLogin(login)];
      return profile?.[relationship] ?? null;
    }

    /**
     * records one network observation for both relationship lists in a single write
     *
     * Completeness is respected per list. An incomplete list is never merged, so a
     * retrieval that stopped early can never mark the accounts it did not reach as
     * no longer present, and can never invent a cohort out of a partial page. Prior
     * history for that list is left exactly as it was.
     *
     * @param {Object} observation audited login, both retrieved lists, and the observation time
     * @returns {Object} the lists history can now order, and what the write did
     */
    function recordNetworkObservation(observation) {
      const login = String(observation?.login ?? "").trim();
      const normalized = normalizeLogin(login);
      const observedAt = toIsoTime(observation?.observedAt);
      const outcome = {
        wrote: false,
        changed: false,
        error: null,
        skipped: [],
        droppedProfiles: 0,
        lists: { followers: null, following: null },
        baseline: { followers: false, following: false },
      };
      if (!normalized) {
        outcome.error = "invalid-profile";
        return outcome;
      }

      const snapshot = read();
      const existing = snapshot.profiles[normalized];
      const profile = { login: login || existing?.login || normalized };
      for (const relationship of RELATIONSHIPS) {
        if (existing?.[relationship]) profile[relationship] = existing[relationship];
      }

      let changed = Boolean(existing) && existing.login !== profile.login;
      for (const relationship of RELATIONSHIPS) {
        const retrieved = observation?.[relationship];
        if (!retrieved || retrieved.complete !== true || !Array.isArray(retrieved.accounts)) {
          outcome.skipped.push(relationship);
          outcome.lists[relationship] = profile[relationship] ?? null;
          continue;
        }

        const merged = mergeList(profile[relationship] ?? null, retrieved.accounts, observedAt);
        profile[relationship] = merged.list;
        outcome.lists[relationship] = merged.list;
        outcome.baseline[relationship] = merged.baseline;
        if (merged.changed) changed = true;
      }

      if (!profile.followers && !profile.following) {
        outcome.error = "nothing-to-record";
        return outcome;
      }

      outcome.changed = changed;
      // Re-observing the same accounts at the same instant, which is what a repeat
      // render does, produces an identical snapshot and is not written again.
      if (!changed && existing) return outcome;

      const next = { schemaVersion: SCHEMA_VERSION, profiles: { ...snapshot.profiles } };
      next.profiles[normalized] = profile;
      pruneProfiles(next, normalized);

      const written = writeWithFallback(next, normalized);
      outcome.wrote = written.wrote;
      outcome.error = written.error;
      outcome.droppedProfiles = written.dropped;
      // A refused write left the stored snapshot untouched, so the lists this
      // observation would have ordered by are not the ones history actually holds.
      // Reporting what was persisted keeps the display and the storage in step.
      if (!written.wrote) {
        for (const relationship of RELATIONSHIPS) {
          outcome.lists[relationship] = existing?.[relationship] ?? null;
          outcome.baseline[relationship] = false;
        }
      }
      return outcome;
    }

    /**
     * deletes every profile's observation history
     * @returns {Object} whether the reset reached storage
     */
    function reset() {
      cached = createEmptySnapshot();
      if (!storage) return { wrote: false, error: "unavailable" };
      try {
        storage.removeItem(key);
        return { wrote: true, error: null };
      } catch {
        return { wrote: false, error: "unavailable" };
      }
    }

    /**
     * deletes one profile's observation history, leaving other profiles alone
     * @param {*} login audited profile login
     * @returns {Object} whether the reset reached storage
     */
    function resetProfile(login) {
      const normalized = normalizeLogin(login);
      const snapshot = read();
      if (!normalized || !snapshot.profiles[normalized]) return { wrote: false, error: "not-found" };
      const next = { schemaVersion: SCHEMA_VERSION, profiles: { ...snapshot.profiles } };
      delete next.profiles[normalized];
      return write(next);
    }

    /**
     * counts the profiles currently holding history
     * @returns {number} number of tracked profiles
     */
    function countProfiles() {
      return Object.keys(read().profiles).length;
    }

    /**
     * records that gitprofilelens unfollowed one account and github confirmed it
     *
     * Why this writes at all, rather than waiting for the next retrieval
     * ------------------------------------------------------------------
     * Everything else in this store is an observation: GitProfileLens looked, and
     * records what it saw. This is stronger. GitHub was asked to end the
     * relationship and answered that it had. Waiting for the next complete
     * Following retrieval to notice would leave the history asserting a
     * relationship that GitProfileLens knows first-hand is over, which is the one
     * kind of falsehood this module exists to avoid.
     *
     * What it deliberately does not do
     * --------------------------------
     * `firstObservedAt` is untouched. The first observation really did happen
     * then, and an unfollow says nothing about when the follow began.
     * `lastObservedAt` is untouched too, freezing at the last positive sighting
     * exactly as an observed absence does. The absence is recorded as
     * `unfollowConfirmedAt` rather than by incrementing `absences`, because those are
     * different kinds of evidence: `absences` counts times an account did not turn
     * up in a list, and this account did not fail to turn up, it was removed.
     *
     * An account with no history is not invented here. Recording an unfollow for a
     * relationship this browser never observed would create an entry whose
     * `firstObservedAt` is a guess.
     *
     * @param {Object} mutation audited login, target login, and confirmation time
     * @returns {Object} what changed and whether the write reached storage
     */
    function recordUnfollow(mutation) {
      const normalized = normalizeLogin(mutation?.login);
      const target = normalizeLogin(mutation?.target);
      const confirmedAt = toIsoTime(mutation?.confirmedAt);
      const outcome = { wrote: false, changed: false, error: null, list: null };
      if (!normalized || !target) {
        outcome.error = "invalid-target";
        return outcome;
      }

      const snapshot = read();
      const existing = snapshot.profiles[normalized];
      const list = existing?.following ?? null;
      const entry = list?.accounts?.[target] ?? null;
      if (!entry) {
        outcome.error = "not-tracked";
        outcome.list = list;
        return outcome;
      }
      if (entry.currentlyPresent === false && entry.unfollowConfirmedAt) {
        // Already recorded; a repeat confirmation is not new evidence.
        outcome.list = list;
        return outcome;
      }

      const updatedList = {
        ...list,
        accounts: {
          ...list.accounts,
          [target]: { ...entry, currentlyPresent: false, unfollowConfirmedAt: confirmedAt },
        },
      };
      const next = { schemaVersion: SCHEMA_VERSION, profiles: { ...snapshot.profiles } };
      next.profiles[normalized] = { ...existing, following: updatedList };

      const written = writeWithFallback(next, normalized);
      outcome.changed = true;
      outcome.wrote = written.wrote;
      outcome.error = written.error;
      // A refused write left storage holding the old entry, so the list reported
      // back is the one storage actually has.
      outcome.list = written.wrote ? updatedList : getList(normalized, "following");
      return outcome;
    }

    return {
      countProfiles,
      getList,
      isAvailable,
      read,
      recordNetworkObservation,
      recordUnfollow,
      reset,
      resetProfile,
    };
  }

  return {
    MAXIMUM_TRACKED_PROFILES,
    RELATIONSHIPS,
    SCHEMA_VERSION,
    STORAGE_KEY,
    createStore,
    describeOrdering,
    findEntry,
    isBaselineAccount,
    listCohorts,
    mergeList,
    normalizeLogin,
    orderAccounts,
  };
  }
);
