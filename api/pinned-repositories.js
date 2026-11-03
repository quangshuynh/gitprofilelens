const { isValidUsername } = require("../audit.js");
const { fetchGitHubMetadata, GitHubRequestError } = require("./github-metadata.js");

async function pinnedRepositoriesHandler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const username = String(request.query.username || "").trim();
  if (!isValidUsername(username)) {
    response.status(400).json({ error: "A valid GitHub username is required." });
    return;
  }
  if (!process.env.GITHUB_TOKEN) {
    response.status(503).json({ error: "The GitHub API token is not configured." });
    return;
  }

  try {
    const metadata = await fetchGitHubMetadata(username, process.env.GITHUB_TOKEN);
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    response.status(200).json({
      repositories: metadata.pinnedRepositories,
      readmes: metadata.readmes,
      account: metadata.account,
    });
  } catch (error) {
    const knownError = error instanceof GitHubRequestError;
    response.status(knownError ? error.status : 502).json({
      error: knownError ? error.message : "GitHub could not return pinned repositories.",
    });
  }
}

module.exports = pinnedRepositoriesHandler;
