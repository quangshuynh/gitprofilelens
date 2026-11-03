/**
 * Audit reliability and edge-case regressions.
 *
 * Every GitHub response here is mocked. The cases cover accounts with nothing to
 * audit, datasets GitHub returned only part of, pagination that repeats or never
 * ends, failures that must not read as "nothing found", and the ordering rules
 * that keep identical evidence producing identical advice.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const GitHubAudit = require("../audit.js");
const { fetchGitHubMetadata, GitHubRequestError } = require("../api/github-metadata.js");
const reportHandler = require("../api/report.js");
const privateRepositoriesHandler = require("../api/private-repositories.js");
const { seal } = require("../api/auth/session-crypto.js");

const NOW = new Date("2026-08-21T00:00:00Z");
const SESSION_SECRET = "a-test-session-secret-that-is-longer-than-32-characters";

function createRepository(overrides = {}) {
  const name = overrides.name || "portfolio-lens";
  return {
    id: overrides.id ?? name,
    name,
    full_name: `example/${name}`,
    owner: { login: "example" },
    description: "Public portfolio analyzer with actionable guidance",
    html_url: `https://github.com/example/${name}`,
    homepage: null,
    language: "Python",
    topics: ["github"],
    license: { spdx_id: "MIT" },
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    archived: false,
    fork: false,
    private: false,
    visibility: "public",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    pushed_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function createResponse() {
  const result = { status: null, body: null, headers: {} };
  const response = {
    setHeader(name, value) { result.headers[name] = value; },
    status(statusCode) { result.status = statusCode; return response; },
    json(body) { result.body = body; },
  };
  return { response, result };
}

function jsonResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function graphqlPage(nodes, pageInfo = { hasNextPage: false, endCursor: null }, pinned = []) {
  return {
    data: {
      repositoryOwner: { __typename: "User",
        pinnedItems: { nodes: pinned },
        repositories: { pageInfo, nodes },
      },
    },
  };
}

function readmeNode(name) {
  return { name, readmeMarkdown: { byteSize: 900, text: "# Title\n## Overview\n## Setup\n## Usage" }, readmeUppercase: null, readmeLowercase: null };
}

async function runReport(fetchImplementation) {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "server-secret-token";
  global.fetch = fetchImplementation;
  const { response, result } = createResponse();
  try {
    await reportHandler({ method: "GET", query: { user: "example" } }, response);
    return result;
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
}

function reportFetch({ profile = { login: "example", public_repos: 0 }, pages = [[]], graphql = graphqlPage([]), search = { total_count: 0, items: [] }, requests = [] } = {}) {
  return async (url) => {
    requests.push(url);
    if (url === "https://api.github.com/graphql") {
      return typeof graphql === "function" ? graphql() : jsonResponse(200, graphql);
    }
    if (/\/search\/issues\?/.test(url)) {
      return typeof search === "function" ? search() : jsonResponse(200, search);
    }
    const page = url.match(/\/users\/example\/repos\?.*&page=(\d+)$/);
    if (page) {
      const value = pages[Number(page[1]) - 1];
      if (typeof value === "function") return value();
      return jsonResponse(200, value ?? []);
    }
    if (url === "https://api.github.com/users/example") return jsonResponse(200, profile);
    throw new Error(`Unexpected URL: ${url}`);
  };
}

/* --------------------------------------------------------------------------
 * Scoring with nothing to score
 * ------------------------------------------------------------------------ */

test("a profile with no repositories is marked as not evaluated rather than scored", () => {
  const empty = GitHubAudit.scoreProfile([]);
  assert.equal(empty.evaluated, false);
  // The numeric shape stays stable for existing consumers.
  assert.equal(empty.overall, 0);

  const audit = GitHubAudit.scoreRepository(GitHubAudit.transformRepository(createRepository(), null), NOW);
  assert.equal(GitHubAudit.scoreProfile([audit]).evaluated, true);
});

test("an empty profile receives no recommendations, pins, or candidates", () => {
  assert.deepEqual(GitHubAudit.generateRecommendations([]), []);
});

/* --------------------------------------------------------------------------
 * Coverage: empty is not the same as unavailable or incomplete
 * ------------------------------------------------------------------------ */

