const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const pinnedRepositoriesHandler = require("../api/pinned-repositories.js");

// These tests guard the architectural assumption that broke local development:
// the browser asks its own origin for enrichment, so the origin has to execute
// api/*.js. A static file server does not, which is why README and pinned data
// silently fall back to unverified there. Nothing here tests Vercel itself.

const projectRoot = path.resolve(__dirname, "..");
const clientSource = fs.readFileSync(path.join(projectRoot, "script.js"), "utf8");
const graphqlResponse = {
  data: {
    user: {
      pinnedItems: { nodes: [{ name: "portfolio" }] },
      repositories: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            name: "portfolio",
            readmeMarkdown: {
              byteSize: 1800,
              text: "# Portfolio\n## Installation\n```sh\nnpm install\n```\n## Usage\nRun it.\n",
            },
            readmeUppercase: null,
            readmeLowercase: null,
          },
        ],
      },
    },
  },
};

/**
 * collects every same-origin api path the browser client requests
 * @returns {Array<string>} api pathnames without query strings
 */
function getClientApiPaths() {
  const matches = clientSource.matchAll(/fetch\(\s*[`"'](\/api\/[^`"'?]+)/g);
  return [...new Set([...matches].map((match) => match[1]))];
}

/**
 * adapts a node request and response to the vercel serverless function shape
 * @param {Function} handler serverless function under test
 * @returns {http.Server} node http server running the handler
 */
function createFunctionServer(handler) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    request.query = Object.fromEntries(url.searchParams);
    response.status = (statusCode) => {
      response.statusCode = statusCode;
      return response;
    };
    response.json = (body) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(body));
    };
    await handler(request, response);
  });
}

/**
 * serves the project directory the way a plain static file server does
 * @param {http.IncomingMessage} request incoming request
 * @param {http.ServerResponse} response outgoing response
 * @returns {void} no return value
 */
function serveStaticFile(request, response) {
  const requestedPath = new URL(request.url, "http://127.0.0.1").pathname;
  const filePath = path.join(projectRoot, requestedPath === "/" ? "index.html" : requestedPath);

  if (!filePath.startsWith(projectRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/html");
    response.end("<h1>Error response</h1><p>Error code: 404</p>");
    return;
  }

  response.statusCode = 200;
  response.end(fs.readFileSync(filePath));
}

/**
 * starts a server on an ephemeral port and returns its base url
 * @param {http.Server} server server to listen with
 * @returns {Promise<string>} base url of the listening server
 */
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("enrichment requests stay same-origin instead of targeting production", () => {
  assert.match(clientSource, /fetch\(\s*`\/api\/pinned-repositories\?username=/);
  assert.doesNotMatch(clientSource, /https?:\/\/[^"'`\s]*\/api\//);
});

test("every api path the client calls has a serverless function file", () => {
  const apiPaths = getClientApiPaths();
  assert.ok(apiPaths.includes("/api/pinned-repositories"));

  for (const apiPath of apiPaths) {
    const functionFile = path.join(projectRoot, `${apiPath.replace(/^\//, "")}.js`);
    assert.equal(fs.existsSync(functionFile), true, `${apiPath} has no handler at ${functionFile}`);
  }
});

test("the enrichment handler serves README and pin metadata in the Node runtime", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  global.fetch = async () => ({ ok: true, status: 200, json: async () => graphqlResponse });

  const server = createFunctionServer(pinnedRepositoriesHandler);
  const baseUrl = await listen(server);

  try {
    const response = await originalFetch(`${baseUrl}/api/pinned-repositories?username=example`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.repositories, ["portfolio"]);
    assert.equal(body.readmes.portfolio.present, true);
    assert.equal(body.readmes.portfolio.sections.installation, true);
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a static file server cannot execute the enrichment route", async () => {
  const server = http.createServer(serveStaticFile);
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/pinned-repositories?username=example`);
    assert.equal(response.status, 404);

    // The route must not be served as readable handler source either.
    const body = await response.text();
    assert.doesNotMatch(body, /process\.env\.GITHUB_TOKEN/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an unconfigured runtime reports enrichment as unavailable rather than partial", async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;

  const server = createFunctionServer(pinnedRepositoriesHandler);
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/pinned-repositories?username=example`);
    assert.equal(response.status, 503);

    const body = await response.json();
    assert.equal(body.repositories, undefined);
    assert.equal(body.readmes, undefined);
  } finally {
    if (originalToken !== undefined) process.env.GITHUB_TOKEN = originalToken;
    await new Promise((resolve) => server.close(resolve));
  }
});
