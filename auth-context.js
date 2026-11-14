/**
 * shared rules for carrying the reader's place through GitHub authorization
 *
 * Loaded by the browser as `GitProfileAuthContext` and required by the
 * serverless auth routes, so the rule that decides where a reader may be sent
 * back to is written once and enforced on both sides of the redirect.
 *
 * @param {Object} root global object in the browser
 * @param {Function} factory function that creates the module
 */
(function initializeAuthContextModule(root, factory) {
  const authContext = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = authContext;
  } else {
    root.GitProfileAuthContext = authContext;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createAuthContextModule() {
  /** The result views a return destination may name. */
  const RESULT_VIEWS = ["overview", "audit", "repositories", "network", "pinned", "markdown"];
  /** The outcomes the OAuth callback reports back in `auth=`. */
  const AUTH_OUTCOMES = ["success", "manage-follows", "denied", "error", "invalid"];
  /** GitHub's own rule for a login: alphanumerics and single hyphens, 39 at most. */
  const USERNAME_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
  /** Longest raw return value considered at all. */
  const MAX_RETURN_LENGTH = 512;
  /** A base that only exists to let URL parse a relative path; never emitted. */
  const PARSE_BASE = "https://gitprofilelens.invalid";

  const HANDOFF_KEY = "gitprofilelens.auth-handoff.v1";
  const HANDOFF_VERSION = 1;
  /** How long an audit handed across an authorization stays usable. */
  const HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

  const RETURN_MEMORY_KEY = "gitprofilelens.auth-return.v1";
  /** Long enough to outlive a stalled GitHub consent screen, short enough to go stale. */
  const RETURN_MEMORY_MAX_AGE_MS = 60 * 60 * 1000;

  /**
   * reduces a requested return destination to one this application may redirect to
   *
   * The result is rebuilt from scratch rather than passed through: it is always
   * the application root, followed only by a valid login, a known result view,
   * and the one management view. Anything else in the input, including anything
   * that looks like a credential, is dropped, and anything that could name
   * another origin is refused outright. Both the route that starts authorization
   * and the callback that finishes it apply this, so a tampered cookie cannot
   * widen what the first check allowed.
   *
   * @param {*} raw requested destination
   * @returns {string|null} a same-origin path, or null when the input is unusable
   */
  function normalizeReturnPath(raw) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN_LENGTH) return null;
    // Only a root-relative path. "//host" and "/\host" are protocol-relative to
    // browsers, and nothing legitimate here contains a backslash or a control
    // character.
    if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) {
      return null;
    }

    let parsed;
    try {
      parsed = new URL(raw, PARSE_BASE);
    } catch {
      return null;
    }
    if (parsed.origin !== PARSE_BASE || parsed.pathname !== "/") return null;

    return buildReturnPath({
      user: parsed.searchParams.get("user"),
      view: parsed.searchParams.get("view"),
      manage: parsed.searchParams.get("manage"),
    });
  }

  /**
   * builds a return destination from the parts of the reader's current place
   * @param {Object} context user, view, and manage values; invalid ones are dropped
   * @returns {string} a same-origin path
   */
  function buildReturnPath(context = {}) {
    const parameters = new URLSearchParams();
    const user = typeof context.user === "string" ? context.user.trim() : "";
    const managing = context.manage === "unfollows";
    const view = managing ? "network" : context.view;

    if (USERNAME_PATTERN.test(user)) parameters.set("user", user);
    if (RESULT_VIEWS.includes(view)) parameters.set("view", view);
    if (managing) parameters.set("manage", "unfollows");

    const query = parameters.toString();
    return query ? `/?${query}` : "/";
  }

  /**
   * reads the callback outcome from a query string, recognizing only known values
   * @param {string} search location search string
   * @returns {string|null} the outcome, or null
   */
  function readAuthOutcome(search) {
    const outcome = new URLSearchParams(search || "").get("auth");
    return AUTH_OUTCOMES.includes(outcome) ? outcome : null;
  }

  /**
   * decides what the homepage username field should hold
   *
   * Precedence: a profile the reader explicitly asked for, then whatever they
   * typed in this workflow, then the account they are signed in as. A signed-in
   * login is only ever a default; it never replaces a choice the reader made.
   *
   * @param {Object} sources explicit, typed, and authLogin values
   * @returns {string} the username to show
   */
  function chooseHomeUsername(sources = {}) {
    for (const candidate of [sources.explicit, sources.typed, sources.authLogin]) {
      const value = typeof candidate === "string" ? candidate.trim() : "";
      if (value) return value;
    }
    return "";
  }

  /**
   * creates the single-use store that carries a public audit across a redirect
   *
   * An OAuth round trip is a full page navigation, so without this the page
   * comes back empty and has to fetch the whole profile again from an
   * unauthenticated allowance of sixty requests an hour. The store holds one
   * public audit, for one profile, for ten minutes, and gives it back once. It
   * is never written for a private audit, and it never holds anything that could
   * act as the reader.
   *
   * @param {Object} options storage, clock, and maximum age
   * @returns {Object} save, take, and clear
   */
  function createHandoffStore(options = {}) {
    const storage = options.storage ?? null;
    const now = options.now ?? (() => Date.now());
    const maxAgeMs = options.maxAgeMs ?? HANDOFF_MAX_AGE_MS;

    function clear() {
      if (!storage) return;
      try {
        storage.removeItem(HANDOFF_KEY);
      } catch {
        // Unavailable storage has nothing to clear.
      }
    }

    function save(payload) {
      if (!storage || !payload || !USERNAME_PATTERN.test(String(payload.login || ""))) return false;
      try {
        storage.setItem(HANDOFF_KEY, JSON.stringify({
          version: HANDOFF_VERSION,
          savedAt: now(),
          login: payload.login,
          audit: payload.audit ?? null,
          network: payload.network ?? null,
        }));
        return true;
      } catch {
        // A full or blocked store costs one refetch after sign-in, nothing more.
        clear();
        return false;
      }
    }

    function take(login) {
      if (!storage) return null;
      let raw = null;
      try {
        raw = storage.getItem(HANDOFF_KEY);
      } catch {
        return null;
      }
      clear();
      if (!raw) return null;

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      if (!parsed || parsed.version !== HANDOFF_VERSION || typeof parsed.login !== "string") return null;
      if (parsed.login.toLowerCase() !== String(login || "").toLowerCase()) return null;
      const age = now() - Number(parsed.savedAt);
      if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
      return parsed;
    }

    return { save, take, clear };
  }

  /**
   * remembers, in this tab, where the reader was when an authorization started
   *
   * The server keeps the same destination in a cookie that lives exactly as long
   * as the OAuth state. When that state has expired, or a reader returns to a
   * callback a second time, the server can no longer vouch for the destination
   * and sends them to the homepage. This lets the page put them back where they
   * started anyway. It holds one normalized same-origin path and nothing else,
   * and is read once.
   *
   * @param {Object} options storage, clock, and maximum age
   * @returns {Object} remember and recall
   */
  function createReturnMemory(options = {}) {
    const storage = options.storage ?? null;
    const now = options.now ?? (() => Date.now());
    const maxAgeMs = options.maxAgeMs ?? RETURN_MEMORY_MAX_AGE_MS;

    function remember(path) {
      const normalized = normalizeReturnPath(path);
      if (!storage || !normalized) return false;
      try {
        storage.setItem(RETURN_MEMORY_KEY, JSON.stringify({ version: 1, savedAt: now(), path: normalized }));
        return true;
      } catch {
        return false;
      }
    }

    function recall() {
      if (!storage) return null;
      let raw = null;
      try {
        raw = storage.getItem(RETURN_MEMORY_KEY);
        storage.removeItem(RETURN_MEMORY_KEY);
      } catch {
        return null;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      if (!parsed || parsed.version !== 1) return null;
      const age = now() - Number(parsed.savedAt);
      if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
      return normalizeReturnPath(parsed.path);
    }

    return { remember, recall };
  }

  return {
    RESULT_VIEWS,
    AUTH_OUTCOMES,
    HANDOFF_KEY,
    HANDOFF_MAX_AGE_MS,
    RETURN_MEMORY_KEY,
    RETURN_MEMORY_MAX_AGE_MS,
    createReturnMemory,
    normalizeReturnPath,
    buildReturnPath,
    readAuthOutcome,
    chooseHomeUsername,
    createHandoffStore,
    isValidLogin: (value) => USERNAME_PATTERN.test(String(value ?? "")),
  };
});
