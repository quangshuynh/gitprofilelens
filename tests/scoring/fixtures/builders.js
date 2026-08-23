/**
 * Fixture builders for the scoring evaluation corpus.
 *
 * Fixtures are authored in a compact, readable shape and expanded here into the
 * exact GitHub REST payloads the application receives. Keeping the fixture
 * boundary at the raw REST shape means `transformRepository` stays inside the
 * tested surface, so normalization bugs (topics, licenses, visibility, pins)
 * are caught by the corpus rather than skipped by it.
 *
 * README presets carry their resulting `scoreReadme` value in a comment so that
 * fixture authors can reason about a persona without running the scorer.
 */

const REPOSITORY_KEYS = new Set([
  "name",
  "note",
  "description",
  "language",
  "topics",
  "license",
  "homepage",
  "pushedAt",
  "updatedAt",
  "createdAt",
  "stars",
  "forks",
  "openIssues",
  "archived",
  "fork",
  "private",
  "visibility",
  "pinned",
  "readme",
]);

const MAXIMUM_PINNED_REPOSITORIES = 6;

/**
 * expands a fixture date into a github timestamp
 * @param {string} date iso date such as 2026-07-28
 * @returns {string} iso timestamp
 */
function timestamp(date) {
  return `${date}T00:00:00Z`;
}

/**
 * builds the github rest payload for one fixture repository
 * @param {string} username owning account login
 * @param {Object} fixture compact repository fixture
 * @returns {Object} github rest repository payload
 */
function buildRepository(username, fixture) {
  for (const key of Object.keys(fixture)) {
    if (!REPOSITORY_KEYS.has(key)) {
      throw new Error(`Unknown repository fixture field "${key}" on ${fixture.name}.`);
    }
  }
  if (!fixture.name) throw new Error("Repository fixtures require a name.");
  if (!fixture.note) throw new Error(`Repository fixture ${fixture.name} requires a note explaining why it exists.`);
  if (!fixture.pushedAt) throw new Error(`Repository fixture ${fixture.name} requires a pushedAt date.`);

  return {
    name: fixture.name,
    full_name: `${username}/${fixture.name}`,
    description: fixture.description ?? null,
    html_url: `https://github.com/${username}/${fixture.name}`,
    homepage: fixture.homepage ?? null,
    language: fixture.language ?? null,
    topics: fixture.topics ?? [],
    license: fixture.license ? { spdx_id: fixture.license } : null,
    stargazers_count: fixture.stars ?? 0,
    forks_count: fixture.forks ?? 0,
    open_issues_count: fixture.openIssues ?? 0,
    archived: fixture.archived ?? false,
    fork: fixture.fork ?? false,
    private: fixture.private ?? false,
    visibility: fixture.visibility ?? (fixture.private ? "private" : "public"),
    created_at: timestamp(fixture.createdAt ?? fixture.pushedAt),
    updated_at: timestamp(fixture.updatedAt ?? fixture.pushedAt),
    pushed_at: timestamp(fixture.pushedAt),
  };
}

/**
 * builds a corpus profile from a compact persona definition
 * @param {Object} persona persona definition
 * @returns {Object} corpus profile with rest repositories and supplemental metadata
 */
function buildProfile(persona) {
  if (!persona.id) throw new Error("Profile fixtures require an id.");
  if (!persona.summary) throw new Error(`Profile fixture ${persona.id} requires a summary explaining its expected outcome.`);

  const username = persona.username ?? persona.id;
  const names = new Set();
  const pinnedRepositories = [];
  const readmes = {};

  for (const fixture of persona.repositories) {
    if (names.has(fixture.name)) {
      throw new Error(`Profile fixture ${persona.id} declares ${fixture.name} twice.`);
    }
    names.add(fixture.name);
    if (fixture.pinned) pinnedRepositories.push(fixture.name);
    if (fixture.readme) readmes[fixture.name] = fixture.readme;
  }

  if (pinnedRepositories.length > MAXIMUM_PINNED_REPOSITORIES) {
    throw new Error(`Profile fixture ${persona.id} pins ${pinnedRepositories.length} repositories; GitHub allows ${MAXIMUM_PINNED_REPOSITORIES}.`);
  }

  return {
    id: persona.id,
    username,
    summary: persona.summary,
    repositories: persona.repositories.map((fixture) => buildRepository(username, fixture)),
    supplemental: { pinnedRepositories, readmes },
  };
}

/**
 * builds README metadata for a well-structured project README
 * scoreReadme value: 100
 * @param {Object} overrides readme fields to override
 * @returns {Object} readme metadata
 */
function comprehensiveReadme(overrides = {}) {
  return {
    present: true,
    size: 2400,
    sections: { overview: true, installation: true, usage: true, examples: true, contributing: true },
    hasCodeBlock: true,
    hasImage: true,
    headingCount: 7,
    ...overrides,
  };
}

/**
 * builds README metadata covering the core sections but no example or visual
 * scoreReadme value: 90
 * @param {Object} overrides readme fields to override
 * @returns {Object} readme metadata
 */
function solidReadme(overrides = {}) {
  return {
    present: true,
    size: 1400,
    sections: { overview: true, installation: true, usage: true, examples: false, contributing: false },
    hasCodeBlock: true,
    hasImage: false,
    headingCount: 5,
    ...overrides,
  };
}

/**
 * builds README metadata that introduces a project without explaining its use
 * scoreReadme value: 50
 * @param {Object} overrides readme fields to override
 * @returns {Object} readme metadata
 */
function sparseReadme(overrides = {}) {
  return {
    present: true,
    size: 800,
    sections: { overview: true, installation: false, usage: false, examples: false, contributing: false },
    hasCodeBlock: false,
    hasImage: false,
    headingCount: 2,
    ...overrides,
  };
}

/**
 * builds README metadata for a stub README
 * scoreReadme value: 55, because READMEs under 500 bytes score before structure is considered
 * @param {Object} overrides readme fields to override
 * @returns {Object} readme metadata
 */
function shortReadme(overrides = {}) {
  return {
    present: true,
    size: 180,
    sections: { overview: false, installation: false, usage: false, examples: false, contributing: false },
    hasCodeBlock: false,
    hasImage: false,
    headingCount: 1,
    ...overrides,
  };
}

/**
 * builds README metadata for a repository with no root README
 * scoreReadme value: 10
 * @returns {Object} readme metadata
 */
function missingReadme() {
  return { present: false, size: null };
}

module.exports = {
  buildProfile,
  buildRepository,
  comprehensiveReadme,
  missingReadme,
  shortReadme,
  solidReadme,
  sparseReadme,
};
