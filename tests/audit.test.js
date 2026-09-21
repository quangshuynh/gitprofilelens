const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyPortfolioCandidate,
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

/** Frozen evaluation date, matching the scoring corpus harness. */
const EVALUATION_DATE = new Date("2026-08-21T00:00:00Z");

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
    pinnedRepositories: ["first-pin", "transaction-validator", "third-pin"],
    readmes: { "transaction-validator": { present: true, size: 1800 } },
  });

  assert.equal(transformed.pinned, true);
  assert.equal(transformed.pinnedPosition, 1);
  assert.equal(transformed.readme.present, true);
  assert.equal(transformed.readme.size, 1800);
  assert.deepEqual(transformed.topics, ["fastapi", "postgresql", "validation"]);
});

test("repository transformation preserves true, false, and unavailable fork metadata", () => {
  assert.equal(transformRepository(createRepository({ fork: true }), null).fork, true);
  assert.equal(transformRepository(createRepository({ fork: false }), null).fork, false);
  assert.equal(transformRepository(createRepository({ fork: undefined }), null).fork, null);
});

test("fork status does not change repository presentation scoring", () => {
  const supplemental = {
    pinnedRepositories: [],
    readmes: { "transaction-validator": { present: true, size: 1800 } },
  };
  const original = scoreRepository(transformRepository(createRepository({ fork: false }), supplemental), EVALUATION_DATE);
  const fork = scoreRepository(transformRepository(createRepository({ fork: true }), supplemental), EVALUATION_DATE);

  // Candidacy reads fork status; scoring never has and still does not.
  assert.equal(fork.score, original.score);
  assert.deepEqual(fork.categoryScores, original.categoryScores);
  assert.deepEqual(fork.findings, original.findings);
  assert.notEqual(fork.candidate.label, original.candidate.label);
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

/**
 * builds a scored audit from a repository fixture and optional README metadata
 * @param {Object} overrides repository properties to override
 * @param {Object|null} readme README metadata, or null to leave it unverified
 * @returns {Object} repository audit
 */
function auditRepository(overrides = {}, readme = { present: true, size: 1800, sections: { overview: true, installation: true, usage: true, examples: true, contributing: true }, hasCodeBlock: true, hasImage: true, headingCount: 7 }) {
  const raw = createRepository(overrides);
  const supplemental = readme === null
    ? { pinnedRepositories: [], readmes: {} }
    : { pinnedRepositories: [], readmes: { [raw.name]: readme } };
  return scoreRepository(transformRepository(raw, supplemental), EVALUATION_DATE);
}

test("a strong original repository is classified as a strong candidate", () => {
  const audit = auditRepository();

  assert.equal(audit.candidate.label, "strong");
  assert.equal(audit.candidate.title, "Strong candidate");
  assert.equal(audit.candidate.qualifier, null);
  assert.match(audit.candidate.explanation, /^Original repository with /);
});

test("an original repository with fixable gaps is worth polishing and the gaps are named", () => {
  const audit = auditRepository({ topics: [], license: null });

  assert.equal(audit.candidate.label, "polish");
  assert.match(audit.candidate.explanation, /adding topics/i);
  assert.match(audit.candidate.explanation, /adding a license/i);
  assert.match(audit.candidate.explanation, /would improve portfolio presentation/i);
});

test("a weak original repository is de-emphasized for reasons drawn from its evidence", () => {
  const audit = auditRepository(
    { description: null, topics: [], license: null, homepage: null },
    { present: false, size: null }
  );

  assert.equal(audit.candidate.label, "deemphasize");
  assert.equal(audit.candidate.title, "De-emphasize");
  assert.match(audit.candidate.explanation, /it has no README/i);
  assert.match(audit.candidate.explanation, /it has no description/i);
});

test("candidacy is not a restatement of the score band", () => {
  // A fork can outscore an original repository and still be the weaker candidate,
  // which is the whole reason candidacy exists as a separate judgment.
  const fork = auditRepository({ fork: true });
  const original = auditRepository({ topics: [], license: null }, { present: true, size: 180 });

  assert.ok(fork.score > original.score, `expected the fork to outscore the original, received ${fork.score} and ${original.score}`);
  assert.equal(fork.candidate.label, "polish");
  assert.equal(original.candidate.label, "polish");

  // And two repositories sharing a label need not share a score band.
  assert.ok(Math.abs(fork.score - original.score) > 10);
});

test("falsification: a polished fork never becomes a strong candidate on presentation alone", () => {
  const audit = auditRepository({ fork: true });

  assert.equal(audit.score, 100, "the fork is deliberately built to score at the top of the range");
  assert.notEqual(audit.candidate.label, "strong");
  assert.match(audit.candidate.explanation, /GitHub identifies this repository as a fork/);
  assert.match(audit.candidate.explanation, /cannot determine how much of the implementation belongs to the profile owner/);
  // It must not claim the owner contributed nothing, and must not call forks bad.
  assert.doesNotMatch(audit.candidate.explanation, /did not write|no original work|forks are/i);
});

test("falsification: an archived, well-presented repository never becomes a strong candidate", () => {
  const audit = auditRepository({ archived: true });

  assert.ok(audit.score >= 90, `expected a high presentation score, received ${audit.score}`);
  assert.notEqual(audit.candidate.label, "strong");
  assert.match(audit.candidate.explanation, /archived/i);
  assert.match(audit.candidate.explanation, /weaker choice for prominent portfolio placement/i);
});

test("falsification: a strong private original repository can be a strong candidate", () => {
  const audit = auditRepository({ private: true, visibility: "private" });
  const published = auditRepository();

  assert.equal(audit.candidate.label, "strong");
  assert.equal(audit.score, published.score, "privacy must not change the presentation score");
  assert.match(audit.candidate.explanation, /if you intend to publish or showcase/i);
  // Candidacy may describe publishing as the user's choice; it never instructs it.
  assert.doesNotMatch(audit.candidate.explanation, /make (it|this) public|publish (it|this) now/i);
});

test("falsification: an unverified README is neutral and is never described as absent", () => {
  const unverified = auditRepository({}, null);
  const missing = auditRepository({}, { present: false, size: null });

  assert.equal(unverified.candidate.evidence.readmeState, "unverified");
  assert.notEqual(unverified.candidate.label, "deemphasize");
  assert.equal(unverified.candidate.qualifier, "Some metadata unavailable");
  assert.match(unverified.candidate.explanation, /could not verify README status/i);
  assert.doesNotMatch(unverified.candidate.explanation, /no README|missing README|without a README|adding a README/i);

  // Unknown must never be treated as the verified-absent case.
  assert.ok(!unverified.candidate.weaknesses.includes("readme"));
  assert.ok(missing.candidate.weaknesses.includes("readme"));
});

test("falsification: unavailable fork metadata is not read as confirmed original work", () => {
  const unknown = auditRepository({ fork: undefined });

  assert.equal(unknown.candidate.evidence.originality, "unknown");
  assert.notEqual(unknown.candidate.label, "strong");
  assert.equal(unknown.candidate.qualifier, "Some metadata unavailable");
  assert.match(unknown.candidate.explanation, /GitHub did not report fork status/);
  assert.doesNotMatch(unknown.candidate.explanation, /Original repository/);

  // Unknown is not a weakness either, so it cannot push toward De-emphasize.
  assert.ok(!unknown.candidate.weaknesses.includes("fork"));
});

test("an unusable update timestamp is recorded as unknown rather than as staleness", () => {
  const audit = auditRepository({ pushed_at: "not-a-date", updated_at: "not-a-date" });

  assert.equal(audit.candidate.evidence.maintenanceUnknown, true);
  assert.equal(audit.candidate.evidence.abandoned, false);
  assert.equal(audit.candidate.qualifier, "Some metadata unavailable");
  assert.match(audit.candidate.explanation, /could not verify .*update history/i);
  assert.doesNotMatch(audit.candidate.explanation, /has not been pushed to/i);
});

test("every explanation clause is backed by evidence that is actually true", () => {
  const cases = [
    auditRepository(),
    auditRepository({ fork: true }),
    auditRepository({ fork: undefined }),
    auditRepository({ archived: true }),
    auditRepository({ private: true }),
    auditRepository({ topics: [] }),
    auditRepository({ license: null }),
    auditRepository({ homepage: null }),
    auditRepository({ description: null }),
    auditRepository({ description: "Web app" }),
    auditRepository({ pushed_at: "2022-01-01T00:00:00Z", updated_at: "2022-01-01T00:00:00Z" }),
    auditRepository({ pushed_at: "2019-01-01T00:00:00Z", updated_at: "2019-01-01T00:00:00Z" }),
    auditRepository({}, null),
    auditRepository({}, { present: false, size: null }),
    auditRepository({}, { present: true, size: 180 }),
  ];

  // Each claim a sentence can make, paired with the evidence that must support it.
  const claims = [
    [/a thorough README/, (evidence) => evidence.readmeState === "comprehensive"],
    [/a verified README/, (evidence) => evidence.readmeState === "present"],
    [/adding a README/, (evidence) => evidence.readmeState === "missing"],
    [/it has no README/, (evidence) => evidence.readmeState === "missing"],
    [/expanding the short README/, (evidence) => evidence.readmeState === "short"],
    [/could not verify/, (evidence) => evidence.unknowns.length > 0],
    [/a linked demo/, (evidence) => evidence.homepage],
    [/adding topics/, (evidence) => evidence.topics === 0],
    [/adding a license/, (evidence) => !evidence.license],
    [/it has no description/, (evidence) => evidence.description === 0],
    [/is archived/, (evidence) => evidence.archived],
    [/has not been pushed to in more than three years/, (evidence) => evidence.abandoned],
    [/identifies this repository as a fork/, (evidence) => evidence.originality === "fork"],
    [/did not report fork status/, (evidence) => evidence.originality === "unknown"],
    [/^Original repository/, (evidence) => evidence.originality === "original"],
    [/publish or showcase/, (evidence) => evidence.private],
  ];

  for (const audit of cases) {
    const { explanation, evidence } = { ...audit.candidate, evidence: audit.candidate.evidence };
    for (const [pattern, supported] of claims) {
      if (!pattern.test(explanation)) continue;
      assert.ok(
        supported(evidence),
        `${audit.repository.name} claimed ${pattern} without supporting evidence:\n  ${explanation}\n  ${JSON.stringify(evidence)}`
      );
    }
  }
});

test("classification is deterministic and attaches without disturbing the score", () => {
  const repository = transformRepository(createRepository(), {
    pinnedRepositories: [],
    readmes: { "transaction-validator": { present: true, size: 1800 } },
  });
  const audit = scoreRepository(repository, EVALUATION_DATE);

  assert.deepEqual(scoreRepository(repository, EVALUATION_DATE), audit, "scoring must stay deterministic");
  assert.deepEqual(
    classifyPortfolioCandidate({ ...audit, candidate: undefined }),
    audit.candidate,
    "classification must depend only on the audit it is given"
  );
});

test("the scored surface still comes only from the category scorers", () => {
  // Requirement: adding candidacy changed no scoring. Rather than pinning magic
  // numbers, this rebuilds the score from the category functions candidacy never
  // touches, so a future edit that quietly folded candidacy into scoring fails.
  const cases = [
    [createRepository(), { present: true, size: 1800 }],
    [createRepository({ fork: true }), { present: true, size: 1800 }],
    [createRepository({ archived: true, topics: [], license: null }), { present: false, size: null }],
    [createRepository({ description: null, name: "test" }), null],
  ];

  for (const [raw, readme] of cases) {
    const supplemental = { pinnedRepositories: [], readmes: readme ? { [raw.name]: readme } : {} };
    const repository = transformRepository(raw, supplemental);
    const audit = scoreRepository(repository, EVALUATION_DATE);
    const name = scoreName(repository.name);
    const description = scoreDescription(repository.description, repository.archived);
    const readmeScore = scoreReadme(repository.readme, repository.archived);
    const discoverability = scoreDiscoverability(repository);
    const maintenance = scoreMaintenance(repository, EVALUATION_DATE);

    assert.deepEqual(audit.categoryScores, {
      presentation: name.score,
      descriptions: description.score,
      readme: readmeScore.score,
      discoverability: discoverability.score,
      maintenance: maintenance.score,
    }, `${raw.name} category scores drifted from the category scorers`);
    assert.deepEqual(audit.findings, [
      ...name.findings,
      ...description.findings,
      ...readmeScore.findings,
      ...discoverability.findings,
      ...maintenance.findings,
    ], `${raw.name} findings drifted from the category scorers`);
    assert.equal(audit.score, Math.max(0, Math.min(100, Math.round(
      name.score * 0.15 +
      description.score * 0.25 +
      readmeScore.score * 0.25 +
      discoverability.score * 0.2 +
      maintenance.score * 0.15
    ))), `${raw.name} overall score drifted from the documented weights`);
  }
});
