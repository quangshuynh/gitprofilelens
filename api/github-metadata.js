const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

class GitHubRequestError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "GitHubRequestError";
    this.status = status;
  }
}

async function fetchGitHubMetadata(username, token, fetchImplementation = fetch) {
  let githubResponse;
  try {
    githubResponse = await fetchImplementation(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "gitprofilelens",
      },
      body: JSON.stringify({ query: METADATA_QUERY, variables: { username } }),
    });
  } catch {
    throw new GitHubRequestError("GitHub could not return repository metadata.");
  }

  let data;
  try {
    data = await githubResponse.json();
  } catch {
    throw new GitHubRequestError("GitHub returned an invalid metadata response.");
  }
  if (githubResponse.status === 403 || githubResponse.status === 429) {
    throw new GitHubRequestError("GitHub API rate limit reached.", 429);
  }
  if (!githubResponse.ok || data.errors) {
    throw new GitHubRequestError("GitHub could not return repository metadata.");
  }
  if (!data.data?.user) {
    throw new GitHubRequestError("GitHub user not found.", 404);
  }

  return {
    pinnedRepositories: data.data.user.pinnedItems.nodes.map((repository) => repository.name),
    readmes: Object.fromEntries(data.data.user.repositories.nodes.map(getReadmeEntry)),
  };
}

function getReadmeEntry(repository) {
  const readme = repository.readmeMarkdown || repository.readmeUppercase || repository.readmeLowercase;
  return [repository.name, readme
    ? { present: true, size: readme.byteSize, ...analyzeReadme(readme.text || "") }
    : { present: false, size: null }];
}

function analyzeReadme(markdown) {
  const headings = [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((match) => match[1].replace(/[*_`#]/g, "").trim().toLowerCase());
  const hasHeading = (pattern) => headings.some((heading) => pattern.test(heading));
  return {
    sections: {
      overview: hasHeading(/overview|about|introduction|what (?:it|this)|features?/),
      installation: hasHeading(/install|setup|getting started|prerequisites?/),
      usage: hasHeading(/usage|how to use|quick ?start|running/),
      examples: hasHeading(/examples?|demo|screenshots?|preview/),
      contributing: hasHeading(/contribut|development/),
    },
    hasCodeBlock: /```[\s\S]*?```/.test(markdown),
    hasImage: /!\[[^\]]*\]\([^)]+\)|<img\b/i.test(markdown),
    headingCount: headings.length,
  };
}

const METADATA_QUERY = `
  query PinnedRepositories($username: String!) {
    user(login: $username) {
      pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { name } } }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC) {
        nodes {
          name
          readmeMarkdown: object(expression: "HEAD:README.md") { ... on Blob { byteSize text } }
          readmeUppercase: object(expression: "HEAD:README") { ... on Blob { byteSize text } }
          readmeLowercase: object(expression: "HEAD:readme.md") { ... on Blob { byteSize text } }
        }
      }
    }
  }
`;

module.exports = { analyzeReadme, fetchGitHubMetadata, GitHubRequestError };