test("repository coverage distinguishes empty, unavailable, incomplete, and complete data", () => {
  const assess = GitHubAudit.assessRepositoryCoverage;
  assert.equal(assess({ reported: 0, retrieved: 0 }).state, "empty");
  // A profile that does not report a count is empty only by what GitHub returned.
  assert.equal(assess({ reported: null, retrieved: 0 }).state, "empty");
  assert.equal(assess({ reported: undefined, retrieved: 0 }).state, "empty");
  // GitHub says repositories exist but returned none: unavailable, never "empty".
  assert.equal(assess({ reported: 3, retrieved: 0 }).state, "unavailable");
  assert.equal(assess({ reported: 0, retrieved: 0, truncated: true }).state, "unavailable");
  assert.equal(assess({ reported: 5, retrieved: 3 }).state, "incomplete");
  assert.equal(assess({ reported: 2, retrieved: 2, truncated: true }).state, "incomplete");
  assert.equal(assess({ reported: 2, retrieved: 2 }).state, "complete");
  // A lagging profile count is not evidence that anything is missing.
  assert.equal(assess({ reported: 1, retrieved: 2 }).state, "complete");
  assert.deepEqual(assess({ reported: "7", retrieved: 1 }), { state: "complete", reported: null, retrieved: 1 });
});

test("repository pages are merged without duplicates", () => {
  const collected = [];
  const seen = new Set();
  assert.equal(GitHubAudit.appendUniqueRepositories(collected, seen, [createRepository({ id: 1, name: "a" }), createRepository({ id: 2, name: "b" })]), 2);
  // A repository updated mid-pagination moves pages and is returned twice.
  assert.equal(GitHubAudit.appendUniqueRepositories(collected, seen, [createRepository({ id: 2, name: "b" }), createRepository({ id: 3, name: "c" })]), 1);
  assert.deepEqual(collected.map((repository) => repository.name), ["a", "b", "c"]);
  // Without an id the full name identifies the repository, case-insensitively.
  assert.equal(GitHubAudit.appendUniqueRepositories(collected, seen, [{ name: "d", full_name: "Example/D" }, { name: "d", full_name: "example/d" }]), 1);
});

/* --------------------------------------------------------------------------
 * Deterministic ordering
 * ------------------------------------------------------------------------ */

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest])
  );
}

test("recommendations do not depend on the order GitHub returned repositories", () => {
  // Six distinct medium findings with one repository each tie on impact, so the
  // top-five cut must be decided by the evidence rather than by response order.
  const audits = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map((name, index) => ({
    repository: { name, pinned: null, archived: false, private: false, fork: false },
    score: 70,
    categoryScores: {},
    findings: [{ category: `Category ${index}`, severity: "medium", reason: "Reason.", action: `Action ${name}.`, factual: true }],
  }));
  const expected = JSON.stringify(GitHubAudit.generateRecommendations(audits));
  for (const order of permutations(audits.slice(0, 6)).slice(0, 120)) {
    assert.equal(JSON.stringify(GitHubAudit.generateRecommendations(order)), expected);
  }
});

test("strong unpinned suggestions break score ties by name, not response order", () => {
  const audits = ["delta", "alpha", "charlie", "bravo"].map((name) =>
    GitHubAudit.scoreRepository(
      GitHubAudit.transformRepository(
        createRepository({ name, homepage: "https://example.com" }),
        { pinnedRepositories: [], readmes: { [name]: { present: true, size: 2000, sections: { overview: true, installation: true, usage: true, examples: true, contributing: true }, hasCodeBlock: true, hasImage: true, headingCount: 6 } } }
      ),
      NOW
    )
  );
  const pinAdvice = (list) => GitHubAudit.generateRecommendations(list).find((item) => /not currently pinned/.test(item.reason));
  assert.deepEqual(pinAdvice(audits).repositories, ["alpha", "bravo", "charlie"]);
  assert.deepEqual(pinAdvice([...audits].reverse()).repositories, ["alpha", "bravo", "charlie"]);
});

test("identical input produces byte-identical audits and profile scores", () => {
  const build = () => [createRepository({ name: "one" }), createRepository({ name: "two", description: null, topics: [] })]
    .map((repository) => GitHubAudit.scoreRepository(GitHubAudit.transformRepository(repository, null), NOW));
  const first = build();
  const second = build();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(GitHubAudit.scoreProfile(first), GitHubAudit.scoreProfile(second));
  assert.deepEqual(GitHubAudit.generateRecommendations(first), GitHubAudit.generateRecommendations(second));
});

/* --------------------------------------------------------------------------
 * GraphQL metadata: pagination, partial failures, privacy
 * ------------------------------------------------------------------------ */

