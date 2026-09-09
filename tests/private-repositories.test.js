const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/private-repositories.js");
const { seal } = require("../api/auth/session-crypto.js");
const GitHubAudit = require("../audit.js");

const SESSION_SECRET = "a-test-session-secret-that-is-longer-than-32-characters";

function createResponse() {
  const result = { status: null, body: null, headers: {} };
  const response = {
    setHeader(name, value) { result.headers[name] = value; },
    status(statusCode) { result.status = statusCode; return response; },
    json(body) { result.body = body; },
  };
  return { response, result };
}

function createRepository(id, overrides = {}) {
  return {
    id,
    name: `project-${id}`,
    full_name: `example/project-${id}`,
    owner: { login: "example" },
    description: `Private portfolio project ${id}`,
    html_url: `https://github.com/example/project-${id}`,
    homepage: null,
    language: "JavaScript",
    topics: ["portfolio"],
    license: { spdx_id: "MIT", name: "must-not-be-returned" },
    stargazers_count: 1,
    forks_count: 0,
    open_issues_count: 0,
    archived: false,
    fork: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    pushed_at: "2026-08-01T00:00:00Z",
    private: true,
    visibility: "private",
    clone_url: "private-field-must-not-be-returned",
    ...overrides,
  };
}

function createSessionCookie(overrides = {}) {
  const session = seal({
    accessToken: "authorized-user-token",
    accessTokenExpiresAt: Date.now() + 120_000,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    expiresAt: Date.now() + 120_000,
    user: { login: "example", avatar_url: "https://avatars.example/example.png" },
    ...overrides,
  });
  return `gpl_session=${session}`;
}

async function withPrivateEnvironment(fetchImplementation, callback) {
  const originalFetch = global.fetch;
  const originalSecret = process.env.SESSION_SECRET;
  const originalInstallUrl = process.env.GITHUB_APP_INSTALL_URL;
  global.fetch = fetchImplementation;
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.GITHUB_APP_INSTALL_URL = "https://github.com/apps/gitprofilelens/installations/new";
  try {
    return await callback();
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    if (originalInstallUrl === undefined) delete process.env.GITHUB_APP_INSTALL_URL;
    else process.env.GITHUB_APP_INSTALL_URL = originalInstallUrl;
  }
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
}

test("private repository endpoint requires an authenticated session", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SESSION_SECRET;
  const { response, result } = createResponse();
  try {
    await handler({ method: "GET", headers: {} }, response);
    assert.equal(result.status, 401);
    assert.match(result.body.error, /sign in/i);
    assert.equal(result.headers["Cache-Control"], "private, no-store, max-age=0");
  } finally {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});

test("private repository endpoint paginates, filters to the owner, and analyzes READMEs", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => createRepository(index + 1));
  const secondPage = [
    createRepository(101, { name: "final-project", full_name: "example/final-project" }),
    createRepository(102, {
      name: "collaborator-project",
      full_name: "another-user/collaborator-project",
      owner: { login: "another-user" },
    }),
  ];
  const requestedUrls = [];
  const fetchImplementation = async (url) => {
    requestedUrls.push(url);
    if (/\/user\/installations\?/.test(url)) {
      return jsonResponse(200, { installations: [{ id: 42 }] });
    }
    if (/\/user\/installations\/42\/repositories\?per_page=100&page=1$/.test(url)) {
      return jsonResponse(200, { repositories: firstPage });
    }
    if (/\/user\/installations\/42\/repositories\?per_page=100&page=2$/.test(url)) {
      return jsonResponse(200, { repositories: secondPage });
    }
    if (/\/users\/example\/repos\?type=owner&sort=updated&direction=desc&per_page=100&page=1$/.test(url)) {
      return jsonResponse(200, [createRepository(201, { private: false, visibility: "public" })]);
    }
    if (/\/repos\/example\/project-2\/readme$/.test(url)) return jsonResponse(404, { message: "Not Found" });
    if (/\/repos\/example\/.+\/readme$/.test(url)) {
      const markdown = "# Project\n## Overview\n## Installation\n```sh\nnpm install\n```\n## Usage\nRun it.\n## Demo\n![Demo](demo.png)";
      return jsonResponse(200, { size: Buffer.byteLength(markdown), content: Buffer.from(markdown).toString("base64") });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  await withPrivateEnvironment(fetchImplementation, async () => {
    const { response, result } = createResponse();
    await handler({ method: "GET", headers: { cookie: createSessionCookie() } }, response);
    assert.equal(result.status, 200);
    assert.equal(result.body.installation, true);
    assert.equal(result.body.repositories.length, 101);
    assert.equal(result.body.public_repositories.length, 1);
    assert.equal(result.body.repositories.at(-1).name, "final-project");
    assert.equal(result.body.repositories[0].private, true);
    assert.equal(result.body.repositories[0].visibility, "private");
    assert.equal(result.body.repositories.some((repository) => repository.name === "collaborator-project"), false);
    assert.equal(result.body.readmes["project-1"].sections.installation, true);
    assert.equal(result.body.readmes["project-1"].hasCodeBlock, true);
    assert.deepEqual(result.body.readmes["project-2"], { present: false, size: null });
    assert.equal(result.body.configure_url, "https://github.com/apps/gitprofilelens/installations/new");
    assert.equal(result.headers["Cache-Control"], "private, no-store, max-age=0");
    assert.doesNotMatch(JSON.stringify(result.body), /authorized-user-token|clone_url|must-not-be-returned/);
    assert.equal(requestedUrls.some((url) => /page=2$/.test(url)), true);
  });
});

