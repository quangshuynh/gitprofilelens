const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/pinned-repositories.js");

/**
 * creates a mock vercel response and observable result
 * @returns {{response: Object, result: Object}} response mock and captured result
 */
function createResponse() {
  const result = { status: null, body: null, headers: {} };
  const response = {
    setHeader(name, value) { result.headers[name] = value; },
    status(statusCode) { result.status = statusCode; return response; },
    json(body) { result.body = body; },
  };
  return { response, result };
}

test("serverless metadata endpoint validates usernames", async () => {
  const { response, result } = createResponse();
  await handler({ method: "GET", query: { username: "bad username" } }, response);
  assert.equal(result.status, 400);
});

test("serverless metadata endpoint requires its GitHub token", async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  const { response, result } = createResponse();
  try {
    await handler({ method: "GET", query: { username: "example" } }, response);
    assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(result.body), /github_pat|authorization|bearer/i);
  } finally {
    if (originalToken !== undefined) process.env.GITHUB_TOKEN = originalToken;
  }
});

test("serverless metadata endpoint translates GraphQL rate limits", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ message: "rate limit" }) });
  const { response, result } = createResponse();
  try {
    await handler({ method: "GET", query: { username: "example" } }, response);
    assert.equal(result.status, 429);
    assert.deepEqual(result.body, { error: "GitHub API rate limit reached." });
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
});

test("serverless metadata endpoint transforms pins and README blobs", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        user: {
          pinnedItems: { nodes: [{ name: "portfolio" }] },
          repositories: {
            nodes: [
              { name: "portfolio", readmeMarkdown: { byteSize: 1800, text: "# Portfolio\n## Installation\n```sh\nnpm install\n```\n## Usage\nRun it.\n## Demo\n![Screenshot](demo.png)\n## Contributing\nPRs welcome." }, readmeUppercase: null, readmeLowercase: null },
              { name: "empty", readmeMarkdown: null, readmeUppercase: null, readmeLowercase: null },
              { name: "alternate", readmeMarkdown: null, readmeUppercase: null, readmeLowercase: { byteSize: 900, text: "# Alternate\n## Getting Started\n## Quickstart\n## Screenshots\n<img src=\"demo.png\">" } },
              { name: "blank", readmeMarkdown: { byteSize: 0, text: "" }, readmeUppercase: null, readmeLowercase: null },
            ],
          },
        },
      },
    }),
  });
  const { response, result } = createResponse();

  try {
    await handler({ method: "GET", query: { username: "example" } }, response);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.repositories, ["portfolio"]);
    assert.deepEqual(result.body.readmes.portfolio, {
      present: true,
      size: 1800,
      sections: { overview: false, installation: true, usage: true, examples: true, contributing: true },
      hasCodeBlock: true,
      hasImage: true,
      headingCount: 5,
    });
    assert.deepEqual(result.body.readmes.empty, { present: false, size: null });
    assert.deepEqual(result.body.readmes.alternate.sections, {
      overview: false, installation: true, usage: true, examples: true, contributing: false,
    });
    assert.equal(result.body.readmes.alternate.hasImage, true);
    assert.deepEqual(result.body.readmes.blank, {
      present: true,
      size: 0,
      sections: { overview: false, installation: false, usage: false, examples: false, contributing: false },
      hasCodeBlock: false,
      hasImage: false,
      headingCount: 0,
    });
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
});

test("serverless metadata endpoint paginates README repositories", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  const requests = [];
  global.fetch = async (_url, options) => {
    const variables = JSON.parse(options.body).variables;
    requests.push(variables.cursor);
    const laterPage = variables.cursor === "cursor-1";
    return {
      ok: true,
      json: async () => ({ data: { user: {
        pinnedItems: { nodes: [{ name: "first" }] },
        repositories: {
          pageInfo: laterPage ? { hasNextPage: false, endCursor: null } : { hasNextPage: true, endCursor: "cursor-1" },
          nodes: [{ name: laterPage ? "second" : "first", readmeMarkdown: { byteSize: 20, text: "# README" }, readmeUppercase: null, readmeLowercase: null }],
        },
      } } }),
    };
  };
  const { response, result } = createResponse();
  try {
    await handler({ method: "GET", query: { username: "example" } }, response);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.repositories, ["first"]);
    assert.deepEqual(Object.keys(result.body.readmes).sort(), ["first", "second"]);
    assert.deepEqual(requests, [null, "cursor-1"]);
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
});

test("serverless metadata endpoint preserves errors from later pages", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    if (requestCount === 2) return { ok: false, status: 403, json: async () => ({ message: "rate limit" }) };
    return {
      ok: true,
      json: async () => ({ data: { user: {
        pinnedItems: { nodes: [] },
        repositories: { pageInfo: { hasNextPage: true, endCursor: "cursor-1" }, nodes: [] },
      } } }),
    };
  };
  const { response, result } = createResponse();
  try {
    await handler({ method: "GET", query: { username: "example" } }, response);
    assert.equal(result.status, 429);
    assert.deepEqual(result.body, { error: "GitHub API rate limit reached." });
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
});
