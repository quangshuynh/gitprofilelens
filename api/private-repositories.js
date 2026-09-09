const { analyzeReadme } = require("./github-metadata.js");
const { randomUUID } = require("node:crypto");
const { getAuthenticatedSession } = require("./auth/authenticated-session.js");
const {
  SESSION_COOKIE,
  clearCookie,
  setPrivateResponseHeaders,
} = require("./auth/session-crypto.js");

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_REQUEST_TIMEOUT_MS = 5_000;
const GITHUB_MAX_ATTEMPTS = 3;
const README_CONCURRENCY = 5;
const README_BUDGET_MS = 40_000;

class PrivateRepositoryError extends Error {
  constructor(message, status = 502, clearSession = false) {
    super(message);
    this.name = "PrivateRepositoryError";
    this.status = status;
    this.clearSession = clearSession;
  }
}

async function privateRepositoriesHandler(request, response) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  setPrivateResponseHeaders(response);
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  let session;
  try {
    session = await getAuthenticatedSession(request, response);
  } catch (error) {
    logDiagnostic("session_error", { requestId, elapsed_ms: Date.now() - startedAt, error: error?.name || "Error" });
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    response.status(401).json({ error: "Your GitHub session expired. Please sign in again." });
    return;
  }
  if (!session) {
    logDiagnostic("session_invalid", { requestId, elapsed_ms: Date.now() - startedAt });
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
    const publicRepositories = await fetchAllPages(
      `/users/${encodeURIComponent(session.user.login)}/repos?type=owner&sort=updated&direction=desc`,
      null,
      session.accessToken
    );
    const readmeDeadline = Date.now() + README_BUDGET_MS;
    const readmeResults = await mapWithConcurrency(repositories, README_CONCURRENCY, async (repository) => {
      if (Date.now() >= readmeDeadline) {
        return [repository.name, unknownReadme("timeout_budget")];
      }
      try {
        return [repository.name, await fetchReadme(repository.full_name, session.accessToken)];
      } catch (error) {
        if (error instanceof PrivateRepositoryError && error.status === 401) throw error;
        const reason = getReadmeFailureReason(error);
        logDiagnostic("readme_unavailable", {
          requestId,
          repository_id: repository.id,
          reason,
          github_status: error?.githubStatus || null,
          attempts: error?.attempts || 1,
          elapsed_ms: Date.now() - startedAt,
        });
        return [repository.name, unknownReadme(reason)];
      }
    });
    const readmes = Object.fromEntries(readmeResults);
    const unavailable = readmeResults.filter(([, readme]) => readme.present === null);
    const issueCounts = unavailable.reduce((counts, [, readme]) => {
      counts[readme.unavailable_reason] = (counts[readme.unavailable_reason] || 0) + 1;
      return counts;
    }, {});

    logDiagnostic("private_audit_complete", {
      requestId,
      repository_count: repositories.length,
      public_repository_count: publicRepositories.length,
      readme_unavailable_count: unavailable.length,
      readme_issue_counts: issueCounts,
      elapsed_ms: Date.now() - startedAt,
      timeout_risk: Date.now() >= readmeDeadline,
    });

    response.status(200).json({
      installation: installations.length > 0,
      configure_url: process.env.GITHUB_APP_INSTALL_URL || null,
      repositories: repositories.map(sanitizeRepository),
      public_repositories: publicRepositories.map(sanitizeRepository),
      readmes,
      metadata: {
        complete: unavailable.length === 0,
        unavailable_readmes: unavailable.length,
        issues: issueCounts,
      },
    });
  } catch (error) {
    const known = error instanceof PrivateRepositoryError;
    logDiagnostic(known ? diagnosticType(error) : "unexpected_error", {
      requestId,
      status: known ? error.status : 502,
      github_status: error?.githubStatus || null,
      attempts: error?.attempts || 1,
      elapsed_ms: Date.now() - startedAt,
    });
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
    const pageValues = collectionName === null ? data : data?.[collectionName];
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
  for (let attempt = 1; attempt <= GITHUB_MAX_ATTEMPTS; attempt += 1) {
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
    try {
      response = await fetchImplementation(`${GITHUB_API_URL}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "gitprofilelens",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: controller.signal,
      });
    } catch (cause) {
      clearTimeout(timeout);
      if (attempt < GITHUB_MAX_ATTEMPTS) {
        await delay(100 * (2 ** (attempt - 1)));
        continue;
      }
      const error = new PrivateRepositoryError("GitHub could not return authorized repositories.");
      error.failureType = cause?.name === "AbortError" ? "timeout" : "network";
      error.attempts = attempt;
      throw error;
    }
    clearTimeout(timeout);
    if (response.status === 401) {
      const error = new PrivateRepositoryError("Your GitHub authorization is no longer valid. Please sign in again.", 401, true);
      error.githubStatus = 401;
      throw error;
    }
    if (response.status === 403 || response.status === 429) {
      const reset = formatRateLimitReset(response.headers?.get?.("x-ratelimit-reset"));
      const remaining = response.headers?.get?.("x-ratelimit-remaining");
      const rateLimited = response.status === 429 || remaining === "0";
      const error = new PrivateRepositoryError(
        rateLimited ? `GitHub API rate limit reached.${reset}` : "GitHub denied access to a requested resource.",
        rateLimited ? 429 : 403
      );
      error.githubStatus = response.status;
      error.failureType = rateLimited ? "rate_limit" : "forbidden";
      throw error;
    }
    if (response.status === 404) throw Object.assign(new PrivateRepositoryError("GitHub resource not found.", 404), { githubStatus: 404, failureType: "not_found" });
    if (response.status >= 500 && attempt < GITHUB_MAX_ATTEMPTS) {
      await delay(100 * (2 ** (attempt - 1)));
      continue;
    }
    if (!response.ok) {
      const error = new PrivateRepositoryError("GitHub could not return authorized repositories.");
      error.githubStatus = response.status;
      error.failureType = response.status >= 500 ? "github_5xx" : "permanent";
      error.attempts = attempt;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      const error = new PrivateRepositoryError("GitHub returned an invalid repository response.");
      error.failureType = "invalid_response";
      throw error;
    }
  }
}

function unknownReadme(reason) {
  return { present: null, size: null, unavailable_reason: reason };
}

function getReadmeFailureReason(error) {
  if (error?.failureType) return error.failureType;
  if (error?.githubStatus >= 500) return "github_5xx";
  return "unknown";
}

function diagnosticType(error) {
  if (error.status === 401) return "session_invalid";
  if (error.failureType === "rate_limit") return "github_rate_limit";
  if (["network", "timeout", "github_5xx"].includes(error.failureType)) return "github_transient_failure";
  return "github_permanent_failure";
}

function formatRateLimitReset(resetHeader) {
  const reset = Number(resetHeader);
  if (!Number.isFinite(reset) || reset <= 0) return " Please try again later.";
  return ` Please try again after ${new Date(reset * 1000).toISOString()}.`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function logDiagnostic(event, details) {
  console.info(JSON.stringify({ component: "private-repositories", event, ...details }));
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
    fork: repository.fork === true ? true : repository.fork === false ? false : null,
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
