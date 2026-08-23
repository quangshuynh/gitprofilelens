const test = require("node:test");
const assert = require("node:assert/strict");
const { transformRepository } = require("../../audit.js");
const {
  buildProfile,
  buildRepository,
  comprehensiveReadme,
  missingReadme,
  shortReadme,
  solidReadme,
  sparseReadme,
} = require("./fixtures/builders.js");
const { CORPUS, getProfile } = require("./fixtures/index.js");
const {
  EVALUATION_DATE,
  auditProfile,
  recommendationKey,
  recommendationKeys,
  repositoryScores,
} = require("./harness.js");

test("fixture repositories expand into the GitHub REST shape the scorer consumes", () => {
  const repository = buildRepository("example", {
    name: "ledger-sync",
    note: "Covers every optional field.",
    description: "Reconciles payouts against a ledger",
    language: "TypeScript",
    topics: ["stripe", "postgres"],
    license: "MIT",
    homepage: "https://ledger-sync.example.dev",
    createdAt: "2024-02-11",
    pushedAt: "2026-07-28",
  });
  const normalized = transformRepository(repository, null);

  assert.equal(repository.full_name, "example/ledger-sync");
  assert.equal(repository.html_url, "https://github.com/example/ledger-sync");
  assert.deepEqual(repository.license, { spdx_id: "MIT" });
  assert.equal(repository.created_at, "2024-02-11T00:00:00Z");
  assert.equal(repository.pushed_at, "2026-07-28T00:00:00Z");
  assert.equal(repository.updated_at, "2026-07-28T00:00:00Z");
  assert.equal(normalized.license, "MIT");
  assert.equal(normalized.visibility, "public");
  assert.equal("note" in repository, false);
});

test("fixture repositories default every field a persona does not state", () => {
  const repository = buildRepository("example", {
    name: "scripts",
    note: "States nothing beyond the minimum.",
    pushedAt: "2026-08-05",
  });

  assert.equal(repository.description, null);
  assert.equal(repository.homepage, null);
  assert.equal(repository.language, null);
  assert.deepEqual(repository.topics, []);
  assert.equal(repository.license, null);
  assert.equal(repository.archived, false);
  assert.equal(repository.fork, false);
  assert.equal(repository.private, false);
  assert.equal(repository.created_at, "2026-08-05T00:00:00Z");
});

test("profile fixtures lift pins in declaration order and READMEs by repository name", () => {
  const profile = buildProfile({
    id: "example-profile",
    summary: "Two pins declared in order plus one repository with no README data.",
    repositories: [
      { name: "first-pin", note: "Pinned first.", pushedAt: "2026-08-01", pinned: true, readme: comprehensiveReadme() },
      { name: "unverified", note: "No README metadata was returned for this repository.", pushedAt: "2026-08-01" },
      { name: "second-pin", note: "Pinned second.", pushedAt: "2026-08-01", pinned: true, readme: missingReadme() },
    ],
  });
  const normalized = profile.repositories.map((repository) => transformRepository(repository, profile.supplemental));

  assert.equal(profile.username, "example-profile");
  assert.deepEqual(profile.supplemental.pinnedRepositories, ["first-pin", "second-pin"]);
  assert.deepEqual(Object.keys(profile.supplemental.readmes), ["first-pin", "second-pin"]);
  assert.equal(normalized[0].pinnedPosition, 0);
  assert.equal(normalized[2].pinnedPosition, 1);
  assert.equal(normalized[1].pinned, false);
  assert.equal(normalized[1].readme.present, null);
});

test("README presets keep their documented scores so personas stay readable", () => {
  const { scoreReadme } = require("../../audit.js");

  assert.equal(scoreReadme(comprehensiveReadme()).score, 100);
  assert.equal(scoreReadme(solidReadme()).score, 90);
  assert.equal(scoreReadme(sparseReadme()).score, 50);
  assert.equal(scoreReadme(shortReadme()).score, 55);
  assert.equal(scoreReadme(missingReadme()).score, 10);
});

