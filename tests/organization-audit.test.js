/**
 * Organization audit compatibility and score-completeness regressions.
 *
 * Every GitHub response is mocked. GitHub's GraphQL `user` field does not resolve
 * organizations, so metadata is read through `repositoryOwner` and its
 * `__typename` is checked rather than assumed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const GitHubAudit = require("../audit.js");
const { fetchGitHubMetadata, GitHubRequestError } = require("../api/github-metadata.js");
const reportHandler = require("../api/report.js");
const pinnedHandler = require("../api/pinned-repositories.js");
const { buildScoreCardData, buildShareText } = require("../share.js");

const NOW = new Date("2026-08-21T00:00:00Z");

function createRepository(owner, overrides = {}) {
  const name = overrides.name || "portfolio-lens";
  return {
    id: overrides.id ?? `${owner}/${name}`,
    name,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    description: "Public portfolio analyzer with actionable guidance",
    html_url: `https://github.com/${owner}/${name}`,
    homepage: null,
    language: "Python",
    topics: ["github"],
    license: { spdx_id: "MIT" },
    stargazers_count: 3,
    forks_count: 1,
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

function jsonResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function readmeNode(name) {
  return { name, readmeMarkdown: { byteSize: 900, text: "# Title\n## Overview\n## Setup\n## Usage" }, readmeUppercase: null, readmeLowercase: null };
}

function ownerPage(type, nodes, { pageInfo = { hasNextPage: false, endCursor: null }, pinned = [], extra = {}, errors } = {}) {
  const body = {
    data: {
      repositoryOwner: {
        __typename: type,
        pinnedItems: { nodes: pinned },
        repositories: { pageInfo, nodes },
        ...extra,
      },
    },
  };
  if (errors) body.errors = errors;
  return body;
}

function organizationExtra(overrides = {}) {
  return {
    name: "Example Labs",
    description: "Open tools for portfolio review.",
    profileReadmeRepository: { isPrivate: false, profileReadme: { byteSize: 1200 } },
    ...overrides,
  };
}

function graphqlFetch(pages, requests = []) {
  let index = 0;
  return async (url, options) => {
    requests.push(JSON.parse(options.body).variables);
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    return typeof page === "function" ? page() : jsonResponse(200, page);
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

async function withServerFetch(fetchImplementation, run) {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  const originalError = console.error;
  process.env.GITHUB_TOKEN = "server-secret-token";
  global.fetch = fetchImplementation;
  console.error = () => {};
  try {
    return await run();
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
}

async function runReport(login, fetchImplementation) {
  return withServerFetch(fetchImplementation, async () => {
    const { response, result } = createResponse();
    await reportHandler({ method: "GET", query: { user: login } }, response);
    return result;
  });
}

function reportFetch(login, { profile, pages = [[]], graphql, requests = [] }) {
  return async (url, options) => {
    requests.push(url);
    if (url === "https://api.github.com/graphql") {
      return typeof graphql === "function" ? graphql(options) : jsonResponse(200, graphql);
    }
    if (/\/search\/issues\?/.test(url)) return jsonResponse(200, { total_count: 0, items: [] });
    const page = url.match(new RegExp(`/users/${login}/repos\\?.*&page=(\\d+)$`));
    if (page) {
      const value = pages[Number(page[1]) - 1];
      return typeof value === "function" ? value() : jsonResponse(200, value ?? []);
    }
    if (url === `https://api.github.com/users/${login}`) return jsonResponse(200, profile);
    throw new Error(`Unexpected URL: ${url}`);
  };
}

/* --------------------------------------------------------------------------
 * GraphQL account types
 * ------------------------------------------------------------------------ */

