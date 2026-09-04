const { GitHubRequestError } = require("./github-metadata.js");

const GITHUB_API_URL = "https://api.github.com";
const RESULTS_PER_PAGE = 100;
// GitHub Search exposes at most 1,000 results. Keep discovery explicitly bounded.
const MAX_SEARCH_PAGES = 10;

async function fetchGitHubContributions(username, token, fetchImplementation = fetch) {
  const pullRequests = [];

  for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
    const query = encodeURIComponent(`author:${username} type:pr is:public`);
    const data = await fetchGitHubRest(
      `/search/issues?q=${query}&sort=updated&order=desc&per_page=${RESULTS_PER_PAGE}&page=${page}`,
      token,
      fetchImplementation
    );

    if (!Array.isArray(data?.items)) {
      throw new GitHubRequestError("GitHub returned an invalid contribution response.");
    }

    pullRequests.push(...data.items);
    if (data.items.length < RESULTS_PER_PAGE || pullRequests.length >= Math.min(data.total_count || 0, 1000)) break;
  }

  const groups = groupPullRequests(pullRequests);
  const eligibleGroups = [...groups.values()].filter(
    (group) => group.owner.toLowerCase() !== username.toLowerCase()
      && group.mergedPullRequests > 0
  );

  const repositories = await Promise.all(eligibleGroups.map(async (group) => {
    const repository = await fetchGitHubRest(
      `/repos/${encodeURIComponent(group.owner)}/${encodeURIComponent(group.name)}`,
      token,
      fetchImplementation
    );
    return normalizeContributedRepository(repository, group);
  }));

  return repositories
    .filter(Boolean)
    .sort((repositoryA, repositoryB) =>
      repositoryB.contribution.merged_pull_requests - repositoryA.contribution.merged_pull_requests
      || repositoryA.full_name.localeCompare(repositoryB.full_name)
    );
}

function groupPullRequests(pullRequests) {
  const groups = new Map();
  const seenPullRequests = new Set();

  for (const pullRequest of pullRequests) {
    const identity = parseRepositoryIdentity(pullRequest?.repository_url);
    if (!identity) continue;

    const pullRequestIdentity = pullRequest.id ?? pullRequest.html_url ?? pullRequest.url;
    if (pullRequestIdentity == null || seenPullRequests.has(String(pullRequestIdentity))) continue;
    seenPullRequests.add(String(pullRequestIdentity));

    const key = identity.fullName.toLowerCase();
    const group = groups.get(key) || {
      owner: identity.owner,
      name: identity.name,
      fullName: identity.fullName,
      pullRequests: 0,
      mergedPullRequests: 0,
    };
    group.pullRequests += 1;
    if (pullRequest.pull_request?.merged_at) group.mergedPullRequests += 1;
    groups.set(key, group);
  }

  return groups;
}

function parseRepositoryIdentity(repositoryUrl) {
  if (typeof repositoryUrl !== "string") return null;
  const match = repositoryUrl.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?#]+)$/i);
  if (!match) return null;
  const owner = decodeURIComponent(match[1]);
  const name = decodeURIComponent(match[2]);
  return { owner, name, fullName: `${owner}/${name}` };
}

function normalizeContributedRepository(repository, group) {
  if (!repository || repository.private === true || repository.visibility === "private") return null;
  const owner = repository.owner?.login || group.owner;
  const name = repository.name || group.name;
  return {
    owner,
    name,
    full_name: repository.full_name || `${owner}/${name}`,
    url: repository.html_url || `https://github.com/${owner}/${name}`,
    description: repository.description || null,
    primary_language: repository.language || null,
    stars: repository.stargazers_count || 0,
    forks: repository.forks_count || 0,
    contribution: {
      pull_requests: group.pullRequests,
      merged_pull_requests: group.mergedPullRequests,
    },
  };
}

async function fetchGitHubRest(path, token, fetchImplementation) {
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
    throw new GitHubRequestError("GitHub contribution discovery failed.");
  }

  if (response.status === 403 || response.status === 429) {
    throw new GitHubRequestError("GitHub API rate limit reached.", 429);
  }
  if (!response.ok) throw new GitHubRequestError("GitHub contribution discovery failed.");
  try {
    return await response.json();
  } catch {
    throw new GitHubRequestError("GitHub returned an invalid contribution response.");
  }
}

module.exports = {
  MAX_SEARCH_PAGES,
  fetchGitHubContributions,
  groupPullRequests,
  normalizeContributedRepository,
  parseRepositoryIdentity,
};