test("fixture builders reject malformed personas instead of scoring them", () => {
  const repository = { name: "one", note: "Valid.", pushedAt: "2026-08-01" };

  assert.throws(() => buildRepository("example", { ...repository, licence: "MIT" }), /Unknown repository fixture field "licence"/);
  assert.throws(() => buildRepository("example", { name: "one", pushedAt: "2026-08-01" }), /requires a note/);
  assert.throws(() => buildRepository("example", { name: "one", note: "Valid." }), /requires a pushedAt/);
  assert.throws(() => buildProfile({ id: "x", repositories: [] }), /requires a summary/);
  assert.throws(() => buildProfile({
    id: "x",
    summary: "Duplicate repository names.",
    repositories: [repository, { ...repository }],
  }), /declares one twice/);
  assert.throws(() => buildProfile({
    id: "x",
    summary: "Seven pinned repositories.",
    repositories: Array.from({ length: 7 }, (value, index) => ({
      name: `repo-${index}`, note: "Pinned.", pushedAt: "2026-08-01", pinned: true,
    })),
  }), /GitHub allows 6/);
  assert.throws(() => buildProfile({
    id: "x",
    summary: "Declares README data an unavailable metadata endpoint could not return.",
    supplementalMetadata: false,
    repositories: [{ ...repository, readme: missingReadme() }],
  }), /could not return/);
  assert.throws(() => buildRepository("example", {
    name: "one", note: "No commits and no creation date.", pushedAt: null,
  }), /requires a createdAt date/);
  assert.throws(() => buildProfile({
    id: "x", summary: "Uses a profile field that does not exist.", repositories: [], supplemental: null,
  }), /Unknown profile fixture field "supplemental"/);
});

test("an unavailable metadata endpoint produces no supplemental data at all", () => {
  const profile = buildProfile({
    id: "example-profile",
    summary: "Audited where README and pin metadata could not be fetched.",
    supplementalMetadata: false,
    repositories: [{ name: "one", note: "Public REST data only.", pushedAt: "2026-08-01" }],
  });
  const normalized = transformRepository(profile.repositories[0], profile.supplemental);

  assert.equal(profile.supplemental, null);
  assert.equal(normalized.pinned, null);
  assert.equal(normalized.readme.present, null);
});

test("corpus scoring is deterministic and driven by the injected evaluation date", () => {
  const profile = getProfile("polished-professional");
  const first = auditProfile(profile);
  const second = auditProfile(profile);
  const muchLater = auditProfile(profile, new Date("2031-08-21T00:00:00Z"));

  assert.deepEqual(first.profile, second.profile);
  assert.deepEqual(recommendationKeys(first), recommendationKeys(second));
  assert.equal(first.profile.categories.maintenance, 100);
  assert.ok(muchLater.profile.categories.maintenance < first.profile.categories.maintenance);
  assert.equal(EVALUATION_DATE.toISOString(), "2026-08-21T00:00:00.000Z");
});

test("recommendation keys stay distinct when two actions share their opening words", () => {
  const audit = auditProfile(getProfile("beginner-account")).audits
    .find((candidate) => candidate.repository.name === "My_First_Website");
  const nameFindings = audit.findings.filter((finding) => finding.category === "Repository presentation");
  const keys = nameFindings.map(recommendationKey);

  assert.equal(nameFindings.length, 2);
  assert.equal(new Set(keys).size, 2);
  for (const key of keys) assert.match(key, /^repository-presentation:consider-lowercase-kebab-case-for-[\da-f]{4}$/);
});

test("every corpus profile documents itself and produces bounded scores", () => {
  const identifiers = new Set();

  for (const profile of CORPUS) {
    assert.equal(identifiers.has(profile.id), false, `${profile.id} is declared twice`);
    identifiers.add(profile.id);
    assert.ok(profile.summary.length > 40, `${profile.id} needs a summary explaining its expected outcome`);
    // empty-account is the one profile that intentionally owns nothing.
    assert.ok(
      profile.repositories.length > 0 || profile.id === "empty-account",
      `${profile.id} built no repositories, which is almost certainly a fixture mistake`
    );

    for (const name of profile.supplemental?.pinnedRepositories ?? []) {
      assert.ok(
        profile.repositories.some((repository) => repository.name === name),
        `${profile.id} pins ${name}, which it does not own`
      );
    }

    const result = auditProfile(profile);
    assert.ok(Number.isInteger(result.profile.overall));
    assert.ok(result.profile.overall >= 0 && result.profile.overall <= 100);
    for (const [category, score] of Object.entries(result.profile.categories)) {
      assert.ok(score >= 0 && score <= 100, `${profile.id} ${category} score ${score} is out of range`);
    }
    for (const [name, score] of Object.entries(repositoryScores(result))) {
      assert.ok(score >= 0 && score <= 100, `${profile.id} ${name} score ${score} is out of range`);
    }
    assert.ok(result.recommendations.length <= 5, `${profile.id} exceeded the five-recommendation cap`);
  }
});