test("authenticated users without an installation receive an explicit empty state", async () => {
  await withPrivateEnvironment(
    async (url) => {
      if (/\/user\/installations\?/.test(url)) return jsonResponse(200, { installations: [] });
      if (/\/users\/example\/repos\?/.test(url)) return jsonResponse(200, []);
      throw new Error(`Unexpected URL: ${url}`);
    },
    async () => {
      const { response, result } = createResponse();
      await handler({ method: "GET", headers: { cookie: createSessionCookie() } }, response);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.repositories, []);
      assert.equal(result.body.installation, false);
      assert.match(result.body.configure_url, /github\.com\/apps/);
    }
  );
});

test("one README failure returns neutral unknown metadata and retries transient 5xx only within the bound", async () => {
  let readmeAttempts = 0;
  await withPrivateEnvironment(async (url) => {
    if (/\/user\/installations\?/.test(url)) return jsonResponse(200, { installations: [{ id: 42 }] });
    if (/\/user\/installations\/42\/repositories\?/.test(url)) return jsonResponse(200, { repositories: [createRepository(1)] });
    if (/\/users\/example\/repos\?/.test(url)) return jsonResponse(200, []);
    if (/\/repos\/example\/project-1\/readme$/.test(url)) {
      readmeAttempts += 1;
      return jsonResponse(503, { message: "temporary" });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }, async () => {
    const { response, result } = createResponse();
    await handler({ method: "GET", headers: { cookie: createSessionCookie() } }, response);
    assert.equal(result.status, 200);
    assert.equal(readmeAttempts, 3);
    assert.deepEqual(result.body.readmes["project-1"], {
      present: null,
      size: null,
      unavailable_reason: "github_5xx",
    });
    assert.deepEqual(result.body.metadata, {
      complete: false,
      unavailable_readmes: 1,
      issues: { github_5xx: 1 },
    });
    const transformed = GitHubAudit.transformRepository(
      result.body.repositories[0],
      { pinnedRepositories: [], readmes: result.body.readmes }
    );
    const audit = GitHubAudit.scoreRepository(transformed);
    assert.equal(transformed.readme.present, null);
    assert.equal(audit.categoryScores.readme, 60);
    assert.match(audit.findings.find((finding) => finding.category === "README quality").reason, /could not be verified/i);
  });
});

test("permanent README failures are not retried and do not fail the repository list", async () => {
  let readmeAttempts = 0;
  await withPrivateEnvironment(async (url) => {
    if (/\/user\/installations\?/.test(url)) return jsonResponse(200, { installations: [{ id: 42 }] });
    if (/\/user\/installations\/42\/repositories\?/.test(url)) return jsonResponse(200, { repositories: [createRepository(1)] });
    if (/\/users\/example\/repos\?/.test(url)) return jsonResponse(200, []);
    if (/\/readme$/.test(url)) { readmeAttempts += 1; return jsonResponse(422, { message: "invalid" }); }
    throw new Error(`Unexpected URL: ${url}`);
  }, async () => {
    const { response, result } = createResponse();
    await handler({ method: "GET", headers: { cookie: createSessionCookie() } }, response);
    assert.equal(result.status, 200);
    assert.equal(result.body.repositories.length, 1);
    assert.equal(result.body.readmes["project-1"].present, null);
    assert.equal(readmeAttempts, 1);
  });
});

test("GitHub authorization failures become safe errors and clear the session", async () => {
  await withPrivateEnvironment(
    async () => jsonResponse(401, { message: "Bad credentials", token: "must-not-leak" }),
    async () => {
      const { response, result } = createResponse();
      await handler({ method: "GET", headers: { cookie: createSessionCookie() } }, response);
      assert.equal(result.status, 401);
      assert.match(result.body.error, /no longer valid/i);
      assert.match(result.headers["Set-Cookie"], /^gpl_session=;/);
      assert.doesNotMatch(JSON.stringify(result.body), /must-not-leak|authorized-user-token/);
    }
  );
});

test("a README authorization failure remains fatal and clears the session", async () => {
  await withPrivateEnvironment(async (url) => {
    if (/\/user\/installations\?/.test(url)) return jsonResponse(200, { installations: [{ id: 42 }] });
    if (/\/user\/installations\/42\/repositories\?/.test(url)) return jsonResponse(200, { repositories: [createRepository(1)] });
    if (/\/users\/example\/repos\?/.test(url)) return jsonResponse(200, []);
    if (/\/readme$/.test(url)) return jsonResponse(401, { message: "Bad credentials" });
    throw new Error(`Unexpected URL: ${url}`);
  }, async () => {
    const { response, result } = createResponse();
    await handler({ method: "GET", headers: { cookie: createSessionCookie() } }, response);
    assert.equal(result.status, 401);
    assert.match(result.body.error, /no longer valid/i);
    assert.match(result.headers["Set-Cookie"], /^gpl_session=;/);
  });
});

test("rate limits are not retried and retain reset guidance", async () => {
  let attempts = 0;
  const reset = Math.floor(Date.now() / 1000) + 600;
  await withPrivateEnvironment(async () => {
    attempts += 1;
    return {
      ...jsonResponse(403, { message: "rate limited" }),
      headers: { get: (name) => name.toLowerCase() === "x-ratelimit-remaining" ? "0" : name.toLowerCase() === "x-ratelimit-reset" ? `${reset}` : null },
    };
  }, async () => {
    const { response, result } = createResponse();
    await handler({ method: "GET", headers: { cookie: createSessionCookie() } }, response);
    assert.equal(result.status, 429);
    assert.equal(attempts, 1);
    assert.match(result.body.error, /rate limit reached/i);
    assert.match(result.body.error, /try again after/i);
  });
});
