const { createReport, isValidUsername, transformRepository } = require("../audit.js");
const { fetchGitHubMetadata, GitHubRequestError } = require("./github-metadata.js");
const { fetchGitHubContributions } = require("./github-contributions.js");

const GITHUB_API_URL = "https://api.github.com";

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
    await fetchGitHubRest(`/users/${encodeURIComponent(username)}`, process.env.GITHUB_TOKEN);
    const [rawRepositories, supplemental, contributedRepositories] = await Promise.all([
      fetchPublicRepositories(username, process.env.GITHUB_TOKEN),
      fetchGitHubMetadata(username, process.env.GITHUB_TOKEN),
      fetchContributionsGracefully(username, process.env.GITHUB_TOKEN),
    ]);
    const repositories = rawRepositories
      .filter((repository) => !repository.private)
      .map((repository) => transformRepository(repository, supplemental));
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    response.status(200).json(createReport(username, repositories, contributedRepositories));
  } catch (error) {
    const knownError = error instanceof GitHubRequestError;
    response.status(knownError ? error.status : 502).json({
      error: knownError ? error.message : "GitHub could not generate the report.",
    });
  }
}

async function fetchContributionsGracefully(username, token) {
  try {
    return await fetchGitHubContributions(username, token);
  } catch (error) {
    // Contributions are supplemental. A safe diagnostic is logged, while the
    // owned-repository report remains available even for contribution rate limits.
    console.error("GitHub contribution discovery failed", {
      username,
      status: error instanceof GitHubRequestError ? error.status : 502,
      message: error instanceof GitHubRequestError ? error.message : "Unexpected contribution error",
    });
    return [];
  }
}

async function fetchPublicRepositories(username, token) {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const pageRepositories = await fetchGitHubRest(
      `/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated&direction=desc&per_page=100&page=${page}`,
      token
    );
    if (!Array.isArray(pageRepositories)) {
      throw new GitHubRequestError("GitHub returned an invalid repository response.");
    }
    repositories.push(...pageRepositories);
    if (pageRepositories.length < 100) return repositories;
  }
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
    throw new GitHubRequestError("GitHub API rate limit reached.", 429);
  }
  if (!githubResponse.ok) throw new GitHubRequestError("GitHub API request failed.");
  try {
    return await githubResponse.json();
  } catch {
    throw new GitHubRequestError("GitHub returned an invalid response.");
  }
}

module.exports = reportHandler;
