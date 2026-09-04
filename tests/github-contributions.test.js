const test = require("node:test");
const assert = require("node:assert/strict");
const {
  fetchGitHubContributions,
  groupPullRequests,
  parseRepositoryIdentity,
} = require("../api/github-contributions.js");

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function pullRequest(id, fullName, merged = true) {
  return {
    id,
    repository_url: `https://api.github.com/repos/${fullName}`,
    html_url: `https://github.com/${fullName}/pull/${id}`,
    pull_request: { merged_at: merged ? "2026-01-01T00:00:00Z" : null },
    private: true,
    token: "must-not-leak",
  };
}

function repository(fullName, overrides = {}) {
  const [owner, name] = fullName.split("/");
  return {
    owner: { login: owner },
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: "Useful forms library",
    language: "Python",
    stargazers_count: 3,
    forks_count: 2,
    private: false,
    visibility: "public",
    permissions: { admin: true },
    token: "upstream-secret",
    ...overrides,
  };
}

function contributionFetch(items, repositories = {}) {
  return async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer server-secret-token");
    if (url.includes("/search/issues?")) return response(200, { total_count: items.length, items });
    const match = url.match(/\/repos\/([^/]+\/[^/?]+)/);
    if (match && repositories[match[1]]) return response(200, repositories[match[1]]);
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test("includes one external repository with merged authored contribution", async () => {
  const result = await fetchGitHubContributions(
    "example",
    "server-secret-token",
    contributionFetch([pullRequest(1, "hymical/forms")], { "hymical/forms": repository("hymical/forms") })
  );
  assert.deepEqual(result, [{
    owner: "hymical",
    name: "forms",
    full_name: "hymical/forms",
    url: "https://github.com/hymical/forms",
    description: "Useful forms library",
    primary_language: "Python",
    stars: 3,
    forks: 2,
    contribution: { pull_requests: 1, merged_pull_requests: 1 },
  }]);
  assert.doesNotMatch(JSON.stringify(result), /private|permissions|secret|token|authorization/i);
});

test("deduplicates repositories and duplicate PR results while counting merged and total PRs", async () => {
  const items = [
    pullRequest(1, "hymical/forms"),
    pullRequest(1, "hymical/forms"),
    pullRequest(2, "hymical/forms"),
    pullRequest(3, "hymical/forms", false),
  ];
  const result = await fetchGitHubContributions(
    "example",
    "server-secret-token",
    contributionFetch(items, { "hymical/forms": repository("hymical/forms") })
  );
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].contribution, { pull_requests: 3, merged_pull_requests: 2 });
});

test("excludes owned repositories case-insensitively and repositories with only unmerged PRs", async () => {
  const fetchImplementation = contributionFetch([
    pullRequest(1, "Example/owned"),
    pullRequest(2, "third-party/unmerged", false),
  ]);
  assert.deepEqual(await fetchGitHubContributions("example", "server-secret-token", fetchImplementation), []);
});

test("returns an empty array when no external contributions exist", async () => {
  assert.deepEqual(
    await fetchGitHubContributions("example", "server-secret-token", contributionFetch([])),
    []
  );
});

test("does not serialize repositories GitHub identifies as private", async () => {
  const result = await fetchGitHubContributions(
    "example",
    "server-secret-token",
    contributionFetch([pullRequest(1, "hidden/project")], {
      "hidden/project": repository("hidden/project", { private: true, visibility: "private" }),
    })
  );
  assert.deepEqual(result, []);
});

test("paginates search results and deduplicates overlap between pages", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => pullRequest(index + 1, "hymical/forms"));
  const urls = [];
  const fetchImplementation = async (url) => {
    urls.push(url);
    if (url.includes("/search/issues?")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return response(200, page === 1
        ? { total_count: 101, items: firstPage }
        : { total_count: 101, items: [pullRequest(100, "hymical/forms"), pullRequest(101, "hymical/forms")] });
    }
    return response(200, repository("hymical/forms"));
  };
  const result = await fetchGitHubContributions("example", "server-secret-token", fetchImplementation);
  assert.equal(urls.filter((url) => url.includes("/search/issues?")).length, 2);
  assert.deepEqual(result[0].contribution, { pull_requests: 101, merged_pull_requests: 101 });
});

test("parses only canonical public GitHub repository API identities", () => {
  assert.deepEqual(parseRepositoryIdentity("https://api.github.com/repos/hymical/forms"), {
    owner: "hymical", name: "forms", fullName: "hymical/forms",
  });
  assert.equal(parseRepositoryIdentity("https://example.com/repos/hymical/forms"), null);
  assert.equal(groupPullRequests([{ id: 1, repository_url: "invalid" }]).size, 0);
});

test("translates contribution rate limits without exposing upstream response data", async () => {
  await assert.rejects(
    fetchGitHubContributions("example", "server-secret-token", async () => response(403, { token: "secret" })),
    (error) => error.status === 429
      && error.message === "GitHub API rate limit reached."
      && !JSON.stringify(error).includes("secret")
  );
});