test("GraphQL pagination stops when GitHub repeats a cursor", async () => {
  let requests = 0;
  const fetchImplementation = async () => {
    requests += 1;
    return jsonResponse(200, graphqlPage([readmeNode(`repo-${requests}`)], { hasNextPage: true, endCursor: "same-cursor" }));
  };
  await assert.rejects(
    fetchGitHubMetadata("example", "token", fetchImplementation),
    (error) => error instanceof GitHubRequestError && /pagination/i.test(error.message)
  );
  assert.ok(requests <= 2, `expected the repeated cursor to stop pagination, made ${requests} requests`);
});

test("GraphQL pagination is bounded even when every cursor is new", async () => {
  let requests = 0;
  const fetchImplementation = async () => {
    requests += 1;
    return jsonResponse(200, graphqlPage([readmeNode(`repo-${requests}`)], { hasNextPage: true, endCursor: `cursor-${requests}` }));
  };
  await assert.rejects(fetchGitHubMetadata("example", "token", fetchImplementation), GitHubRequestError);
  assert.ok(requests <= 100, `pagination made ${requests} requests`);
});

test("a GraphQL rate limit reported with HTTP 200 is still a rate limit", async () => {
  const fetchImplementation = async () => jsonResponse(200, {
    data: null,
    errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded for user ID 1." }],
  });
  await assert.rejects(
    fetchGitHubMetadata("example", "token", fetchImplementation),
    (error) => error instanceof GitHubRequestError && error.status === 429
  );
});

test("a malformed GraphQL connection is a safe upstream error, not a crash", async () => {
  for (const body of [
    { data: { repositoryOwner: { __typename: "User", pinnedItems: { nodes: [] }, repositories: null } } },
    { data: { repositoryOwner: { __typename: "User", pinnedItems: { nodes: [] }, repositories: { pageInfo: { hasNextPage: false }, nodes: "nope" } } } },
    { data: { repositoryOwner: { __typename: "User", pinnedItems: null, repositories: { pageInfo: { hasNextPage: false }, nodes: [] } } } },
  ]) {
    await assert.rejects(
      fetchGitHubMetadata("example", "token", async () => jsonResponse(200, body)),
      (error) => error instanceof GitHubRequestError && error.status === 502
    );
  }
});

test("null GraphQL nodes are skipped instead of failing the whole metadata response", async () => {
  const metadata = await fetchGitHubMetadata("example", "token", async () => jsonResponse(200, graphqlPage(
    [null, readmeNode("kept")],
    { hasNextPage: false, endCursor: null },
    [null, { name: "kept" }]
  )));
  assert.deepEqual(metadata.pinnedRepositories, ["kept"]);
  assert.deepEqual(Object.keys(metadata.readmes), ["kept"]);
});

test("pins GitHub reports as private or owned by another account never reach public metadata", async () => {
  const metadata = await fetchGitHubMetadata("example", "token", async () => jsonResponse(200, graphqlPage(
    [readmeNode("utils")],
    { hasNextPage: false, endCursor: null },
    [
      { name: "secret-roadmap", isPrivate: true, owner: { login: "example" } },
      { name: "utils", isPrivate: false, owner: { login: "someone-else" } },
      { name: "portfolio", isPrivate: false, owner: { login: "Example" } },
    ]
  )));
  assert.deepEqual(metadata.pinnedRepositories, ["portfolio"]);
  assert.doesNotMatch(JSON.stringify(metadata), /secret-roadmap/);
});

/* --------------------------------------------------------------------------
 * Public JSON report
 * ------------------------------------------------------------------------ */

test("report audits a zero-repository account and reports it as empty", async () => {
  const result = await runReport(reportFetch());
  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 0);
  assert.deepEqual(result.body.repositories, []);
  assert.deepEqual(result.body.pinned_repositories, []);
  assert.deepEqual(result.body.coverage, { state: "empty", reported_repositories: 0, retrieved_repositories: 0 });
});

test("an account GraphQL cannot resolve fails safely instead of reporting an empty account", async () => {
  // A failed account lookup must not turn into a successful response claiming
  // the account is empty. Organization support is covered in organization-audit.
  const result = await runReport(reportFetch({
    profile: { login: "example", type: "Organization", public_repos: 0 },
    graphql: { data: { repositoryOwner: null }, errors: [{ type: "NOT_FOUND", path: ["repositoryOwner"], message: "Could not resolve to a RepositoryOwner with the login of 'example'." }] },
  }));
  assert.equal(result.status, 502);
  assert.equal(result.body.repositories, undefined);
  assert.equal(result.body.coverage, undefined);
});

