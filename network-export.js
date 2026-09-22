/**
 * initializes the public follower network module for browsers and node tests
 * @param {Object} root global object receiving the browser module
 * @param {Function} factory function that creates the network export api
 * @returns {void} no return value
 */
(function initializeNetworkModule(root, factory) {
  const auditModule = typeof require === "function" ? require("./audit.js") : root.GitHubAudit;
  const networkModule = factory(auditModule);

  if (typeof module === "object" && module.exports) {
    module.exports = networkModule;
  }

  root.GitProfileNetwork = networkModule;
})(
  typeof globalThis !== "undefined" ? globalThis : window,
  /**
   * creates the public follower and following export api
   * @param {Object} audit shared audit module providing username validation
   * @returns {Object} public network retrieval and Markdown functions
   */
  function createNetworkModule(audit) {
  const API_ORIGIN = "https://api.github.com";
  const PROFILE_ORIGIN = "https://github.com";
  const PER_PAGE = 100;
  const MAX_PAGES = 100;

  /**
   * how these lists are ordered, stated without claiming a chronology
   *
   * GitHub's follower and following endpoints return only account identities: no
   * field records when one account followed another, and no ordering is documented
   * for either endpoint. The GraphQL edge types carry only a cursor and a node, and
   * neither relationship field accepts an ordering argument, so no GitHub API can
   * tell GitProfileLens which follow is newer. These lists therefore keep the order
   * the API returned and say so, rather than implying a newest-to-oldest reading.
   *
   * GitProfileLens can order these lists by when it first *observed* each
   * relationship on the reader's own device, which is a different and much weaker
   * claim. When that history exists the caller supplies both the ordered accounts
   * and the sentence describing them, so the export and the interface can never
   * present different orders or describe the same order differently.
   */
  const ORDERING_NOTE =
    "Accounts appear in the order the GitHub API returned them. GitHub does not record " +
    "when a follow happened and does not document an order for these lists, so this is " +
    "not a newest-to-oldest follow history.";

  /**
   * builds an error carrying a stable reason for the interface to branch on
   * @param {string} message user-facing message
   * @param {string} reason machine-readable failure reason
   * @returns {Error} error with an attached reason
   */
  function createNetworkError(message, reason) {
    const error = new Error(message);
    error.reason = reason;
    return error;
  }

  /**
   * validates a github username before any request is made
   * @param {*} value candidate username
   * @returns {Object} validation outcome with the trimmed username or a message
   */
  function validateUsername(value) {
    const username = String(value ?? "").trim();
    if (!username) {
      return { ok: false, message: "Enter a GitHub username." };
    }
    if (!audit.isValidUsername(username)) {
      return {
        ok: false,
        message: "That is not a valid GitHub username. Use letters, numbers, and single hyphens.",
      };
    }
    return { ok: true, username };
  }

  /**
   * builds a public github profile url from a login
   * @param {string} login github login
   * @returns {string} public profile url
   */
  function buildProfileUrl(login) {
    const encodedLogin = encodeURIComponent(String(login ?? "")).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
    return `${PROFILE_ORIGIN}/${encodedLogin}`;
  }

  /**
   * formats a github rate-limit reset header for an error message
   * @param {string|null} resetHeader unix reset timestamp header
   * @returns {string} formatted reset-time sentence or a generic retry sentence
   */
  function formatRateLimitReset(resetHeader) {
    if (!resetHeader) return " Try again later.";
    const resetDate = new Date(Number(resetHeader) * 1000);
    if (Number.isNaN(resetDate.getTime())) return " Try again later.";
    return ` Try again after ${resetDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }

  /**
   * requests json from github and translates failures into useful messages
   * @param {string} url github api url
   * @param {Function} fetchImpl fetch implementation to use
   * @returns {Promise<Object|Array>} parsed json response
   */
  async function requestJson(url, fetchImpl) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch {
      throw createNetworkError(
        "Could not reach GitHub. Check your connection and try again.",
        "network"
      );
    }

    if (response.status === 404) {
      throw createNetworkError(
        "GitHub user not found. Check the username and try again.",
        "not-found"
      );
    }

    if (response.status === 401) {
      throw createNetworkError(
        "GitHub rejected this request. Sign in again and retry.",
        "unauthorized"
      );
    }

    if (response.status === 403 || response.status === 429) {
      const resetTime = formatRateLimitReset(response.headers?.get?.("X-RateLimit-Reset"));
      throw createNetworkError(
        `GitHub's public API rate limit was reached.${resetTime}`,
        "rate-limit"
      );
    }

    if (!response.ok) {
      throw createNetworkError(
        `GitHub request failed (${response.status}). Try again shortly.`,
        "http"
      );
    }

    try {
      return await response.json();
    } catch {
      throw createNetworkError(
        "GitHub returned a response that could not be read. Try again shortly.",
        "parse"
      );
    }
  }

  /**
   * reads a public login from a github account payload
   * @param {Object} account raw github account entry
   * @returns {string|null} login or null when the entry is unusable
   */
  function readLogin(account) {
    const login = account && typeof account.login === "string" ? account.login.trim() : "";
    return login ? login : null;
  }

  /**
   * retrieves one complete relationship list, following github pagination
   * @param {string} username github login owning the relationship
   * @param {string} relationship either followers or following
   * @param {Function} fetchImpl fetch implementation to use
   * @returns {Promise<Object>} retrieved accounts with an explicit completeness flag
   */
  async function fetchRelationshipList(username, relationship, fetchImpl) {
    const accounts = [];
    let page = 1;

    while (page <= MAX_PAGES) {
      const url =
        `${API_ORIGIN}/users/${encodeURIComponent(username)}/${relationship}` +
        `?per_page=${PER_PAGE}&page=${page}`;

      let pageAccounts;
      try {
        pageAccounts = await requestJson(url, fetchImpl);
      } catch (error) {
        return { accounts, complete: false, error: error.message, pagesLoaded: page - 1 };
      }

      if (!Array.isArray(pageAccounts)) {
        return {
          accounts,
          complete: false,
          error: "GitHub returned an unexpected response while paginating.",
          pagesLoaded: page - 1,
        };
      }

      for (const account of pageAccounts) {
        const login = readLogin(account);
        if (!login) {
          return {
            accounts,
            complete: false,
            error: "GitHub returned an account without a public login.",
            pagesLoaded: page - 1,
          };
        }
        accounts.push({ login, profileUrl: buildProfileUrl(login) });
      }

      if (pageAccounts.length < PER_PAGE) {
        return { accounts, complete: true, error: null, pagesLoaded: page };
      }
      page += 1;
    }

    return {
      accounts,
      complete: false,
      error: `This network is larger than the ${MAX_PAGES * PER_PAGE} accounts this export can retrieve.`,
      pagesLoaded: MAX_PAGES,
    };
  }

  /**
   * reads an avatar url only when github supplied a safe https address
   * @param {*} value raw avatar_url value
   * @returns {string|null} usable avatar url or null
   */
  function readAvatarUrl(value) {
    return typeof value === "string" && value.startsWith("https://") ? value : null;
  }

  /**
   * reads a reported relationship count from a github profile payload
   * @param {*} value raw profile count
   * @returns {number|null} count or null when github did not report one
   */
  function readReportedCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  /**
   * retrieves the public profile plus the complete follower and following lists
   * @param {string} username github username to export
   * @param {Object} options optional fetch implementation override
   * @returns {Promise<Object>} network result with per-list completeness
   */
  async function fetchNetwork(username, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const validation = validateUsername(username);
    if (!validation.ok) {
      throw createNetworkError(validation.message, "validation");
    }

    const profile = await requestJson(
      `${API_ORIGIN}/users/${encodeURIComponent(validation.username)}`,
      fetchImpl
    );
    const login = readLogin(profile) || validation.username;

    const [followers, following] = await Promise.all([
      fetchRelationshipList(login, "followers", fetchImpl),
      fetchRelationshipList(login, "following", fetchImpl),
    ]);

    return {
      user: {
        login,
        name: typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : null,
        avatarUrl: readAvatarUrl(profile.avatar_url),
        profileUrl: buildProfileUrl(login),
        reportedFollowers: readReportedCount(profile.followers),
        reportedFollowing: readReportedCount(profile.following),
      },
      followers,
      following,
      complete: followers.complete && following.complete,
    };
  }

  /**
   * derives the accounts a profile follows that do not follow it back
   *
   * GitHub logins are case-insensitive identities, so the comparison is folded to
   * lower case while the returned accounts keep the spelling and ordering of the
   * following response. The difference is only meaningful when both lists were
   * retrieved completely: a login missing from a partial followers list may sit on
   * a page that never arrived, so an incomplete retrieval yields null rather than
   * an unsafe claim that someone does not follow back.
   *
   * @param {Object} network retrieved network result
   * @returns {Array<Object>|null} following accounts absent from followers, or null
   */
  function deriveNotFollowingBack(network) {
    if (!network || !network.followers?.complete || !network.following?.complete) {
      return null;
    }

    const followerLogins = new Set(
      network.followers.accounts.map((account) => account.login.toLowerCase())
    );
    return network.following.accounts.filter(
      (account) => !followerLogins.has(account.login.toLowerCase())
    );
  }

  /**
   * escapes markdown control characters in text taken from github
   * @param {*} value value to escape
   * @returns {string} markdown safe string
   */
  function escapeNetworkMarkdown(value) {
    return String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, " ")
      .replace(/([`*_{}[\]()#+!|<>])/g, "\\$1");
  }

  /**
   * explains a difference between github's reported counts and the retrieved lists
   * @param {Object} network retrieved network result
   * @returns {string|null} explanation sentence or null when the counts agree
   */
  function buildCountNote(network) {
    const differences = [];
    const followerCount = network.followers.accounts.length;
    const followingCount = network.following.accounts.length;

    if (network.user.reportedFollowers !== null && network.user.reportedFollowers !== followerCount) {
      differences.push(`${network.user.reportedFollowers} followers`);
    }
    if (network.user.reportedFollowing !== null && network.user.reportedFollowing !== followingCount) {
      differences.push(`${network.user.reportedFollowing} following`);
    }
    if (differences.length === 0) return null;

    return (
      `GitHub's profile reported ${differences.join(" and ")} while this export was generated. ` +
      "GitHub relationship data can change while the lists are being retrieved, so the lists below " +
      "are what the API returned."
    );
  }

  /**
   * appends one numbered account list, representing an empty list honestly
   * @param {Array<string>} lines markdown lines being built
   * @param {Array<Object>} accounts retrieved accounts in github order
   * @returns {void} no return value
   */
  function appendAccountList(lines, accounts) {
    if (accounts.length === 0) {
      lines.push("None.", "");
      return;
    }

    accounts.forEach((account, index) => {
      lines.push(`${index + 1}. [${escapeNetworkMarkdown(account.login)}](${account.profileUrl})`);
    });
    lines.push("");
  }

  /**
   * reads one ordered account list supplied by the caller, falling back to API order
   *
   * A supplied list must name the same accounts as the retrieved one. Ordering is
   * the only thing a caller may change here; an export that quietly dropped or
   * added an account would no longer describe the network that was retrieved.
   *
   * @param {Array<Object>|undefined} supplied caller-ordered accounts
   * @param {Array<Object>} retrieved accounts in the order github returned them
   * @returns {Array<Object>} accounts to export
   */
  function readOrderedAccounts(supplied, retrieved) {
    if (!Array.isArray(supplied) || supplied.length !== retrieved.length) return retrieved;
    const expected = new Set(retrieved.map((account) => account.login.toLowerCase()));
    for (const account of supplied) {
      const login = typeof account?.login === "string" ? account.login.toLowerCase() : null;
      if (!login || !expected.delete(login)) return retrieved;
    }
    return supplied;
  }

  /**
   * builds deterministic markdown for a completely retrieved network
   * @param {Object} network retrieved network result
   * @param {Object} options optional caller-ordered lists and the sentence describing them
   * @returns {string} markdown document
   */
  function buildMarkdown(network, options = {}) {
    if (!network || !network.complete) {
      throw createNetworkError(
        "The complete follower and following lists could not be retrieved, so no export was generated.",
        "incomplete"
      );
    }

    const login = network.user.login;
    const followers = readOrderedAccounts(options.followers, network.followers.accounts);
    const following = readOrderedAccounts(options.following, network.following.accounts);
    // Non-follow-back has no chronology of its own: it is Following minus
    // Followers, so it inherits whatever order Following is presented in.
    const notFollowingBack = readOrderedAccounts(
      options.notFollowingBack,
      deriveNotFollowingBack({ ...network, following: { ...network.following, accounts: following } })
    );
    const lines = [
      "# GitHub Network",
      "",
      `**Username:** [${escapeNetworkMarkdown(login)}](${network.user.profileUrl})`,
      "",
      `**Followers:** ${followers.length}  `,
      `**Following:** ${following.length}  `,
      `**Following who don't follow back:** ${notFollowingBack.length}`,
      "",
    ];

    // One sentence, supplied by whoever decided the order, so the export can never
    // describe an ordering the interface is not showing.
    const orderingNote = typeof options.orderingNote === "string" && options.orderingNote.trim()
      ? options.orderingNote.trim()
      : ORDERING_NOTE;
    lines.push(`> ${orderingNote}`, "");

    const countNote = buildCountNote(network);
    if (countNote) lines.push(`> ${countNote}`, "");

    lines.push("## Followers", "");
    appendAccountList(lines, followers);
    lines.push("## Following", "");
    appendAccountList(lines, following);
    lines.push("## Following who don't follow back", "");
    appendAccountList(lines, notFollowingBack);

    return lines.join("\n");
  }

  /**
   * builds a safe download filename from a github username
   * @param {*} username github username
   * @returns {string} sanitized markdown filename
   */
  function buildFilename(username) {
    const safeUsername = String(username ?? "")
      .replace(/[^A-Za-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "")
      .slice(0, 39);
    return `${safeUsername || "github-user"}-followers-following.md`;
  }

  /**
   * summarizes which lists could not be completely retrieved
   * @param {Object} network retrieved network result
   * @returns {string|null} explanation sentence or null when the export is complete
   */
  function describeIncompleteRetrieval(network) {
    if (!network || network.complete) return null;

    const reasons = [];
    if (!network.followers.complete) {
      reasons.push(`Followers could not be fully retrieved. ${network.followers.error}`);
    }
    if (!network.following.complete) {
      reasons.push(`Following could not be fully retrieved. ${network.following.error}`);
    }
    reasons.push("The export is unavailable until the complete lists can be loaded.");
    return reasons.join(" ");
  }

  return {
    ORDERING_NOTE,
    buildFilename,
    buildMarkdown,
    buildProfileUrl,
    deriveNotFollowingBack,
    describeCountDifference: buildCountNote,
    describeIncompleteRetrieval,
    escapeNetworkMarkdown,
    fetchNetwork,
    formatRateLimitReset,
    validateUsername,
  };
  }
);
