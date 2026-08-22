const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/private-repositories.js");
const { seal } = require("../api/auth/session-crypto.js");

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
  return { ok: status >= 200 && status < 300, status, json: async () => body };
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
