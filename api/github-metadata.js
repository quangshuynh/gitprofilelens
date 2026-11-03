const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
// 100 pages of 100 repositories. A cursor GitHub never stops returning must not
// spend the server token's budget forever.
const MAX_METADATA_PAGES = 100;

class GitHubRequestError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "GitHubRequestError";
    this.status = status;
  }
}

async function fetchGitHubMetadata(username, token, fetchImplementation = fetch) {
  const readmes = [];
  let pinnedRepositories;
  let cursor = null;
  let firstPage = true;
  const seenCursors = new Set();

  for (let page = 1; ; page += 1) {
    if (page > MAX_METADATA_PAGES) {
      throw new GitHubRequestError(
        "GitHub returned more repository metadata pages than GitProfileLens can retrieve."
      );
    }

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
        body: JSON.stringify({
          query: METADATA_QUERY,
          variables: { username, cursor },
        }),
      });
    } catch (error) {
      console.error("GitHub GraphQL request failed", {
        username,
        error,
      });

      throw new GitHubRequestError(
        "GitHub could not return repository metadata."
      );
    }

    let data;

    try {
      data = await githubResponse.json();
    } catch (error) {
      console.error("GitHub GraphQL returned invalid JSON", {
        username,
        status: githubResponse.status,
        statusText: githubResponse.statusText,
        error,
      });

      throw new GitHubRequestError(
        "GitHub returned an invalid metadata response."
      );
    }

    if (githubResponse.status === 403 || githubResponse.status === 429) {
      console.error("GitHub GraphQL rate limit reached", {
        username,
        status: githubResponse.status,
        statusText: githubResponse.statusText,
        errors: data?.errors ?? null,
      });

      throw new GitHubRequestError(
        "GitHub API rate limit reached.",
        429
      );
    }

    // GraphQL reports its own rate limit inside a 200 response.
    if (Array.isArray(data?.errors) && data.errors.some((error) => error?.type === "RATE_LIMITED")) {
      console.error("GitHub GraphQL rate limit reached", {
        username,
        status: githubResponse.status,
        errors: data.errors,
      });

      throw new GitHubRequestError(
        "GitHub API rate limit reached.",
        429
      );
    }

    if (!githubResponse.ok || data?.errors) {
      console.error("GitHub GraphQL metadata request failed", {
        username,
        status: githubResponse.status,
        statusText: githubResponse.statusText,
        errors: data?.errors ?? null,
      });

      throw new GitHubRequestError(
        "GitHub could not return repository metadata."
      );
    }

    if (!data?.data?.user) {
      throw new GitHubRequestError(
        "GitHub user not found.",
        404
      );
    }

    const repositoryConnection = data.data.user.repositories;
    const pinnedNodes = data.data.user.pinnedItems?.nodes;

    if (!Array.isArray(repositoryConnection?.nodes) || (firstPage && !Array.isArray(pinnedNodes))) {
      throw new GitHubRequestError(
        "GitHub returned an invalid metadata response."
      );
    }

    if (firstPage) {
      pinnedRepositories = pinnedNodes
        .filter((repository) => isPublicOwnedPin(repository, username))
        .map((repository) => repository.name);
    }

    // A node GitHub could not resolve is null. It carries no README evidence, and
    // the repository it stood for is then scored as unverified, not as missing.
    readmes.push(...repositoryConnection.nodes.filter(
      (repository) => typeof repository?.name === "string"
    ));
    firstPage = false;

    const pageInfo = repositoryConnection.pageInfo;

    if (!pageInfo?.hasNextPage) {
      break;
    }

    if (!pageInfo.endCursor || seenCursors.has(pageInfo.endCursor)) {
      throw new GitHubRequestError(
        "GitHub returned invalid repository pagination metadata."
      );
    }

    seenCursors.add(pageInfo.endCursor);
    cursor = pageInfo.endCursor;
  }

  return {
    pinnedRepositories,
    readmes: Object.fromEntries(readmes.map(getReadmeEntry)),
  };
}

/**
 * keeps a pinned item only when it is a public repository this account owns
 *
 * Pins are matched to owned repositories by name. A pin of someone else's
 * repository would otherwise mark an unrelated owned repository of the same name
 * as pinned, and a private pin must never reach a public, cacheable response.
 * Fields GitHub did not return are not treated as disqualifying.
 *
 * @param {Object|null} repository pinned item node
 * @param {string} username audited login
 * @returns {boolean} true when the pin belongs in public metadata
 */
function isPublicOwnedPin(repository, username) {
  if (typeof repository?.name !== "string" || !repository.name) return false;
  if (repository.isPrivate === true) return false;
  const owner = repository.owner?.login;
  return typeof owner !== "string" || owner.toLowerCase() === username.toLowerCase();
}

function getReadmeEntry(repository) {
  const readme =
    repository.readmeMarkdown ||
    repository.readmeUppercase ||
    repository.readmeLowercase;

  return [
    repository.name,
    readme
      ? {
          present: true,
          size: readme.byteSize,
          ...analyzeReadme(readme.text || ""),
        }
      : {
          present: false,
          size: null,
        },
  ];
}

function analyzeReadme(markdown) {
  const headings = [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((match) =>
      match[1]
        .replace(/[*_`#]/g, "")
        .trim()
        .toLowerCase()
    );

  const hasHeading = (pattern) =>
    headings.some((heading) => pattern.test(heading));

  return {
    sections: {
      overview: hasHeading(
        /overview|about|introduction|what (?:it|this)|features?/
      ),
      installation: hasHeading(
        /install|setup|getting started|prerequisites?/
      ),
      usage: hasHeading(
        /usage|how to use|quick ?start|running/
      ),
      examples: hasHeading(
        /examples?|demo|screenshots?|preview/
      ),
      contributing: hasHeading(
        /contribut|development/
      ),
    },
    hasCodeBlock: /```[\s\S]*?```/.test(markdown),
    hasImage: /!\[[^\]]*\]\([^)]+\)|<img\b/i.test(markdown),
    headingCount: headings.length,
  };
}

const METADATA_QUERY = `
  query PinnedRepositories($username: String!, $cursor: String) {
    user(login: $username) {
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes {
          ... on Repository {
            name
            isPrivate
            owner {
              login
            }
          }
        }
      }

      repositories(
        first: 100
        after: $cursor
        ownerAffiliations: OWNER
        privacy: PUBLIC
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }

        nodes {
          name

          readmeMarkdown: object(expression: "HEAD:README.md") {
            ... on Blob {
              byteSize
              text
            }
          }

          readmeUppercase: object(expression: "HEAD:README") {
            ... on Blob {
              byteSize
              text
            }
          }

          readmeLowercase: object(expression: "HEAD:readme.md") {
            ... on Blob {
              byteSize
              text
            }
          }
        }
      }
    }
  }
`;

module.exports = {
  analyzeReadme,
  fetchGitHubMetadata,
  GitHubRequestError,
};
