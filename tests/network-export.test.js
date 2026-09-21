const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFilename,
  buildMarkdown,
  describeCountDifference,
  describeIncompleteRetrieval,
  fetchNetwork,
  validateUsername,
} = require("../network-export.js");

const PER_PAGE = 100;

/**
 * builds a github account page of the requested size
 * @param {string} prefix login prefix
 * @param {number} count number of accounts
 * @param {number} offset starting index
 * @returns {Array<Object>} raw github account entries
 */
function accountPage(prefix, count, offset = 0) {
  return Array.from({ length: count }, (unused, index) => ({
    login: `${prefix}-${offset + index + 1}`,
    html_url: `https://github.com/${prefix}-${offset + index + 1}`,
  }));
}

/**
 * builds a fetch double that answers from a route table
 * @param {Object} routes map of matcher descriptions to responses
 * @returns {Function} fetch implementation recording every requested url
 */
function createFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    for (const route of routes) {
      if (route.match(url)) return route.respond(url);
    }
    return jsonResponse(404, { message: "Not Found" });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/**
 * builds a minimal fetch response double
 * @param {number} status http status code
 * @param {*} body json body
 * @param {Object} headers response headers
 * @returns {Object} response double
 */
function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  };
}

/**
 * builds a fetch double serving a profile plus paginated relationship lists
 * @param {Object} options profile payload and relationship pages
 * @returns {Function} fetch implementation
 */
function createNetworkFetch({ profile, followerPages = [[]], followingPages = [[]] } = {}) {
  const profilePayload = profile || {
    login: "example",
    name: "Example User",
    avatar_url: "https://avatars.githubusercontent.com/u/1",
    followers: followerPages.flat().length,
    following: followingPages.flat().length,
  };

  return createFetch([
    {
      match: (url) => /\/users\/[^/]+$/.test(url),
      respond: () => jsonResponse(200, profilePayload),
    },
    {
      match: (url) => url.includes("/followers?"),
      respond: (url) => respondWithPage(url, followerPages),
    },
    {
      match: (url) => url.includes("/following?"),
      respond: (url) => respondWithPage(url, followingPages),
    },
  ]);
}

/**
 * answers a paginated request from a list of prepared pages
 * @param {string} url requested url
 * @param {Array} pages prepared pages or failure descriptors
 * @returns {Object} response double
 */
function respondWithPage(url, pages) {
  const page = Number(new URL(url).searchParams.get("page"));
  const entry = pages[page - 1];
  if (entry === undefined) return jsonResponse(200, []);
  if (entry && entry.failWith) return jsonResponse(entry.failWith, { message: "boom" }, entry.headers);
  return jsonResponse(200, entry);
}

test("username validation rejects empty and malformed usernames before requesting", () => {
  assert.deepEqual(validateUsername("  "), { ok: false, message: "Enter a GitHub username." });
  assert.equal(validateUsername("").ok, false);
  assert.equal(validateUsername("bad user").ok, false);
  assert.equal(validateUsername("-leading").ok, false);
  assert.equal(validateUsername("<script>alert(1)</script>").ok, false);
  assert.equal(validateUsername("../../etc/passwd").ok, false);
  assert.deepEqual(validateUsername("  quangshuynh  "), { ok: true, username: "quangshuynh" });
});

test("an invalid username never reaches the GitHub API", async () => {
  const fetchImpl = createNetworkFetch();
  await assert.rejects(
    () => fetchNetwork("not a username", { fetchImpl }),
    (error) => error.reason === "validation"
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("a successful retrieval returns profile identity and both lists", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", 3)],
    followingPages: [accountPage("following", 2)],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(network.user.login, "example");
  assert.equal(network.user.name, "Example User");
  assert.equal(network.user.profileUrl, "https://github.com/example");
  assert.equal(network.user.avatarUrl, "https://avatars.githubusercontent.com/u/1");
  assert.equal(network.complete, true);
  assert.equal(network.followers.accounts.length, 3);
  assert.equal(network.following.accounts.length, 2);
  assert.equal(network.followers.accounts[0].login, "follower-1");
  assert.equal(network.followers.accounts[0].profileUrl, "https://github.com/follower-1");
});

test("followers pagination retrieves every page rather than only the first", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", PER_PAGE), accountPage("follower", 17, PER_PAGE)],
    followingPages: [accountPage("following", 1)],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(network.followers.complete, true);
  assert.equal(network.followers.accounts.length, 117);
  assert.equal(network.followers.pagesLoaded, 2);
  assert.equal(network.followers.accounts[116].login, "follower-117");
  assert.ok(fetchImpl.calls.some((url) => url.includes("/followers?per_page=100&page=2")));
});

test("following pagination retrieves every page rather than only the first", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", 1)],
    followingPages: [
      accountPage("following", PER_PAGE),
      accountPage("following", PER_PAGE, PER_PAGE),
      accountPage("following", 4, PER_PAGE * 2),
    ],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(network.following.complete, true);
  assert.equal(network.following.accounts.length, 204);
  assert.equal(network.following.pagesLoaded, 3);
  assert.ok(fetchImpl.calls.some((url) => url.includes("/following?per_page=100&page=3")));
});

