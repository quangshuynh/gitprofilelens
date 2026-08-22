const { analyzeReadme } = require("./github-metadata.js");
const { getAuthenticatedSession } = require("./auth/authenticated-session.js");
const {
  SESSION_COOKIE,
  clearCookie,
  setPrivateResponseHeaders,
} = require("./auth/session-crypto.js");

const GITHUB_API_URL = "https://api.github.com";

class PrivateRepositoryError extends Error {
  constructor(message, status = 502, clearSession = false) {
    super(message);
    this.name = "PrivateRepositoryError";
    this.status = status;
    this.clearSession = clearSession;
  }
}

async function privateRepositoriesHandler(request, response) {
  setPrivateResponseHeaders(response);
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  let session;
  try {
    session = await getAuthenticatedSession(request, response);
  } catch {
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    response.status(401).json({ error: "Your GitHub session expired. Please sign in again." });
    return;
  }
  if (!session) {
    response.status(401).json({ error: "Sign in with GitHub to audit authorized repositories." });
    return;
  }

  try {
    const installations = await fetchAllPages("/user/installations", "installations", session.accessToken);
    const repositoriesById = new Map();
    for (const installation of installations) {
      const repositories = await fetchAllPages(
        `/user/installations/${encodeURIComponent(installation.id)}/repositories`,
        "repositories",
        session.accessToken
      );
      for (const repository of repositories) {
        if (repository.owner?.login?.toLowerCase() === session.user.login.toLowerCase()) {
          repositoriesById.set(repository.id, repository);
        }
      }
    }

    const repositories = [...repositoriesById.values()];
    const readmes = await mapWithConcurrency(repositories, 5, async (repository) => [
      repository.name,
      await fetchReadme(repository.full_name, session.accessToken),
    ]);

    response.status(200).json({
      installation: installations.length > 0,
      configure_url: process.env.GITHUB_APP_INSTALL_URL || null,
      repositories: repositories.map(sanitizeRepository),
      readmes: Object.fromEntries(readmes),
    });
  } catch (error) {
    const known = error instanceof PrivateRepositoryError;
    if (known && error.clearSession) {
      response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    }
    response.status(known ? error.status : 502).json({
      error: known ? error.message : "GitHub could not return authorized repositories.",
    });
  }
}

async function fetchAllPages(path, collectionName, token, fetchImplementation = fetch) {
  const values = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const data = await fetchGitHubJson(
      `${path}${separator}per_page=100&page=${page}`,
      token,
      fetchImplementation
    );
    const pageValues = data?.[collectionName];
    if (!Array.isArray(pageValues)) {
      throw new PrivateRepositoryError("GitHub returned an invalid repository response.");
    }
    values.push(...pageValues);
    if (pageValues.length < 100) return values;
  }
}

async function fetchReadme(fullName, token, fetchImplementation = fetch) {
  try {
    const data = await fetchGitHubJson(
      `/repos/${fullName.split("/").map(encodeURIComponent).join("/")}/readme`,
      token,
      fetchImplementation
    );
    if (typeof data.content !== "string") {
      throw new PrivateRepositoryError("GitHub returned an invalid README response.");
    }
    const markdown = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
    return { present: true, size: data.size ?? Buffer.byteLength(markdown), ...analyzeReadme(markdown) };
  } catch (error) {
    if (error instanceof PrivateRepositoryError && error.status === 404) {
      return { present: false, size: null };
    }
    throw error;
  }
}

async function fetchGitHubJson(path, token, fetchImplementation = fetch) {
  let response;
  try {
    response = await fetchImplementation(`${GITHUB_API_URL}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "gitprofilelens",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    throw new PrivateRepositoryError("GitHub could not return authorized repositories.");
  }
  if (response.status === 401) {
    throw new PrivateRepositoryError("Your GitHub authorization is no longer valid. Please sign in again.", 401, true);
  }
  if (response.status === 403 || response.status === 429) {
    throw new PrivateRepositoryError("GitHub API rate limit reached. Please try again later.", 429);
  }
  if (response.status === 404) throw new PrivateRepositoryError("GitHub resource not found.", 404);
  if (!response.ok) throw new PrivateRepositoryError("GitHub could not return authorized repositories.");
  try {
    return await response.json();
  } catch {
    throw new PrivateRepositoryError("GitHub returned an invalid repository response.");
  }
}

function sanitizeRepository(repository) {
  return {
    id: repository.id,
    name: repository.name,
    full_name: repository.full_name,
    description: repository.description,
    html_url: repository.html_url,
    homepage: repository.homepage,
    language: repository.language,
    topics: Array.isArray(repository.topics) ? repository.topics : [],
    license: repository.license ? { spdx_id: repository.license.spdx_id } : null,
    stargazers_count: repository.stargazers_count || 0,
    forks_count: repository.forks_count || 0,
    open_issues_count: repository.open_issues_count || 0,
    archived: Boolean(repository.archived),
    fork: Boolean(repository.fork),
    created_at: repository.created_at,
    updated_at: repository.updated_at,
    pushed_at: repository.pushed_at,
    private: Boolean(repository.private),
    visibility: repository.visibility || (repository.private ? "private" : "public"),
  };
}

async function mapWithConcurrency(values, concurrency, transform) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await transform(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

module.exports = privateRepositoriesHandler;