test("report never presents a profile GitHub could not list as empty", async () => {
  const result = await runReport(reportFetch({ profile: { login: "example", public_repos: 4 } }));
  assert.equal(result.status, 200);
  assert.equal(result.body.coverage.state, "unavailable");
});

test("report keeps private-only accounts at zero public repositories", async () => {
  const result = await runReport(reportFetch({
    profile: { login: "example", public_repos: 0 },
    pages: [[createRepository({ name: "secret-work", private: true, visibility: "private" })]],
    graphql: graphqlPage([], { hasNextPage: false, endCursor: null }, [{ name: "secret-work", isPrivate: true, owner: { login: "example" } }]),
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 0);
  assert.equal(result.body.coverage.state, "empty");
  assert.doesNotMatch(JSON.stringify(result.body), /secret-work/);
});

test("report deduplicates repositories that moved between pages", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => createRepository({ id: index + 1, name: `repo-${index + 1}` }));
  // Repository 100 was updated mid-retrieval and shifted onto page two.
  const secondPage = [createRepository({ id: 100, name: "repo-100" }), createRepository({ id: 101, name: "repo-101" })];
  const result = await runReport(reportFetch({ profile: { login: "example", public_repos: 101 }, pages: [firstPage, secondPage] }));
  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 101);
  assert.equal(new Set(result.body.repositories.map((repository) => repository.name)).size, 101);
  assert.equal(result.body.coverage.state, "complete");
});

test("report stops when GitHub keeps returning the same full page", async () => {
  const page = Array.from({ length: 100 }, (_, index) => createRepository({ id: index + 1, name: `repo-${index + 1}` }));
  const requests = [];
  const result = await runReport(reportFetch({ profile: { login: "example", public_repos: 300 }, pages: [page, page, page, page, page], requests }));
  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 100);
  assert.equal(result.body.coverage.state, "incomplete");
  assert.ok(requests.filter((url) => /\/repos\?/.test(url)).length <= 2);
});

test("report follows the Link header and skips the empty trailing page", async () => {
  const pageOne = Array.from({ length: 100 }, (_, index) => createRepository({ id: index + 1, name: `repo-${index + 1}` }));
  const pageTwo = Array.from({ length: 100 }, (_, index) => createRepository({ id: index + 101, name: `repo-${index + 101}` }));
  const requests = [];
  const result = await runReport(reportFetch({
    profile: { login: "example", public_repos: 200 },
    pages: [
      () => jsonResponse(200, pageOne, { Link: '<https://api.github.com/user/1/repos?page=2>; rel="next", <https://api.github.com/user/1/repos?page=2>; rel="last"' }),
      () => jsonResponse(200, pageTwo, { Link: '<https://api.github.com/user/1/repos?page=1>; rel="prev", <https://api.github.com/user/1/repos?page=1>; rel="first"' }),
    ],
    requests,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 200);
  assert.equal(requests.filter((url) => /\/repos\?/.test(url)).length, 2);
});

test("report fails safely when a later repository page fails", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => createRepository({ id: index + 1, name: `repo-${index + 1}` }));
  const result = await runReport(reportFetch({
    profile: { login: "example", public_repos: 150 },
    pages: [firstPage, () => jsonResponse(502, { message: "Server Error" })],
  }));
  assert.equal(result.status, 502);
  assert.equal(result.body.repositories, undefined);
});

test("report separates a forbidden resource from a rate limit", async () => {
  const forbidden = await runReport(reportFetch({
    profile: { login: "example" },
    pages: [() => jsonResponse(403, { message: "Repository access blocked" }, { "X-RateLimit-Remaining": "4999" })],
  }));
  assert.equal(forbidden.status, 403);
  assert.doesNotMatch(forbidden.body.error, /rate limit/i);

  const limited = await runReport(reportFetch({
    pages: [() => jsonResponse(403, { message: "API rate limit exceeded" }, { "X-RateLimit-Remaining": "0" })],
  }));
  assert.equal(limited.status, 429);

  const secondary = await runReport(reportFetch({
    pages: [() => jsonResponse(403, { message: "You have exceeded a secondary rate limit." }, { "X-RateLimit-Remaining": "4000" })],
  }));
  assert.equal(secondary.status, 429);
});

