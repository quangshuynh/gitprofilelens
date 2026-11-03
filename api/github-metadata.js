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

// The GraphQL account types whose repositories GitProfileLens can audit. Any other
// repositoryOwner type, or a node without a type, is not assumed to be a user.
const SUPPORTED_ACCOUNT_TYPES = new Set(["User", "Organization"]);

async function fetchGitHubMetadata(username, token, fetchImplementation = fetch) {
  const readmes = [];
  let pinnedRepositories;
  let account;
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
          variables: { username, cursor, includeProfile: firstPage },
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

    // An organization's profile README is optional and lives in its .github
    // repository. Failing to read it leaves that one fact unverified; it is never
    // a reason to discard the repository metadata, nor evidence that none exists.
    const errors = Array.isArray(data?.errors) ? data.errors : [];
    const blockingErrors = errors.filter((error) => !isProfileReadmeError(error));
    // NOT_FOUND there means the organization has no public .github repository,
    // which is an answer. Any other error leaves the profile README unverified.
    const profileReadmeUnavailable = errors.some(
      (error) => isProfileReadmeError(error) && error.type !== "NOT_FOUND"
    );

    if (!githubResponse.ok || (data?.errors && !Array.isArray(data.errors)) || blockingErrors.length > 0) {
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

    const owner = data?.data?.repositoryOwner;

    if (!owner) {
      throw new GitHubRequestError(
        "GitHub user not found.",
        404
      );
    }

    if (!SUPPORTED_ACCOUNT_TYPES.has(owner.__typename) || (account && owner.__typename !== account.type)) {
      console.error("GitHub GraphQL returned an unsupported account type", {
        username,
        type: typeof owner.__typename === "string" ? owner.__typename : null,
      });

      throw new GitHubRequestError(
        "GitHub returned an invalid metadata response."
      );
    }

    const repositoryConnection = owner.repositories;
    const pinnedNodes = owner.pinnedItems?.nodes;

    if (!Array.isArray(repositoryConnection?.nodes) || (firstPage && !Array.isArray(pinnedNodes))) {
      throw new GitHubRequestError(
        "GitHub returned an invalid metadata response."
      );
    }

    if (firstPage) {
      account = readAccount(owner, profileReadmeUnavailable);
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
    account,
    pinnedRepositories,
    readmes: Object.fromEntries(readmes.map(getReadmeEntry)),
  };
}

/**
 * reads the public account facts GraphQL returned for the audited login
 *
 * Organizations carry a name, a description, and an optional profile README in
 * their public .github repository. Users carry none of these here, and none are
 * invented for them. A profile README is true or false only when GitHub answered;
 * a private .github repository is never read as public evidence.
 *
 * @param {Object} owner repositoryOwner node
 * @param {boolean} profileReadmeUnavailable true when GitHub refused that lookup
 * @returns {Object} account metadata safe for public responses
 */
function readAccount(owner, profileReadmeUnavailable) {
  if (owner.__typename !== "Organization") return { type: "User" };
  const profileRepository = owner.profileReadmeRepository;
  let profileReadme = null;
  if (!profileReadmeUnavailable && profileRepository !== undefined) {
    profileReadme = Boolean(
      profileRepository
      && profileRepository.isPrivate === false
      && Number.isInteger(profileRepository.profileReadme?.byteSize)
    );
  }
  return {
    type: "Organization",
    name: typeof owner.name === "string" && owner.name.trim() ? owner.name.trim() : null,
    description: typeof owner.description === "string" && owner.description.trim() ? owner.description.trim() : null,
    profileReadme,
  };
}

/**
 * identifies a GraphQL error confined to the optional profile README lookup
 * @param {Object} error GraphQL error
 * @returns {boolean} true when only the profile README lookup failed
 */
function isProfileReadmeError(error) {
  return Array.isArray(error?.path)
    && error.path[0] === "repositoryOwner"
    && error.path[1] === "profileReadmeRepository"
    && error?.type !== "RATE_LIMITED";
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
  query PinnedRepositories($username: String!, $cursor: String, $includeProfile: Boolean!) {
    repositoryOwner(login: $username) {
      __typename

      ... on ProfileOwner @include(if: $includeProfile) {
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
      }

      ... on Organization @include(if: $includeProfile) {
        name
        description
        profileReadmeRepository: repository(name: ".github") {
          isPrivate
          profileReadme: object(expression: "HEAD:profile/README.md") {
            ... on Blob {
              byteSize
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