test("metadata is requested through repositoryOwner, never the user-only field", async () => {
  let query = "";
  await fetchGitHubMetadata("example", "token", async (url, options) => {
    query = JSON.parse(options.body).query;
    return jsonResponse(200, ownerPage("User", []));
  });
  assert.match(query, /repositoryOwner\(login: \$username\)/);
  assert.match(query, /__typename/);
  assert.doesNotMatch(query, /\buser\(login:/);
});

test("a user account keeps its pins and README metadata, with no organization fields", async () => {
  const metadata = await fetchGitHubMetadata("example", "token", graphqlFetch([
    ownerPage("User", [readmeNode("portfolio-lens")], { pinned: [{ name: "portfolio-lens", isPrivate: false, owner: { login: "example" } }] }),
  ]));
  assert.deepEqual(metadata.account, { type: "User" });
  assert.deepEqual(metadata.pinnedRepositories, ["portfolio-lens"]);
  assert.equal(metadata.readmes["portfolio-lens"].present, true);
});

test("an organization resolves with its name, description, pins, and profile README", async () => {
  const metadata = await fetchGitHubMetadata("example-labs", "token", graphqlFetch([
    ownerPage("Organization", [readmeNode("toolkit"), readmeNode("docs")], {
      pinned: [
        { name: "toolkit", isPrivate: false, owner: { login: "Example-Labs" } },
        { name: "docs", isPrivate: false, owner: { login: "example-labs" } },
      ],
      extra: organizationExtra(),
    }),
  ]));
  assert.deepEqual(metadata.account, {
    type: "Organization",
    name: "Example Labs",
    description: "Open tools for portfolio review.",
    profileReadme: true,
  });
  assert.deepEqual(metadata.pinnedRepositories, ["toolkit", "docs"]);
  assert.deepEqual(Object.keys(metadata.readmes).sort(), ["docs", "toolkit"]);
});

test("organization pins owned by another account or private never reach public metadata", async () => {
  const metadata = await fetchGitHubMetadata("example-labs", "token", graphqlFetch([
    ownerPage("Organization", [readmeNode("toolkit")], {
      pinned: [
        { name: "toolkit", isPrivate: false, owner: { login: "someone-else" } },
        { name: "internal-roadmap", isPrivate: true, owner: { login: "example-labs" } },
        { name: "docs", isPrivate: false, owner: { login: "example-labs" } },
      ],
      extra: organizationExtra(),
    }),
  ]));
  assert.deepEqual(metadata.pinnedRepositories, ["docs"]);
  assert.doesNotMatch(JSON.stringify(metadata), /internal-roadmap/);
});

test("missing organization metadata is reported as unknown, not invented", async () => {
  const metadata = await fetchGitHubMetadata("example-labs", "token", graphqlFetch([
    ownerPage("Organization", [], { extra: { name: null, description: "   " } }),
  ]));
  assert.deepEqual(metadata.account, { type: "Organization", name: null, description: null, profileReadme: null });
});

test("a private .github repository is never counted as a public profile README", async () => {
  const metadata = await fetchGitHubMetadata("example-labs", "token", graphqlFetch([
    ownerPage("Organization", [], { extra: organizationExtra({ profileReadmeRepository: { isPrivate: true, profileReadme: { byteSize: 400 } } }) }),
  ]));
  assert.equal(metadata.account.profileReadme, false);
});

test("an organization without a .github repository has no profile README, and the audit continues", async () => {
  const metadata = await fetchGitHubMetadata("example-labs", "token", graphqlFetch([
    ownerPage("Organization", [readmeNode("toolkit")], {
      extra: organizationExtra({ profileReadmeRepository: null }),
      errors: [{ type: "NOT_FOUND", path: ["repositoryOwner", "profileReadmeRepository"], message: "Could not resolve to a Repository." }],
    }),
  ]));
  assert.equal(metadata.account.profileReadme, false);
  assert.deepEqual(Object.keys(metadata.readmes), ["toolkit"]);
});

test("restricted profile README access leaves only that fact unverified", async () => {
  const metadata = await fetchGitHubMetadata("example-labs", "token", graphqlFetch([
    ownerPage("Organization", [readmeNode("toolkit")], {
      extra: organizationExtra({ profileReadmeRepository: null }),
      errors: [{ type: "FORBIDDEN", path: ["repositoryOwner", "profileReadmeRepository"], message: "Resource protected by organization SAML enforcement." }],
    }),
  ]));
  assert.equal(metadata.account.profileReadme, null);
  assert.deepEqual(Object.keys(metadata.readmes), ["toolkit"]);
});

test("restricted repository metadata still fails the request instead of reading as empty", async () => {
  await assert.rejects(
    fetchGitHubMetadata("example-labs", "token", graphqlFetch([
      ownerPage("Organization", [], {
        extra: organizationExtra(),
        errors: [{ type: "FORBIDDEN", path: ["repositoryOwner", "repositories"], message: "Resource protected by organization SAML enforcement." }],
      }),
    ])),
    (error) => error instanceof GitHubRequestError && error.status === 502
  );
});

test("malformed or unsupported GraphQL account types are rejected rather than treated as users", async () => {
  for (const type of [undefined, null, "Bot", "Enterprise", 42]) {
    const page = ownerPage("User", []);
    page.data.repositoryOwner.__typename = type;
    await assert.rejects(
      fetchGitHubMetadata("example", "token", graphqlFetch([page])),
      (error) => error instanceof GitHubRequestError && error.status === 502,
      `type ${String(type)} must be rejected`
    );
  }
});

test("an account type that changes between pages is rejected", async () => {
  await assert.rejects(
    fetchGitHubMetadata("example", "token", graphqlFetch([
      ownerPage("User", [readmeNode("one")], { pageInfo: { hasNextPage: true, endCursor: "c1" } }),
      ownerPage("Organization", [readmeNode("two")], { extra: organizationExtra() }),
    ])),
    (error) => error instanceof GitHubRequestError && error.status === 502
  );
});

test("an unknown login is not found, not empty", async () => {
  await assert.rejects(
    fetchGitHubMetadata("ghost-org", "token", graphqlFetch([{ data: { repositoryOwner: null } }])),
    (error) => error instanceof GitHubRequestError && error.status === 404
  );
});

test("large organizations paginate, request profile fields once, and stop on a repeated cursor", async () => {
  const requests = [];
  const pages = Array.from({ length: 5 }, (_, index) => ownerPage(
    "Organization",
    Array.from({ length: 100 }, (__, item) => readmeNode(`repo-${index * 100 + item}`)),
    {
      pageInfo: index < 4 ? { hasNextPage: true, endCursor: `c${index + 1}` } : { hasNextPage: false, endCursor: null },
      extra: index === 0 ? organizationExtra() : {},
    }
  ));
  const metadata = await fetchGitHubMetadata("example-labs", "token", graphqlFetch(pages, requests));
  assert.equal(Object.keys(metadata.readmes).length, 500);
  assert.deepEqual(requests.map((variables) => variables.includeProfile), [true, false, false, false, false]);
  assert.deepEqual(requests.map((variables) => variables.cursor), [null, "c1", "c2", "c3", "c4"]);

  const repeating = ownerPage("Organization", [readmeNode("a")], { pageInfo: { hasNextPage: true, endCursor: "same" }, extra: organizationExtra() });
  await assert.rejects(
    fetchGitHubMetadata("example-labs", "token", graphqlFetch([repeating])),
    (error) => error instanceof GitHubRequestError
  );
});

test("an organization GraphQL rate limit is a rate limit, not an empty organization", async () => {
  await assert.rejects(
    fetchGitHubMetadata("example-labs", "token", graphqlFetch([{ data: { repositoryOwner: null }, errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }])),
    (error) => error instanceof GitHubRequestError && error.status === 429
  );
});

test("the public metadata endpoint returns organization account facts", async () => {
  const result = await withServerFetch(graphqlFetch([
    ownerPage("Organization", [readmeNode("toolkit")], { pinned: [{ name: "toolkit", isPrivate: false, owner: { login: "example-labs" } }], extra: organizationExtra() }),
  ]), async () => {
    const { response, result: handlerResult } = createResponse();
    await pinnedHandler({ method: "GET", query: { username: "example-labs" } }, response);
    return handlerResult;
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.repositories, ["toolkit"]);
  assert.equal(result.body.account.type, "Organization");
  assert.equal(result.body.account.name, "Example Labs");
});

/* --------------------------------------------------------------------------
 * Public JSON report for organizations
 * ------------------------------------------------------------------------ */

test("report audits an organization without searching for its pull requests", async () => {
  const requests = [];
  const result = await runReport("example-labs", reportFetch("example-labs", {
    profile: { login: "example-labs", type: "Organization", name: "Example Labs", public_repos: 2 },
    pages: [[
      createRepository("example-labs", { id: 1, name: "toolkit" }),
      createRepository("example-labs", { id: 2, name: "docs" }),
    ]],
    graphql: ownerPage("Organization", [readmeNode("toolkit"), readmeNode("docs")], {
      pinned: [{ name: "docs", isPrivate: false, owner: { login: "example-labs" } }],
      extra: organizationExtra(),
    }),
    requests,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 2);
  assert.deepEqual(result.body.pinned_repositories, ["docs"]);
  assert.equal(result.body.coverage.state, "complete");
  assert.deepEqual(result.body.account, {
    type: "Organization",
    name: "Example Labs",
    description: "Open tools for portfolio review.",
    profile_readme: true,
  });
  assert.equal(result.body.contributed_repositories_applicable, false);
  assert.deepEqual(result.body.contributed_repositories, []);
  assert.equal(requests.some((url) => /\/search\/issues/.test(url)), false);
});

test("report keeps user audits unchanged apart from the account type", async () => {
  const requests = [];
  const result = await runReport("example", reportFetch("example", {
    profile: { login: "example", type: "User", name: "Example Person", bio: "Builds things", public_repos: 1 },
    pages: [[createRepository("example", { id: 1 })]],
    graphql: ownerPage("User", [readmeNode("portfolio-lens")]),
    requests,
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.account, { type: "User" });
  assert.equal(result.body.contributed_repositories_applicable, true);
  assert.equal(result.body.contributed_repositories_available, true);
  assert.equal(requests.some((url) => /\/search\/issues/.test(url)), true);
});

test("report describes an empty organization as empty", async () => {
  const result = await runReport("example-labs", reportFetch("example-labs", {
    profile: { login: "example-labs", type: "Organization", public_repos: 0 },
    graphql: ownerPage("Organization", [], { extra: organizationExtra({ profileReadmeRepository: null }) }),
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.coverage.state, "empty");
  assert.equal(result.body.account.type, "Organization");
});

test("report never lists an organization's private repositories", async () => {
  const result = await runReport("example-labs", reportFetch("example-labs", {
    profile: { login: "example-labs", type: "Organization", public_repos: 1 },
    pages: [[
      createRepository("example-labs", { id: 1, name: "toolkit" }),
      createRepository("example-labs", { id: 2, name: "secret-roadmap", private: true, visibility: "private" }),
    ]],
    graphql: ownerPage("Organization", [readmeNode("toolkit")], {
      pinned: [{ name: "secret-roadmap", isPrivate: true, owner: { login: "example-labs" } }],
      extra: organizationExtra(),
    }),
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /secret-roadmap/);
});

test("report rejects an account GitHub describes inconsistently", async () => {
  const result = await runReport("example-labs", reportFetch("example-labs", {
    profile: { login: "example-labs", type: "Organization", public_repos: 0 },
    graphql: ownerPage("User", []),
  }));
  assert.equal(result.status, 502);
  assert.equal(result.body.coverage, undefined);
});

test("report rejects a malformed profile response", async () => {
  const result = await runReport("example-labs", reportFetch("example-labs", {
    profile: null,
    graphql: ownerPage("Organization", [], { extra: organizationExtra() }),
  }));
  assert.equal(result.status, 502);
});

test("report reports a forbidden organization repository listing as forbidden, not empty", async () => {
  const result = await runReport("example-labs", reportFetch("example-labs", {
    profile: { login: "example-labs", type: "Organization", public_repos: 3 },
    pages: [() => jsonResponse(403, { message: "Resource not accessible" }, { "X-RateLimit-Remaining": "4999" })],
    graphql: ownerPage("Organization", [], { extra: organizationExtra() }),
  }));
  assert.equal(result.status, 403);
  assert.equal(result.body.coverage, undefined);
});

test("report deduplicates organization repositories across large paginated listings", async () => {
  const pageOne = Array.from({ length: 100 }, (_, index) => createRepository("example-labs", { id: index + 1, name: `repo-${index + 1}` }));
  const pageTwo = [createRepository("example-labs", { id: 100, name: "repo-100" }), createRepository("example-labs", { id: 101, name: "repo-101" })];
  const result = await runReport("example-labs", reportFetch("example-labs", {
    profile: { login: "example-labs", type: "Organization", public_repos: 101 },
    pages: [pageOne, pageTwo],
    graphql: ownerPage("Organization", [], { extra: organizationExtra() }),
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 101);
  assert.equal(result.body.coverage.state, "complete");
});

/* --------------------------------------------------------------------------
 * Scoring compatibility and completeness
 * ------------------------------------------------------------------------ */

function auditAll(repositories, supplemental) {
  return repositories.map((repository) => GitHubAudit.scoreRepository(
    GitHubAudit.transformRepository(repository, supplemental),
    NOW
  ));
}

test("organization repositories score exactly like the same repositories owned by a user", () => {
  const names = ["toolkit", "docs", "cli"];
  const supplemental = { pinnedRepositories: ["docs"], readmes: Object.fromEntries(names.map((name) => [name, { present: true, size: 900 }])) };
  const userAudits = auditAll(names.map((name) => createRepository("example", { name })), supplemental);
  const organizationAudits = auditAll(names.map((name) => createRepository("example-labs", { name })), supplemental);
  assert.deepEqual(
    GitHubAudit.scoreProfile(organizationAudits),
    GitHubAudit.scoreProfile(userAudits)
  );
  assert.deepEqual(
    GitHubAudit.generateRecommendations(organizationAudits),
    GitHubAudit.generateRecommendations(userAudits)
  );
});

test("organization recommendations are chosen and ranked independently of response order", () => {
  // Repository names inside a recommendation keep GitHub's most-recently-updated
  // order by design; which recommendations appear, and their rank, must not move.
  const repositories = ["zeta", "alpha", "mid"].map((name) => createRepository("example-labs", { name, description: null, topics: [] }));
  const summarize = (recommendations) => recommendations.map((recommendation) => ({
    ...recommendation,
    repositories: [...recommendation.repositories].sort(),
  }));
  const forward = summarize(GitHubAudit.generateRecommendations(auditAll(repositories, null)));
  const reversed = summarize(GitHubAudit.generateRecommendations(auditAll([...repositories].reverse(), null)));
  assert.deepEqual(forward, reversed);
});

test("audit completeness separates complete, empty, partial, and unavailable audits", () => {
  const coverage = (state, reported = null, retrieved = 0) => ({ state, reported, retrieved });
  assert.deepEqual(GitHubAudit.assessAuditCompleteness({ coverage: coverage("complete"), metadataVerified: true }), { state: "complete", gaps: [] });
  assert.deepEqual(GitHubAudit.assessAuditCompleteness({ coverage: coverage("empty"), metadataVerified: true }), { state: "empty", gaps: [] });
  assert.deepEqual(GitHubAudit.assessAuditCompleteness({ coverage: coverage("empty"), metadataVerified: false }), { state: "empty", gaps: [] });
  assert.deepEqual(GitHubAudit.assessAuditCompleteness({ coverage: coverage("unavailable", 4) }), { state: "unavailable", gaps: [] });
  assert.deepEqual(GitHubAudit.assessAuditCompleteness({ coverage: coverage("incomplete", 300, 100), metadataVerified: true }), { state: "partial", gaps: ["repositories"] });
  assert.deepEqual(GitHubAudit.assessAuditCompleteness({ coverage: coverage("complete"), metadataVerified: false }), { state: "partial", gaps: ["metadata"] });
  assert.deepEqual(GitHubAudit.assessAuditCompleteness({ coverage: coverage("incomplete", 300, 100), metadataVerified: false }), { state: "partial", gaps: ["repositories", "metadata"] });
  assert.deepEqual(GitHubAudit.assessAuditCompleteness({ coverage: coverage("complete"), metadataVerified: true, unverifiedReadmes: 2 }), { state: "partial", gaps: ["readmes"] });
});

test("a partial score is shared and carded as partial, never as a comparison", () => {
  const partial = buildShareText("example-labs", 72, undefined, { partial: true });
  assert.match(partial, /72\/100 on a partial GitProfileLens audit/);
  assert.doesNotMatch(partial, /What's your score/);
  assert.match(partial, /user=example-labs/);
  assert.match(buildShareText("example-labs", 72), /What's your score/);

  const profileScore = { overall: 72, categories: { presentation: 90, descriptions: 80, readme: 55, discoverability: 72, maintenance: 88, focus: 65 } };
  assert.equal(buildScoreCardData("example-labs", profileScore, { partial: true }).partial, true);
  assert.equal("partial" in buildScoreCardData("example-labs", profileScore), false);
});
