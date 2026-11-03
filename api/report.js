const {
  appendUniqueRepositories,
  assessRepositoryCoverage,
  createReport,
  isValidUsername,
  transformRepository,
} = require("../audit.js");
const { fetchGitHubMetadata, GitHubRequestError } = require("./github-metadata.js");
const { fetchGitHubContributions } = require("./github-contributions.js");

const GITHUB_API_URL = "https://api.github.com";
const REPOSITORIES_PER_PAGE = 100;
// 10,000 repositories. Retrieval past this stops and is reported as incomplete.
const MAX_REPOSITORY_PAGES = 100;

async function reportHandler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const username = String(request.query.user || "").trim();
  if (!username) {
    response.status(400).json({ error: "GitHub username is required" });
    return;
  }
  if (!isValidUsername(username)) {
    response.status(400).json({ error: "A valid GitHub username is required" });
    return;
  }
  if (!process.env.GITHUB_TOKEN) {
    response.status(503).json({ error: "GitHub API access is not configured" });
    return;
  }

  try {
    const { data: profile } = await fetchGitHubRest(`/users/${encodeURIComponent(username)}`, process.env.GITHUB_TOKEN);
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      throw new GitHubRequestError("GitHub returned an invalid response.");
    }
    const isOrganization = profile.type === "Organization";
    const [retrieval, supplemental, contributions] = await Promise.all([
      fetchPublicRepositories(username, process.env.GITHUB_TOKEN),
      fetchGitHubMetadata(username, process.env.GITHUB_TOKEN),
      // Organizations cannot author pull requests, so searching for theirs would
      // spend a request to learn nothing.
      isOrganization
        ? { repositories: [], available: false, applicable: false }
        : fetchContributionsGracefully(username, process.env.GITHUB_TOKEN),
    ]);
    if (profile.type && supplemental.account && profile.type !== supplemental.account.type) {
      throw new GitHubRequestError("GitHub returned inconsistent account metadata.");
    }
    const repositories = retrieval.repositories
      .filter((repository) => !repository.private)
      .map((repository) => transformRepository(repository, supplemental));
    const coverage = assessRepositoryCoverage({
      reported: profile?.public_repos,
      retrieved: repositories.length,
      truncated: retrieval.truncated,
    });
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    response.status(200).json({
      ...createReport(username, repositories, contributions.repositories),
      contributed_repositories_available: contributions.available,
      contributed_repositories_applicable: contributions.applicable !== false,
      account: describeAccount(profile, supplemental.account),
      coverage: {
        state: coverage.state,
        reported_repositories: coverage.reported,
        retrieved_repositories: coverage.retrieved,
      },
    });
  } catch (error) {
    const knownError = error instanceof GitHubRequestError;
    response.status(knownError ? error.status : 502).json({
      error: knownError ? error.message : "GitHub could not generate the report.",
    });
  }
}

/**
 * describes the audited account using only fields its type actually has
 * @param {Object} profile REST profile
 * @param {Object|undefined} account GraphQL account metadata
 * @returns {Object} public account description
 */
function describeAccount(profile, account) {
  const type = account?.type || (profile.type === "Organization" ? "Organization" : "User");
  if (type !== "Organization") return { type };
  return {
    type,
    name: account?.name ?? (typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : null),
    description: account?.description ?? null,
    profile_readme: account?.profileReadme ?? null,
  };
}

async function fetchContributionsGracefully(username, token) {
  try {
    return { repositories: await fetchGitHubContributions(username, token), available: true, applicable: true };
  } catch (error) {
    // Contributions are supplemental. A safe diagnostic is logged, while the
    // owned-repository report remains available even for contribution rate limits.
    console.error("GitHub contribution discovery failed", {
      username,
      status: error instanceof GitHubRequestError ? error.status : 502,
      message: error instanceof GitHubRequestError ? error.message : "Unexpected contribution error",
    });
    // An empty list here means "not known", which the response states separately.
    return { repositories: [], available: false, applicable: true };
  }
}

/**
 * retrieves every public repository the account owns, without duplicates
 *
 * A Link header without rel="next" ends retrieval without requesting an empty
 * trailing page. Without a Link header the short-page rule applies. A full page
 * that adds nothing new means GitHub is repeating itself, so retrieval stops and
 * is reported as truncated rather than looping.
 *
 * @param {string} username github login
 * @param {string} token server token
 * @returns {Promise<{repositories: Array<Object>, truncated: boolean}>} retrieval
 */
async function fetchPublicRepositories(username, token) {
  const repositories = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    const { data: pageRepositories, link } = await fetchGitHubRest(
      `/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated&direction=desc&per_page=${REPOSITORIES_PER_PAGE}&page=${page}`,
      token
    );
    if (!Array.isArray(pageRepositories)) {
      throw new GitHubRequestError("GitHub returned an invalid repository response.");
    }
    const added = appendUniqueRepositories(repositories, seen, pageRepositories);
    if (pageRepositories.length < REPOSITORIES_PER_PAGE) return { repositories, truncated: false };
    if (typeof link === "string" && !/rel="next"/.test(link)) return { repositories, truncated: false };
    if (added === 0) return { repositories, truncated: true };
  }
  return { repositories, truncated: true };
}

/**
 * decides whether a 403 or 429 is a rate limit rather than a refusal
 *
 * GitHub sends 403 both for exhausted or secondary rate limits and for
 * resources it refuses to serve. Without any rate-limit headers the two cannot
 * be told apart, and the long-standing rate-limit reading is kept.
 *
 * @param {Object} githubResponse fetch response
 * @param {string} message GitHub error message, if one could be read
 * @returns {boolean} true when the response is a rate limit
 */
function isRateLimitResponse(githubResponse, message) {
  if (githubResponse.status === 429) return true;
  const remaining = githubResponse.headers?.get?.("x-ratelimit-remaining");
  if (remaining === "0") return true;
  if (githubResponse.headers?.get?.("retry-after")) return true;
  if (/rate limit/i.test(message || "")) return true;
  return remaining === null || remaining === undefined;
}

async function fetchGitHubRest(path, token, fetchImplementation = fetch) {
  let githubResponse;
  try {
    githubResponse = await fetchImplementation(`${GITHUB_API_URL}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "gitprofilelens",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    throw new GitHubRequestError("GitHub API request failed.");
  }

  if (githubResponse.status === 404) throw new GitHubRequestError("GitHub user not found.", 404);
  if (githubResponse.status === 403 || githubResponse.status === 429) {
    let message = "";
    try {
      message = String((await githubResponse.json())?.message || "");
    } catch {
      // An unreadable body is classified from the headers alone.
    }
    if (isRateLimitResponse(githubResponse, message)) {
      throw new GitHubRequestError("GitHub API rate limit reached.", 429);
    }
    throw new GitHubRequestError("GitHub denied access to this account's public data.", 403);
  }
  if (!githubResponse.ok) throw new GitHubRequestError("GitHub API request failed.");
  let data;
  try {
    data = await githubResponse.json();
  } catch {
    throw new GitHubRequestError("GitHub returned an invalid response.");
  }
  return { data, link: githubResponse.headers?.get?.("link") ?? null };
}

module.exports = reportHandler;
