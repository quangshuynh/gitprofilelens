const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateRecommendations,
  parseUsernameFromSearch,
  scoreDescription,
  scoreDiscoverability,
  scoreMaintenance,
  scoreName,
  scorePortfolioFocus,
  scoreProfile,
  scoreRepository,
  transformRepository,
  scoreReadme,
} = require("../audit.js");

/**
 * creates representative github repository response data for tests
 * @param {Object} overrides repository properties to override
 * @returns {Object} github repository response fixture
 */
function createRepository(overrides = {}) {
  return {
    name: "transaction-validator",
    full_name: "example/transaction-validator",
    description: "FastAPI service that validates transaction data using PostgreSQL",
    html_url: "https://github.com/example/transaction-validator",
    homepage: "https://example.com",
    language: "Python",
    topics: ["fastapi", "postgresql", "validation"],
    license: { spdx_id: "MIT" },
    stargazers_count: 4,
    forks_count: 1,
    open_issues_count: 0,
    archived: false,
    fork: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    pushed_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

test("strong descriptions score highly while vague descriptions explain what is missing", () => {
  const strong = scoreDescription("FastAPI service that validates transaction data using PostgreSQL");
  const vague = scoreDescription("Python project");

  assert.equal(strong.score, 100);
  assert.ok(vague.score < 70);
  assert.match(vague.findings[0].action, /problem solved|key behavior/i);
});

test("repository names distinguish clear, inconsistent, generic, and unusual valid names", () => {
  assert.equal(scoreName("transaction-validator").score, 100);
  assert.ok(scoreName("Transaction_Validator").score < 100);
  assert.ok(scoreName("project-2").score < 70);
  assert.equal(scoreName("cli.v2").score, 100);
});

test("description findings preserve factual and subjective distinctions", () => {
  const missing = scoreDescription(null);
  const empty = scoreDescription(undefined);
  const placeholder = scoreDescription("WIP");
  const vague = scoreDescription("Web app");

  assert.equal(missing.score, 0);
  assert.equal(empty.score, 0);
  assert.equal(missing.findings[0].factual, true);
  assert.ok(placeholder.findings.some((finding) => finding.factual && finding.severity === "high"));
  assert.ok(vague.findings.some((finding) => finding.factual === false));
});

test("repository transformation preserves factual metadata and supplemental readme state", () => {
  const transformed = transformRepository(createRepository(), {
    pinnedRepositories: ["transaction-validator"],
    readmes: { "transaction-validator": { present: true, size: 1800 } },
  });

  assert.equal(transformed.pinned, true);
  assert.equal(transformed.readme.present, true);
  assert.equal(transformed.readme.size, 1800);
  assert.deepEqual(transformed.topics, ["fastapi", "postgresql", "validation"]);
});

test("repository scoring identifies missing presentation fundamentals", () => {
  const repository = transformRepository(createRepository({
    name: "test",
    description: null,
    homepage: null,
    topics: [],
    license: null,
    pushed_at: "2020-01-01T00:00:00Z",
  }), {
    pinnedRepositories: [],
    readmes: { test: { present: false, size: null } },
  });
  const audit = scoreRepository(repository, new Date("2026-08-21T00:00:00Z"));

  assert.ok(audit.score < 40);
  assert.ok(audit.findings.some((finding) => /no root README/i.test(finding.reason)));
  assert.ok(audit.findings.some((finding) => /too generic/i.test(finding.reason)));
});

test("README scoring rewards useful structure and explains missing core guidance", () => {
  const rich = scoreReadme({
    present: true, size: 1800,
    sections: { overview: true, installation: true, usage: true, examples: true, contributing: true },
    hasCodeBlock: true, hasImage: true, headingCount: 6,
  });
  const sparse = scoreReadme({
    present: true, size: 900,
    sections: { overview: true, installation: false, usage: false, examples: false, contributing: false },
    hasCodeBlock: false, hasImage: false, headingCount: 1,
  });

  assert.equal(rich.score, 100);
  assert.ok(sparse.score < rich.score);
  assert.ok(sparse.findings.some((finding) => /installation or setup, usage/i.test(finding.reason)));
  assert.ok(sparse.findings.some((finding) => /no detected example/i.test(finding.reason)));
});

test("unknown, missing, short, and useful READMEs remain distinct", () => {
  const unknown = scoreReadme({ present: null, size: null });
  const missing = scoreReadme({ present: false, size: null });
  const short = scoreReadme({ present: true, size: 120 });
  const useful = scoreReadme({ present: true, size: 1400 });

  assert.equal(unknown.score, 60);
  assert.equal(unknown.findings[0].severity, "info");
  assert.doesNotMatch(unknown.findings[0].reason, /no root README/i);
  assert.equal(missing.score, 10);
  assert.match(missing.findings[0].reason, /no root README/i);
  assert.equal(short.score, 55);
  assert.equal(useful.score, 100);
});

test("README structure signals contribute independently to its score", () => {
  const base = { present: true, size: 1000, sections: { overview: false, installation: false, usage: false, examples: false, contributing: false }, hasCodeBlock: false, hasImage: false, headingCount: 0 };
  const overview = scoreReadme({ ...base, sections: { ...base.sections, overview: true } });
  const setup = scoreReadme({ ...base, sections: { ...base.sections, installation: true } });
  const usage = scoreReadme({ ...base, sections: { ...base.sections, usage: true } });
  const extras = scoreReadme({ ...base, sections: { ...base.sections, examples: true, contributing: true }, hasCodeBlock: true, hasImage: true, headingCount: 4 });

  assert.ok(overview.score > scoreReadme(base).score);
  assert.equal(overview.score, setup.score);
  assert.equal(setup.score, usage.score);
  assert.ok(extras.score > scoreReadme(base).score);
});

test("discoverability only expects demos for likely web projects", () => {
  const base = { topics: ["api"], license: "MIT", homepage: null, archived: false };
  const webWithoutDemo = scoreDiscoverability({ ...base, language: "JavaScript" });
  const webWithDemo = scoreDiscoverability({ ...base, language: "JavaScript", homepage: "https://example.com" });
  const backendWithoutDemo = scoreDiscoverability({ ...base, language: "Python" });
  const missingMetadata = scoreDiscoverability({ ...base, language: "Python", topics: [], license: null });

  assert.ok(webWithoutDemo.score < webWithDemo.score);
  assert.equal(backendWithoutDemo.score, 100);
  assert.ok(missingMetadata.findings.some((finding) => /no topics/i.test(finding.reason)));
  assert.ok(missingMetadata.findings.some((finding) => /no detected license/i.test(finding.reason)));
});

test("maintenance scoring uses fixed dates and treats archives as intentional", () => {
  const now = new Date("2026-08-21T00:00:00Z");
  const active = { archived: false, pushedAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" };

  assert.equal(scoreMaintenance(active, now).score, 100);
  assert.equal(scoreMaintenance({ ...active, pushedAt: "2024-05-01T00:00:00Z" }, now).score, 65);
  assert.equal(scoreMaintenance({ ...active, pushedAt: "2020-01-01T00:00:00Z" }, now).score, 35);
  assert.equal(scoreMaintenance({ ...active, archived: true, pushedAt: "2020-01-01T00:00:00Z" }, now).score, 85);
});

test("portfolio focus handles empty, focused, mixed, and archived portfolios", () => {
  assert.equal(scorePortfolioFocus([]), 0);
  assert.equal(scorePortfolioFocus([{ language: "JavaScript", archived: false, fork: false }]), 85);
  assert.equal(scorePortfolioFocus([
    { language: "JavaScript", archived: false, fork: false },
    { language: "JavaScript", archived: false, fork: false },
    { language: "JavaScript", archived: false, fork: false },
  ]), 85);
  const mixed = scorePortfolioFocus([
    { language: "JavaScript", archived: false, fork: false },
    { language: "Python", archived: false, fork: false },
  ]);
  const curated = scorePortfolioFocus([
    { language: "JavaScript", archived: false, fork: false },
    { language: "Python", archived: true, fork: false },
  ]);
  assert.ok(mixed < 85);
  assert.ok(curated > mixed);
});

test("profile recommendations rank widespread high-severity issues", () => {
  const missingReadme = transformRepository(createRepository({ name: "one" }), {
    pinnedRepositories: [],
    readmes: { one: { present: false, size: null } },
  });
  const missingDescription = transformRepository(createRepository({ name: "two", description: null }), {
    pinnedRepositories: [],
    readmes: { two: { present: false, size: null } },
  });
  const audits = [missingReadme, missingDescription].map((repository) =>
    scoreRepository(repository, new Date("2026-08-21T00:00:00Z"))
  );
  const profile = scoreProfile(audits);
  const recommendations = generateRecommendations(audits);

  assert.ok(profile.overall >= 0 && profile.overall <= 100);
  assert.equal(recommendations[0].severity, "high");
  assert.ok(recommendations.some((recommendation) => recommendation.repositories.length === 2));
});

test("recommendations group duplicates, rank severity, and stop at five", () => {
  const makeAudit = (name, findings) => ({ repository: { name, pinned: null, archived: false }, score: 70, findings });
  const finding = (category, severity, action, factual = true) => ({ category, severity, reason: `${category} issue`, action, factual });
  const audits = [
    makeAudit("one", [finding("README quality", "high", "Add README"), finding("Polish", "low", "Polish one")]),
    makeAudit("two", [finding("README quality", "high", "Add README"), finding("Topics", "medium", "Add topics")]),
    makeAudit("three", [finding("License", "medium", "Add license"), finding("Demo", "low", "Add demo"), finding("Name", "low", "Rename")]),
  ];
  const recommendations = generateRecommendations(audits);

  assert.equal(recommendations.length, 5);
  assert.equal(recommendations[0].severity, "high");
  assert.deepEqual(recommendations[0].repositories, ["one", "two"]);
  assert.equal(recommendations.filter((item) => item.action === "Add README").length, 1);
});

test("empty and unverified profiles do not create false README recommendations", () => {
  assert.deepEqual(generateRecommendations([]), []);
  const repository = transformRepository(createRepository(), null);
  const recommendations = generateRecommendations([scoreRepository(repository, new Date("2026-08-21T00:00:00Z"))]);
  assert.equal(recommendations.some((item) => /add a README explaining/i.test(item.action)), false);
});

test("portfolio recommendations suggest strong unpinned repositories when pin data is known", () => {
  const repository = transformRepository(createRepository(), {
    pinnedRepositories: [],
    readmes: { "transaction-validator": { present: true, size: 1800 } },
  });
  const recommendations = generateRecommendations([
    scoreRepository(repository, new Date("2026-08-21T00:00:00Z")),
  ]);

  assert.ok(recommendations.some((recommendation) => /pinning/i.test(recommendation.action)));
});

test("URL username parsing accepts share links and rejects malformed usernames", () => {
  assert.equal(parseUsernameFromSearch("?user=quangshuynh"), "quangshuynh");
  assert.equal(parseUsernameFromSearch("?user=bad--name-"), null);
  assert.equal(parseUsernameFromSearch("?other=value"), null);
});

test("URL username parsing handles empty, encoded, trimmed, and unrelated values", () => {
  assert.equal(parseUsernameFromSearch("?user="), null);
  assert.equal(parseUsernameFromSearch("?user=%20quangshuynh%20"), "quangshuynh");
  assert.equal(parseUsernameFromSearch("?user=octo%2Dcat"), "octo-cat");
  assert.equal(parseUsernameFromSearch("?user=-invalid"), null);
  assert.equal(parseUsernameFromSearch("?page=2&sort=new"), null);
});

test("repository transformation normalizes optional metadata without mutating GitHub data", () => {
  const source = createRepository({
    name: "release.v2", description: null, homepage: "", topics: undefined,
    license: null, archived: true, fork: true,
  });
  const snapshot = structuredClone(source);
  const transformed = transformRepository(source, null);

  assert.equal(transformed.description, null);
  assert.equal(transformed.homepage, null);
  assert.deepEqual(transformed.topics, []);
  assert.equal(transformed.license, null);
  assert.equal(transformed.archived, true);
  assert.equal(transformed.fork, true);
  assert.equal(transformed.createdAt, source.created_at);
  assert.equal(transformed.pinned, null);
  assert.deepEqual(source, snapshot);
});

test("repository transformation preserves explicit privacy and visibility", () => {
  const privateRepository = transformRepository(createRepository({
    private: true,
    visibility: "private",
  }), null);
  const publicRepository = transformRepository(createRepository({
    private: false,
    visibility: undefined,
  }), null);

  assert.equal(privateRepository.private, true);
  assert.equal(privateRepository.visibility, "private");
  assert.equal(publicRepository.private, false);
  assert.equal(publicRepository.visibility, "public");
});

test("profile scoring is deterministic, order-independent, finite, and bounded", () => {
  const now = new Date("2026-08-21T00:00:00Z");
  const repositories = [
    transformRepository(createRepository({ name: "alpha" }), null),
    transformRepository(createRepository({ name: "beta", description: null, topics: [], license: null }), null),
  ];
  const audits = repositories.map((repository) => scoreRepository(repository, now));
  const first = scoreProfile(audits);
  const second = scoreProfile([...audits].reverse());

  assert.deepEqual(first, second);
  assert.ok(Number.isFinite(first.overall));
  assert.ok(first.overall >= 0 && first.overall <= 100);
  for (const score of Object.values(first.categories)) {
    assert.ok(Number.isFinite(score));
    assert.ok(score >= 0 && score <= 100);
  }
});

test("empty profiles return a zero presentation score without throwing", () => {
  assert.deepEqual(scoreProfile([]), {
    overall: 0,
    categories: {
      presentation: 0,
      descriptions: 0,
      readme: 0,
      discoverability: 0,
      maintenance: 0,
      focus: 0,
    },
  });
});