test("an exactly full final page still requests the following empty page", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", PER_PAGE)],
    followingPages: [[]],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(network.followers.complete, true);
  assert.equal(network.followers.accounts.length, PER_PAGE);
  assert.ok(fetchImpl.calls.some((url) => url.includes("/followers?per_page=100&page=2")));
});

test("zero followers and zero following are treated as known data", async () => {
  const fetchImpl = createNetworkFetch({ followerPages: [[]], followingPages: [[]] });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(network.complete, true);
  assert.equal(network.followers.accounts.length, 0);
  assert.equal(network.following.accounts.length, 0);
  assert.equal(describeIncompleteRetrieval(network), null);

  const markdown = buildMarkdown(network);
  assert.match(markdown, /\*\*Followers:\*\* 0/);
  assert.match(markdown, /## Followers\n\nNone\./);
  assert.match(markdown, /## Following\n\nNone\./);
});

test("a zero-follower account with following accounts produces a valid export", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [[]],
    followingPages: [accountPage("mentor", 2)],
  });
  const markdown = buildMarkdown(await fetchNetwork("example", { fetchImpl }));

  assert.match(markdown, /## Followers\n\nNone\.\n/);
  assert.match(markdown, /## Following\n\n1\. \[mentor-1\]\(https:\/\/github\.com\/mentor-1\)/);
});

test("a missing GitHub account is reported as not found", async () => {
  const fetchImpl = createFetch([]);
  await assert.rejects(
    () => fetchNetwork("ghost", { fetchImpl }),
    (error) => error.reason === "not-found" && /user not found/i.test(error.message)
  );
});

test("a rate-limited profile request is never reported as a missing user", async () => {
  const fetchImpl = createFetch([
    {
      match: () => true,
      respond: () =>
        jsonResponse(403, { message: "rate limited" }, { "X-RateLimit-Reset": "1800000000" }),
    },
  ]);

  await assert.rejects(
    () => fetchNetwork("example", { fetchImpl }),
    (error) => {
      assert.equal(error.reason, "rate-limit");
      assert.match(error.message, /rate limit was reached/i);
      assert.doesNotMatch(error.message, /not found/i);
      return true;
    }
  );
});

test("a rate-limited later page marks the list incomplete instead of truncating", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [
      accountPage("follower", PER_PAGE),
      { failWith: 403, headers: { "X-RateLimit-Reset": "1800000000" } },
    ],
    followingPages: [accountPage("following", 2)],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(network.complete, false);
  assert.equal(network.followers.complete, false);
  assert.equal(network.followers.accounts.length, PER_PAGE);
  assert.match(network.followers.error, /rate limit was reached/i);
  assert.equal(network.following.complete, true);

  const reason = describeIncompleteRetrieval(network);
  assert.match(reason, /Followers could not be fully retrieved/);
  assert.match(reason, /export is unavailable until the complete lists can be loaded/);
});

test("partial data cannot be built into a supposedly complete export", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", PER_PAGE), { failWith: 500 }],
    followingPages: [accountPage("following", 1)],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.throws(
    () => buildMarkdown(network),
    (error) => error.reason === "incomplete"
  );
});

test("a failed following page leaves the followers list complete and the export blocked", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", 5)],
    followingPages: [accountPage("following", PER_PAGE), { failWith: 502 }],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(network.followers.complete, true);
  assert.equal(network.following.complete, false);
  assert.equal(network.complete, false);
  assert.match(describeIncompleteRetrieval(network), /Following could not be fully retrieved/);
});

test("a network failure is reported as a retryable error", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    () => fetchNetwork("example", { fetchImpl }),
    (error) => error.reason === "network" && /Could not reach GitHub/.test(error.message)
  );
});

test("an account entry without a public login stops the list from claiming completeness", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [[{ login: "real" }, { id: 7 }]],
    followingPages: [[]],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(network.followers.complete, false);
  assert.match(network.followers.error, /without a public login/);
});

