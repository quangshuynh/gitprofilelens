const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/report.js");

function createResponse() {
  const result = { status: null, body: null, headers: {} };
  const response = {
    setHeader(name, value) { result.headers[name] = value; },
    status(statusCode) { result.status = statusCode; return response; },
    json(body) { result.body = body; },
  };
  return { response, result };
}

function createRepository(overrides = {}) {
  return {
    name: "portfolio-lens",
    full_name: "example/portfolio-lens",
    description: "Public portfolio analyzer",
    html_url: "https://github.com/example/portfolio-lens",
    homepage: null,
    language: "JavaScript",
    topics: ["github", "developer-tools"],
    license: { spdx_id: "MIT" },
    stargazers_count: 4,
    forks_count: 2,
    open_issues_count: 1,
    archived: false,
    fork: false,
    private: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    pushed_at: "2026-08-01T00:00:00Z",
    token: "must-not-leak",
    ...overrides,
  };
}

function createMetadata(repositoryNames = ["portfolio-lens", "minimal-project"]) {
  return {
    data: {
      user: {
        pinnedItems: { nodes: [{ name: "minimal-project" }, { name: "portfolio-lens" }] },
        repositories: {
          nodes: repositoryNames.map((name) => ({
            name,
            readmeMarkdown: name === "portfolio-lens" ? { byteSize: 1600, text: "# App\n## Overview\n## Setup\n## Usage\n## Demo\n```js\nrun()\n```" } : null,
            readmeUppercase: null,
            readmeLowercase: null,
          })),
        },
      },
    },
  };
}

async function runHandler(query, fetchImplementation, requestOverrides = {}) {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "server-secret-token";
  global.fetch = fetchImplementation;
  const { response, result } = createResponse();
  try {
    await handler({ method: "GET", query, ...requestOverrides }, response);
    return result;
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
}

function successfulFetch(repositories) {
  return async (url) => {
    if (url === "https://api.github.com/graphql") return jsonResponse(200, createMetadata());
    if (/\/users\/example\/repos/.test(url)) return jsonResponse(200, repositories);
    if (url === "https://api.github.com/users/example") return jsonResponse(200, { login: "example" });
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("report endpoint requires a username", async () => {
  const { response, result } = createResponse();
  await handler({ method: "GET", query: {} }, response);
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "GitHub username is required" });
});

test("report endpoint rejects an invalid username", async () => {
  const { response, result } = createResponse();
  await handler({ method: "GET", query: { user: "bad username" } }, response);
  assert.equal(result.status, 400);
});

test("report endpoint reports missing server credentials without exposing configuration", async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  const { response, result } = createResponse();
  try {
    await handler({ method: "GET", query: { user: "example" } }, response);
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: "GitHub API access is not configured" });
    assert.doesNotMatch(JSON.stringify(result.body), /process\.env|authorization|bearer/i);
  } finally {
    if (originalToken !== undefined) process.env.GITHUB_TOKEN = originalToken;
  }
});

test("report serializes public metadata, pins, topics, and nullable fields", async () => {
  const repositories = [
    createRepository(),
    createRepository({
      name: "minimal-project",
      full_name: "example/minimal-project",
      html_url: "https://github.com/example/minimal-project",
      description: null,
      language: null,
      license: null,
      topics: [],
      archived: true,
      fork: true,
    }),
    createRepository({ name: "private-project", private: true }),
  ];
  const result = await runHandler({ user: "example" }, successfulFetch(repositories));

  assert.equal(result.status, 200);
  assert.equal(result.body.username, "example");
  assert.equal(result.body.public_repositories, 2);
  assert.deepEqual(result.body.pinned_repositories, ["minimal-project", "portfolio-lens"]);
  assert.deepEqual(result.body.repositories[0].topics, ["github", "developer-tools"]);
  assert.equal(result.body.repositories[0].pinned, true);
  assert.equal(result.body.repositories[0].readme_status, "comprehensive");
  assert.equal(result.body.repositories[1].description, null);
  assert.equal(result.body.repositories[1].primary_language, null);
  assert.equal(result.body.repositories[1].license, null);
  assert.equal(result.body.repositories[1].archived, true);
  assert.equal(result.body.repositories[1].forked, true);
  assert.doesNotMatch(JSON.stringify(result.body), /server-secret-token|must-not-leak|authorization|GITHUB_TOKEN/i);
});

test("report remains public-only when the request includes an authenticated session cookie", async () => {
  const repositories = [
    createRepository(),
    createRepository({
      name: "secret-project",
      full_name: "example/secret-project",
      html_url: "https://github.com/example/secret-project",
      private: true,
      description: "Private repository metadata",
    }),
  ];
  const result = await runHandler(
    { user: "example" },
    successfulFetch(repositories),
    { headers: { cookie: "gpl_session=encrypted-session-placeholder" } }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.public_repositories, 1);
  assert.equal(result.body.repositories.length, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /secret-project|Private repository metadata/);
});

test("report returns 404 for a nonexistent GitHub user", async () => {
  const result = await runHandler({ user: "example" }, async () => jsonResponse(404, { message: "Not Found" }));
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: "GitHub user not found." });
});

test("report translates GitHub rate limiting", async () => {
  const result = await runHandler({ user: "example" }, async () => jsonResponse(403, { message: "rate limit" }));
  assert.equal(result.status, 429);
  assert.deepEqual(result.body, { error: "GitHub API rate limit reached." });
});

test("report handles upstream GitHub failures without exposing internals", async () => {
  const result = await runHandler({ user: "example" }, async () => jsonResponse(500, { token: "upstream-secret" }));
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, { error: "GitHub API request failed." });
  assert.doesNotMatch(JSON.stringify(result.body), /upstream-secret|stack/i);
});