test("report says when contribution discovery was unavailable instead of implying none exist", async () => {
  const failed = await runReport(reportFetch({ search: () => jsonResponse(500, { message: "boom" }) }));
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.body.contributed_repositories, []);
  assert.equal(failed.body.contributed_repositories_available, false);

  const succeeded = await runReport(reportFetch());
  assert.equal(succeeded.body.contributed_repositories_available, true);
});

/* --------------------------------------------------------------------------
 * Authenticated private audit
 * ------------------------------------------------------------------------ */

function createSessionCookie() {
  return `gpl_session=${seal({
    accessToken: "authorized-user-token",
    accessTokenExpiresAt: Date.now() + 120_000,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    expiresAt: Date.now() + 120_000,
    user: { login: "example", avatar_url: "https://avatars.example/example.png" },
  })}`;
}

async function runPrivate(fetchImplementation) {
  const originalFetch = global.fetch;
  const originalSecret = process.env.SESSION_SECRET;
  const originalLog = console.info;
  const logs = [];
  global.fetch = fetchImplementation;
  process.env.SESSION_SECRET = SESSION_SECRET;
  console.info = (line) => logs.push(String(line));
  const { response, result } = createResponse();
  try {
    await privateRepositoriesHandler({ method: "GET", headers: { cookie: createSessionCookie() } }, response);
    return { result, logs };
  } finally {
    global.fetch = originalFetch;
    console.info = originalLog;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
}

test("private-only accounts keep private repositories out of the public scope", async () => {
  const privateRepository = createRepository({ id: 7, name: "secret-work", private: true, visibility: "private" });
  const { result, logs } = await runPrivate(async (url) => {
    if (/\/user\/installations\?/.test(url)) return jsonResponse(200, { total_count: 1, installations: [{ id: 1 }] });
    if (/\/user\/installations\/1\/repositories\?/.test(url)) return jsonResponse(200, { total_count: 1, repositories: [privateRepository] });
    if (/\/users\/example\/repos\?/.test(url)) return jsonResponse(200, []);
    if (/\/readme$/.test(url)) return jsonResponse(404, { message: "Not Found" });
    throw new Error(`Unexpected URL: ${url}`);
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.repositories.length, 1);
  assert.deepEqual(result.body.public_repositories, []);
  assert.equal(result.body.metadata.repositories_complete, true);
  // Diagnostics identify repositories by id only.
  assert.doesNotMatch(logs.join("\n"), /secret-work/);
});

test("private pagination uses total_count to avoid an empty trailing request", async () => {
  const repositories = Array.from({ length: 100 }, (_, index) => createRepository({ id: index + 1, name: `project-${index + 1}`, private: true }));
  const requests = [];
  const { result } = await runPrivate(async (url) => {
    requests.push(url);
    if (/\/user\/installations\?/.test(url)) return jsonResponse(200, { total_count: 1, installations: [{ id: 1 }] });
    if (/\/user\/installations\/1\/repositories\?/.test(url)) return jsonResponse(200, { total_count: 100, repositories });
    if (/\/users\/example\/repos\?/.test(url)) return jsonResponse(200, []);
    if (/\/readme$/.test(url)) return jsonResponse(404, { message: "Not Found" });
    throw new Error(`Unexpected URL: ${url}`);
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.repositories.length, 100);
  assert.equal(requests.filter((url) => /installations\/1\/repositories/.test(url)).length, 1);
});

test("private pagination stops and reports incompleteness when GitHub repeats a page", async () => {
  const repositories = Array.from({ length: 100 }, (_, index) => createRepository({ id: index + 1, name: `project-${index + 1}`, private: true }));
  const requests = [];
  const { result } = await runPrivate(async (url) => {
    requests.push(url);
    if (/\/user\/installations\?/.test(url)) return jsonResponse(200, { installations: [{ id: 1 }] });
    if (/\/user\/installations\/1\/repositories\?/.test(url)) return jsonResponse(200, { repositories });
    if (/\/users\/example\/repos\?/.test(url)) return jsonResponse(200, []);
    if (/\/readme$/.test(url)) return jsonResponse(404, { message: "Not Found" });
    throw new Error(`Unexpected URL: ${url}`);
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.repositories.length, 100);
  assert.equal(result.body.metadata.repositories_complete, false);
  assert.ok(requests.filter((url) => /installations\/1\/repositories/.test(url)).length <= 2);
});