test("markdown reports the username, counts, and profile links", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", 2)],
    followingPages: [accountPage("following", 1)],
  });
  const markdown = buildMarkdown(await fetchNetwork("example", { fetchImpl }));

  assert.match(markdown, /^# GitHub Network$/m);
  assert.match(markdown, /^\*\*Username:\*\* \[example\]\(https:\/\/github\.com\/example\)$/m);
  assert.match(markdown, /^\*\*Followers:\*\* 2 {2}$/m);
  assert.match(markdown, /^\*\*Following:\*\* 1$/m);
  assert.match(markdown, /^1\. \[follower-1\]\(https:\/\/github\.com\/follower-1\)$/m);
  assert.match(markdown, /^2\. \[follower-2\]\(https:\/\/github\.com\/follower-2\)$/m);
  assert.match(markdown, /^1\. \[following-1\]\(https:\/\/github\.com\/following-1\)$/m);
});

test("markdown preserves the order GitHub returned across page boundaries", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [
      [{ login: "zeta" }, ...accountPage("mid", PER_PAGE - 1)],
      [{ login: "alpha" }],
    ],
    followingPages: [[]],
  });
  const markdown = buildMarkdown(await fetchNetwork("example", { fetchImpl }));

  assert.match(markdown, /^1\. \[zeta\]/m);
  assert.match(markdown, new RegExp(`^${PER_PAGE + 1}\\. \\[alpha\\]`, "m"));
  assert.ok(markdown.indexOf("[zeta]") < markdown.indexOf("[alpha]"));
});

test("markdown never invents usernames when the profile count is higher", async () => {
  const fetchImpl = createNetworkFetch({
    profile: { login: "example", name: null, followers: 101, following: 0 },
    followerPages: [accountPage("follower", PER_PAGE), []],
    followingPages: [[]],
  });
  const network = await fetchNetwork("example", { fetchImpl });
  const markdown = buildMarkdown(network);

  assert.equal(network.complete, true);
  assert.equal((markdown.match(/^\d+\. \[/gm) || []).length, PER_PAGE);
  assert.match(markdown, /^\*\*Followers:\*\* 100 {2}$/m);
  assert.doesNotMatch(markdown, /\*\*Followers:\*\* 101/);
  assert.match(markdown, /GitHub's profile reported 101 followers/);
  assert.match(markdown, /relationship data can change/i);
});

test("agreeing counts produce no change note", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", 3)],
    followingPages: [accountPage("following", 3)],
  });
  const network = await fetchNetwork("example", { fetchImpl });

  assert.equal(describeCountDifference(network), null);
  assert.doesNotMatch(buildMarkdown(network), /^>/m);
});

test("markdown escapes control characters found in account text", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [[{ login: "a_b*c" }]],
    followingPages: [[]],
  });
  const markdown = buildMarkdown(await fetchNetwork("example", { fetchImpl }));

  assert.match(markdown, /1\. \[a\\_b\\\*c\]\(https:\/\/github\.com\/a_b%2Ac\)/);
  assert.doesNotMatch(markdown, /\[a_b\*c\]/);
});

test("download filenames are sanitized and never escape the download name", () => {
  assert.equal(buildFilename("quangshuynh"), "quangshuynh-followers-following.md");
  assert.equal(buildFilename("../../etc/passwd"), "etcpasswd-followers-following.md");
  assert.equal(buildFilename('a"b<script>'), "abscript-followers-following.md");
  assert.equal(buildFilename("with space"), "withspace-followers-following.md");
  assert.equal(buildFilename(""), "github-user-followers-following.md");
  assert.equal(buildFilename("---"), "github-user-followers-following.md");
  assert.equal(buildFilename(null), "github-user-followers-following.md");
  assert.doesNotMatch(buildFilename("../../etc/passwd"), /[/\\]/);
});

test("the request order of relationship pages is deterministic and uses per_page=100", async () => {
  const fetchImpl = createNetworkFetch({
    followerPages: [accountPage("follower", 1)],
    followingPages: [accountPage("following", 1)],
  });
  await fetchNetwork("example", { fetchImpl });

  assert.equal(fetchImpl.calls[0], "https://api.github.com/users/example");
  assert.ok(fetchImpl.calls.every((url) => url.startsWith("https://api.github.com/")));
  assert.ok(
    fetchImpl.calls
      .filter((url) => url.includes("?"))
      .every((url) => url.includes("per_page=100"))
  );
});
