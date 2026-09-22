/**
 * Pinned repository optimizer rules.
 *
 * These tests pin the optimizer against constructed profiles built to trigger one
 * rule at a time. `tests/scoring/pinned-sets.test.js` pins the same rules against
 * the evaluation corpus, where the evidence comes from coherent synthetic
 * accounts instead.
 *
 * Scores are asserted as orderings rather than as exact constants wherever a case
 * only needs one repository to outscore another. A scoring change may legitimately
 * move a fixture from 98 to 97; it may not make the optimizer prefer a fork.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreRepository, transformRepository } = require("../audit.js");
const { COMPARABLE_SCORE_BAND, optimizePinnedSet } = require("../pinned-optimizer.js");
const {
  comprehensiveReadme,
  missingReadme,
  shortReadme,
  solidReadme,
} = require("./scoring/fixtures/builders.js");

/** Frozen evaluation date, matching the scoring corpus. */
const NOW = new Date("2026-08-21T00:00:00Z");

/** A description long enough, specific enough, and capitalized: scores 100. */
const CLEAR_DESCRIPTION = "Deterministic tooling that turns repository metadata into reviewable reports";

/** A description under thirty characters: scores 75, still above the candidacy gate. */
const TERSE_DESCRIPTION = "Reviewable audit reports";

/**
 * builds the GitHub REST payload for one constructed repository
 * @param {Object} fixture compact repository fixture
 * @returns {Object} GitHub REST repository payload
 */
function buildPayload(fixture) {
  return {
    name: fixture.name,
    full_name: `example/${fixture.name}`,
    description: "description" in fixture ? fixture.description : CLEAR_DESCRIPTION,
    html_url: `https://github.com/example/${fixture.name}`,
    homepage: fixture.homepage ?? null,
    language: "language" in fixture ? fixture.language : "TypeScript",
    topics: fixture.topics ?? ["tooling", `topic-${fixture.name}`],
    license: fixture.license === null ? null : { spdx_id: fixture.license ?? "MIT" },
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    archived: fixture.archived ?? false,
    fork: "fork" in fixture ? fixture.fork : false,
    private: fixture.private ?? false,
    visibility: fixture.private ? "private" : "public",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: fixture.pushedAt ?? "2026-08-01T00:00:00Z",
    pushed_at: fixture.pushedAt ?? "2026-08-01T00:00:00Z",
  };
}

/**
 * builds repository audits for a constructed profile
 *
 * The fixtures run through `transformRepository` so that normalization, including
 * the tri-state pin flag, stays inside the tested surface.
 *
 * @param {Array<Object>} fixtures compact repository fixtures
 * @param {Object} options pinned repository names, or metadata availability
 * @returns {Array<Object>} repository audits
 */
function buildAudits(fixtures, options = {}) {
  const supplemental = options.metadataAvailable === false ? null : {
    pinnedRepositories: options.pinned ?? [],
    readmes: Object.fromEntries(fixtures.map((fixture) => [
      fixture.name,
      fixture.readme ?? comprehensiveReadme(),
    ])),
  };

  return fixtures.map((fixture) =>
    scoreRepository(transformRepository(buildPayload(fixture), supplemental), NOW));
}

/**
 * lists the recommended repository names
 * @param {Object} result optimizer result
 * @returns {Array<string>} recommended names in set order
 */
function names(result) {
  return result.recommended.map((entry) => entry.name);
}

/**
 * finds one recommended repository
 * @param {Object} result optimizer result
 * @param {string} name repository name
 * @returns {Object|undefined} recommended entry
 */
function recommendationFor(result, name) {
  return result.recommended.find((entry) => entry.name === name);
}

/**
 * describes a result for an assertion failure message
 * @param {Object} result optimizer result
 * @returns {string} readable description
 */
function describe(result) {
  const lines = result.recommended.map((entry) =>
    `  ${entry.position}. ${entry.name} [${entry.title}] score ${entry.score}\n` +
    entry.reasons.map((reason) => `       - ${reason}`).join("\n"));
  return `recommended set:\n${lines.join("\n") || "  (empty)"}`;
}

/**
 * finds one change entry by repository name
 * @param {Object} result optimizer result
 * @param {string} name repository name
 * @returns {Object|undefined} change entry
 */
function changeFor(result, name) {
  return result.changes.find((change) => change.repository === name);
}

/**
 * reads one repository's presentation score out of a built audit list
 * @param {Array<Object>} audits repository audits
 * @param {string} name repository name
 * @returns {number} presentation score
 */
function scoreOf(audits, name) {
  return audits.find((audit) => audit.repository.name === name).score;
}

/** Builds a Strong candidate, optionally overriding any fixture field. */
function strongFixture(name, overrides = {}) {
  return { name, readme: comprehensiveReadme(), ...overrides };
}

test("GitHub's documented pin limit is the default maximum", () => {
  const { MAXIMUM_PINNED_REPOSITORIES, getPinnedLimit } = require("../pinned-optimizer.js");
  assert.equal(MAXIMUM_PINNED_REPOSITORIES, 6);
  assert.equal(getPinnedLimit(), 6);
  assert.equal(optimizePinnedSet([]).limit, 6);
});

test("eligibility: a numeric score alone does not make a repository eligible", () => {
  const audits = buildAudits([
    // De-emphasize: a confirmed fork that is also archived carries two weaknesses,
    // while its presentation metadata is complete enough to score at the top.
    strongFixture("polished-retired-fork", { fork: true, archived: true }),
    // Worth polishing, but a missing README is a high-priority finding.
    { name: "undocumented", readme: missingReadme() },
    // Nothing verified that a visitor could read before opening the repository.
    { name: "unreadable", description: null, readme: { present: null, size: null } },
    strongFixture("eligible-project"),
  ]);
  const result = optimizePinnedSet(audits);

  assert.deepEqual(names(result), ["eligible-project"], describe(result));
  assert.equal(result.eligibleCount, 1);

  const reasons = Object.fromEntries(result.excluded.map((group) =>
    [group.reason, group.repositories]));
  assert.deepEqual(reasons.deemphasize, ["polished-retired-fork"]);
  assert.deepEqual(reasons.highFindings, ["undocumented"]);
  assert.deepEqual(reasons.unreadable, ["unreadable"]);

  // The excluded repository outscores the recommended one, which is the point.
  const excludedAudit = audits.find((audit) => audit.repository.name === "polished-retired-fork");
  const includedAudit = audits.find((audit) => audit.repository.name === "eligible-project");
  assert.ok(excludedAudit.score >= includedAudit.score,
    `expected the excluded repository to score at least as well, received ${excludedAudit.score} and ${includedAudit.score}`);
});

test("falsification: a de-emphasized repository is not selected however well it scores", () => {
  const audits = buildAudits([
    strongFixture("retired-fork", { fork: true, archived: true }),
    { name: "modest-original", readme: shortReadme(), description: TERSE_DESCRIPTION },
  ]);
  const result = optimizePinnedSet(audits);
  const retired = audits.find((audit) => audit.repository.name === "retired-fork");
  const modest = audits.find((audit) => audit.repository.name === "modest-original");

  assert.equal(retired.candidate.label, "deemphasize");
  assert.ok(retired.score > modest.score, `expected ${retired.score} to exceed ${modest.score}`);
  assert.deepEqual(names(result), ["modest-original"], describe(result));
  assert.equal(result.recommended.length, 1, "it recommends fewer rather than filling the set");
});

test("falsification: a high-scoring fork does not displace a confirmed original", () => {
  const audits = buildAudits([
    strongFixture("polished-fork", { fork: true }),
    { name: "original-project", readme: solidReadme(), description: TERSE_DESCRIPTION },
  ]);
  const fork = audits.find((audit) => audit.repository.name === "polished-fork");
  const original = audits.find((audit) => audit.repository.name === "original-project");
  const result = optimizePinnedSet(audits, { limit: 1 });

  assert.ok(fork.score > original.score, `expected ${fork.score} to exceed ${original.score}`);
  assert.equal(original.candidate.label, "strong");
  assert.deepEqual(names(result), ["original-project"], describe(result));

  // The fork is still eligible, and is never described as work the owner did not do.
  const full = optimizePinnedSet(audits);
  const forkEntry = recommendationFor(full, "polished-fork");
  assert.ok(forkEntry, describe(full));
  assert.ok(forkEntry.reasons.some((reason) =>
    reason.includes("cannot determine how much of the implementation belongs to the profile owner")));
  assert.ok(!forkEntry.reasons.some((reason) => /did no work|no original work/i.test(reason)));
});

test("falsification: a high-scoring archived repository does not displace an active one", () => {
  const audits = buildAudits([
    strongFixture("retired-flagship", { archived: true }),
    { name: "active-project", readme: solidReadme(), description: TERSE_DESCRIPTION },
  ]);
  const archived = audits.find((audit) => audit.repository.name === "retired-flagship");
  const active = audits.find((audit) => audit.repository.name === "active-project");
  const result = optimizePinnedSet(audits, { limit: 1 });

  assert.ok(archived.score > active.score, `expected ${archived.score} to exceed ${active.score}`);
  assert.deepEqual(names(result), ["active-project"], describe(result));

  // Archiving changes where the repository ranks, never what it scores.
  assert.equal(archived.categoryScores.maintenance, 85);
  const full = optimizePinnedSet(audits);
  assert.ok(recommendationFor(full, "retired-flagship").reasons.some((reason) =>
    reason.includes("recommended below comparable active repositories")));
});

test("breadth decides between repositories presenting comparably well", () => {
  const audits = buildAudits([
    ...["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map((name) =>
      strongFixture(name, { language: "TypeScript", homepage: "https://example.dev" })),
    // Lower scoring, but close enough to read as comparable evidence, and the only
    // repository representing its language.
    { name: "zulu", language: "Python", readme: solidReadme() },
  ]);
  const result = optimizePinnedSet(audits);
  const gap = scoreOf(audits, "alpha") - scoreOf(audits, "zulu");

  assert.ok(gap > 0 && gap <= COMPARABLE_SCORE_BAND,
    `this case needs a positive gap inside the band, received ${gap}`);

  assert.equal(result.recommended.length, 6);
  assert.equal(names(result)[1], "zulu", describe(result));
  assert.ok(recommendationFor(result, "zulu").reasons.some((reason) =>
    reason === "Adds Python, which no other recommended repository represents."), describe(result));
  assert.deepEqual(result.diversity.languages, ["TypeScript", "Python"]);
});

test("falsification: a unique language does not override markedly stronger presentation", () => {
  const audits = buildAudits([
    ...["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map((name) =>
      strongFixture(name, { language: "TypeScript", homepage: "https://example.dev" })),
    // The only repository representing its language, but it presents clearly less
    // well than every repository it would displace.
    { name: "zulu", language: "Python", readme: solidReadme(), description: TERSE_DESCRIPTION },
  ]);
  const result = optimizePinnedSet(audits);
  const zulu = scoreOf(audits, "zulu");

  for (const audit of audits) {
    if (audit.repository.name === "zulu") continue;
    assert.ok(audit.score - zulu > COMPARABLE_SCORE_BAND,
      `this case needs a gap outside the band, received ${audit.score - zulu}`);
  }

  // Language uniqueness is not by itself a portfolio-quality claim GitProfileLens
  // can support, so it does not buy a place ahead of stronger presentation evidence.
  assert.ok(!names(result).includes("zulu"), describe(result));
  assert.deepEqual(names(result).sort(),
    ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"], describe(result));
});

test("the comparable band decides at its exact boundary", () => {
  // Exactly at the band edge the two still read as comparable, so breadth decides.
  const atEdge = buildAudits([
    ...["alpha", "bravo"].map((name) => strongFixture(name, { language: "Python" })),
    { name: "zulu", language: "TypeScript", readme: solidReadme() },
  ]);
  const edgeGap = scoreOf(atEdge, "alpha") - scoreOf(atEdge, "zulu");
  assert.equal(edgeGap, COMPARABLE_SCORE_BAND,
    `fixture drift: this case needs a gap of exactly the band, received ${edgeGap}`);
  assert.equal(names(optimizePinnedSet(atEdge, { limit: 2 }))[1], "zulu",
    describe(optimizePinnedSet(atEdge, { limit: 2 })));

  // One point further apart they do not, so presentation evidence decides alone.
  const beyondEdge = buildAudits([
    ...["alpha", "bravo"].map((name) => strongFixture(name, { language: "TypeScript" })),
    { name: "zulu", language: "Python", readme: solidReadme(), description: TERSE_DESCRIPTION },
  ]);
  const beyondGap = scoreOf(beyondEdge, "alpha") - scoreOf(beyondEdge, "zulu");
  assert.equal(beyondGap, COMPARABLE_SCORE_BAND + 1,
    `fixture drift: this case needs a gap one point past the band, received ${beyondGap}`);
  assert.equal(names(optimizePinnedSet(beyondEdge, { limit: 2 }))[1], "bravo",
    describe(optimizePinnedSet(beyondEdge, { limit: 2 })));
});

test("breadth never overrides candidacy, originality, or archive status", () => {
  const audits = buildAudits([
    ...["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map((name) =>
      strongFixture(name, { language: "TypeScript" })),
    strongFixture("borrowed", { language: "Rust", fork: true }),
    strongFixture("retired", { language: "Ruby", archived: true }),
    { name: "rough", language: "Perl", readme: shortReadme() },
  ]);
  const result = optimizePinnedSet(audits);

  // All three carry a language no other repository has, and all three lose to six
  // Strong, original, active TypeScript repositories.
  assert.deepEqual(names(result).sort(),
    ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"], describe(result));
});

test("a Worth polishing repository may take the final slot when its gaps are minor", () => {
  const audits = buildAudits([
    ...["alpha", "bravo", "charlie", "delta", "echo"].map((name) =>
      strongFixture(name, { language: "TypeScript" })),
    { name: "shell-tools", language: "Shell", readme: shortReadme() },
  ]);
  const result = optimizePinnedSet(audits);
  const entry = recommendationFor(result, "shell-tools");

  assert.equal(result.recommended.length, 6, describe(result));
  assert.ok(entry, describe(result));
  assert.equal(entry.label, "polish");
  assert.equal(entry.position, 6, `expected every Strong candidate first.\n${describe(result)}`);
  assert.deepEqual(entry.gaps, ["expanding the short README"]);
  assert.ok(entry.reasons.some((reason) =>
    reason === "Polish before featuring: expanding the short README."), describe(result));
  assert.ok(entry.reasons.some((reason) => reason.startsWith("Adds Shell,")), describe(result));
});

test("falsification: a private Strong candidate is recognized but never called publicly pinnable", () => {
  const audits = buildAudits([
    strongFixture("internal-platform", { private: true }),
    { name: "public-tool", readme: solidReadme(), description: TERSE_DESCRIPTION },
  ]);
  const internal = audits.find((audit) => audit.repository.name === "internal-platform");
  const result = optimizePinnedSet(audits);

  // Privacy is not a quality judgment: the candidacy label is untouched.
  assert.equal(internal.candidate.label, "strong");
  assert.ok(internal.score > audits[1].score);

  assert.deepEqual(names(result), ["public-tool"], describe(result));
  assert.deepEqual(result.privateCandidates.map((entry) => entry.name), ["internal-platform"]);
  assert.equal(result.privateCandidates[0].title, "Strong candidate");

  const excluded = result.excluded.find((group) => group.reason === "private");
  assert.deepEqual(excluded.repositories, ["internal-platform"]);
  assert.match(excluded.explanation, /cannot be featured on a public GitHub profile/);
  assert.doesNotMatch(excluded.explanation, /make it public|publish it/i);
});

test("falsification: unknown fork status is claimed as neither original nor forked", () => {
  const audits = buildAudits([
    strongFixture("unreported", { fork: null }),
    strongFixture("confirmed-original"),
    strongFixture("confirmed-fork", { fork: true }),
  ]);
  const result = optimizePinnedSet(audits);
  const entry = recommendationFor(result, "unreported");

  assert.deepEqual(names(result), ["confirmed-original", "unreported", "confirmed-fork"], describe(result));
  assert.equal(entry.originality, "unknown");
  assert.ok(entry.reasons.some((reason) =>
    reason === "GitHub did not report fork status, so GitProfileLens cannot record this as confirmed original work."),
    describe(result));
  assert.ok(!entry.reasons.some((reason) => /confirmed original work, active/.test(reason)), describe(result));
  assert.ok(!entry.reasons.some((reason) => /identifies this repository as a fork/.test(reason)), describe(result));
});

test("unverified evidence is reported rather than converted into a weakness", () => {
  const audits = buildAudits([
    { name: "unverified-readme", readme: { present: null, size: null } },
  ]);
  const result = optimizePinnedSet(audits);
  const entry = recommendationFor(result, "unverified-readme");

  assert.ok(entry, describe(result));
  assert.equal(entry.qualifier, "Some metadata unavailable");
  assert.ok(entry.reasons.some((reason) =>
    reason === "GitProfileLens could not verify README status for this repository."), describe(result));
  assert.ok(!entry.reasons.some((reason) => /no README|missing README/i.test(reason)), describe(result));
});

test("a repository with no reported language earns no breadth claim and no penalty", () => {
  const audits = buildAudits([
    strongFixture("typed", { language: "TypeScript" }),
    strongFixture("untyped", { language: null }),
    strongFixture("also-typed", { language: "TypeScript" }),
  ]);
  const result = optimizePinnedSet(audits);
  const entry = recommendationFor(result, "untyped");

  // Every repository is selected, so ordering is the only thing to check: an
  // unreported language ranks with a repeated one, never above a verified new one.
  assert.equal(result.recommended.length, 3);
  assert.ok(entry.reasons.some((reason) =>
    reason === "GitHub did not report a primary language, so GitProfileLens cannot say whether it widens the set."),
    describe(result));
  assert.ok(!entry.reasons.some((reason) => reason.startsWith("Adds ")), describe(result));
  assert.equal(result.diversity.unknownLanguage, 1);
});

test("shared topics mark two repositories as one project story", () => {
  const audits = buildAudits([
    strongFixture("parser", { language: "Rust", topics: ["parser", "compiler", "rust"] }),
    strongFixture("parser-cli", { language: "Rust", topics: ["parser", "compiler", "cli"] }),
  ]);
  const result = optimizePinnedSet(audits);
  const second = result.recommended[1];

  assert.ok(second.reasons.some((reason) =>
    reason.startsWith("Shares the topics parser and compiler with")), describe(result));
  assert.equal(result.diversity.sharedTopicPairs, 1);
});

test("fewer than the maximum is recommended rather than padded", () => {
  const audits = buildAudits([
    strongFixture("alpha"),
    { name: "bravo", readme: shortReadme() },
    { name: "weak", description: null, readme: missingReadme() },
    { name: "retired-fork", fork: true, archived: true, readme: comprehensiveReadme() },
  ]);
  const result = optimizePinnedSet(audits);

  assert.equal(result.recommended.length, 2, describe(result));
  assert.match(result.shortfall, /found 2 repositories that currently meet the recommendation criteria/);
  assert.match(result.shortfall, /does not recommend filling the remaining slots/);
});

test("an empty or wholly ineligible profile says so instead of recommending nothing quietly", () => {
  const empty = optimizePinnedSet([]);
  assert.deepEqual(empty.recommended, []);
  assert.equal(empty.shortfall, "There are no audited repositories to recommend.");

  const ineligible = optimizePinnedSet(buildAudits([
    { name: "blank", description: null, readme: missingReadme() },
  ]));
  assert.deepEqual(ineligible.recommended, []);
  assert.match(ineligible.shortfall, /No audited repository currently meets the recommendation criteria/);
});

test("deterministic tie-breaking: equal evidence resolves by repository name, stably", () => {
  const fixtures = [
    strongFixture("zeta", { language: "Go", topics: ["shared-topic"] }),
    strongFixture("alpha", { language: "Go", topics: ["shared-topic"] }),
    strongFixture("mike", { language: "Go", topics: ["shared-topic"] }),
  ];
  const forward = optimizePinnedSet(buildAudits(fixtures), { limit: 2 });
  const reversed = optimizePinnedSet(buildAudits([...fixtures].reverse()), { limit: 2 });
  const repeated = optimizePinnedSet(buildAudits(fixtures), { limit: 2 });

  assert.deepEqual(names(forward), ["alpha", "mike"], describe(forward));
  assert.deepEqual(names(reversed), names(forward), "API ordering changed the recommendation");
  assert.deepEqual(names(repeated), names(forward), "repeated runs disagreed");
  assert.deepEqual(repeated.recommended, forward.recommended, "repeated runs produced different evidence");
});

test("current versus recommended: keep, polish first, consider adding, consider replacing", () => {
  const audits = buildAudits([
    strongFixture("kept-strong", { language: "Python" }),
    { name: "kept-polish", language: "Go", readme: shortReadme() },
    strongFixture("unpinned-addition", { language: "Rust" }),
    // Pinned, but de-emphasized: no README and no description.
    { name: "outgoing", description: null, readme: missingReadme() },
  ], { pinned: ["kept-strong", "kept-polish", "outgoing"] });
  const result = optimizePinnedSet(audits);

  assert.equal(result.currentPinsKnown, true);
  assert.deepEqual(result.currentPinned, ["kept-strong", "kept-polish", "outgoing"]);
  assert.equal(result.alreadyOptimal, false);

  assert.equal(changeFor(result, "kept-strong").action, "keep");
  assert.match(changeFor(result, "kept-strong").explanation, /classified Strong candidate/);

  const polish = changeFor(result, "kept-polish");
  assert.equal(polish.action, "polish");
  assert.equal(polish.title, "Polish first");
  assert.match(polish.explanation, /Expanding the short README would improve how it presents/);

  const replacement = changeFor(result, "outgoing");
  assert.equal(replacement.action, "replace");
  assert.equal(replacement.title, "Consider replacing");
  assert.equal(replacement.replacement, "unpinned-addition");
  assert.match(replacement.explanation,
    /unpinned-addition is classified Strong candidate and adds Rust, which no other recommended repository represents, while outgoing did not meet the recommendation criteria/);
});

test("a replacement explanation states the difference rather than asserting one is better", () => {
  const audits = buildAudits([
    strongFixture("incoming", { language: "Go" }),
    { name: "outgoing", description: null, readme: missingReadme() },
  ], { pinned: ["outgoing"] });
  const change = changeFor(optimizePinnedSet(audits), "outgoing");

  assert.match(change.explanation, /classified Strong candidate/);
  assert.match(change.explanation, /did not meet the recommendation criteria/);
  assert.doesNotMatch(change.explanation, /\bis better\b|\bworse\b|\bbad\b|remove immediately/i);
});

test("consider adding is used when there is nothing to replace", () => {
  const audits = buildAudits([
    strongFixture("pinned-one"),
    strongFixture("unpinned-two", { language: "Go" }),
  ], { pinned: ["pinned-one"] });
  const result = optimizePinnedSet(audits);

  assert.equal(changeFor(result, "pinned-one").action, "keep");
  const addition = changeFor(result, "unpinned-two");
  assert.equal(addition.action, "add");
  assert.equal(addition.title, "Consider adding");
  assert.match(addition.explanation, /is in the recommended set and is not currently pinned/);
});

test("a pinned repository with no suggested replacement is still explained", () => {
  const audits = buildAudits([
    { name: "outgoing", description: null, readme: missingReadme() },
  ], { pinned: ["outgoing"] });
  const change = changeFor(optimizePinnedSet(audits), "outgoing");

  assert.equal(change.action, "replace");
  assert.equal(change.replacement, null);
  assert.match(change.explanation, /no comparable repository to suggest in its place/);
});

test("already optimal: matching pins produce no manufactured changes", () => {
  const audits = buildAudits([
    strongFixture("alpha"),
    strongFixture("bravo", { language: "Go" }),
  ], { pinned: ["bravo", "alpha"] });
  const result = optimizePinnedSet(audits);

  assert.equal(result.alreadyOptimal, true, describe(result));
  assert.equal(result.changes.every((change) => change.action === "keep"), true,
    `expected only keep actions, received ${result.changes.map((change) => change.action).join(", ")}`);
  assert.equal(result.changes.filter((change) => ["add", "replace"].includes(change.action)).length, 0);
});

test("pin order is not treated as a difference", () => {
  const fixtures = [strongFixture("alpha"), strongFixture("bravo", { language: "Go" })];
  const first = optimizePinnedSet(buildAudits(fixtures, { pinned: ["alpha", "bravo"] }));
  const second = optimizePinnedSet(buildAudits(fixtures, { pinned: ["bravo", "alpha"] }));

  assert.equal(first.alreadyOptimal, true);
  assert.equal(second.alreadyOptimal, true);
  assert.deepEqual(names(first), names(second));
});

test("unverified pin metadata is reported as unknown, never as an empty pin set", () => {
  const audits = buildAudits([strongFixture("alpha")], { metadataAvailable: false });
  const result = optimizePinnedSet(audits);

  assert.equal(audits[0].repository.pinned, null);
  assert.equal(result.currentPinsKnown, false);
  assert.deepEqual(result.currentPinned, []);
  assert.deepEqual(result.changes, []);
  assert.equal(result.alreadyOptimal, false);
  assert.deepEqual(names(result), ["alpha"], describe(result));
});

test("no circular dependency: pin state cannot change which repositories are recommended", () => {
  const fixtures = [
    strongFixture("alpha"),
    strongFixture("bravo", { language: "Go" }),
    strongFixture("charlie", { language: "Rust" }),
  ];
  const unpinned = optimizePinnedSet(buildAudits(fixtures), { limit: 2 });
  const pinnedLast = optimizePinnedSet(buildAudits(fixtures, { pinned: ["charlie"] }), { limit: 2 });
  const pinnedAll = optimizePinnedSet(buildAudits(fixtures, { pinned: ["charlie", "bravo", "alpha"] }), { limit: 2 });

  assert.deepEqual(names(pinnedLast), names(unpinned), "pinning a repository changed the recommendation");
  assert.deepEqual(names(pinnedAll), names(unpinned), "pinning every repository changed the recommendation");
  for (const result of [pinnedLast, pinnedAll]) {
    for (const entry of result.recommended) {
      assert.ok(!entry.reasons.some((reason) => /pinned/i.test(reason)),
        `selection reasons cite pin state: ${entry.reasons.join(" ")}`);
    }
  }
});

test("running the optimizer changes no repository score, category score, finding, or candidacy", () => {
  const fixtures = [
    strongFixture("alpha"),
    { name: "bravo", readme: shortReadme() },
    { name: "charlie", description: null, readme: missingReadme() },
    strongFixture("delta", { private: true }),
    strongFixture("echo", { fork: true, archived: true }),
  ];
  const audits = buildAudits(fixtures, { pinned: ["alpha"] });
  const before = JSON.parse(JSON.stringify(audits.map((audit) => ({
    name: audit.repository.name,
    score: audit.score,
    categoryScores: audit.categoryScores,
    findings: audit.findings,
    candidate: audit.candidate,
  }))));

  optimizePinnedSet(audits);
  const after = audits.map((audit) => ({
    name: audit.repository.name,
    score: audit.score,
    categoryScores: audit.categoryScores,
    findings: audit.findings,
    candidate: audit.candidate,
  }));

  assert.deepEqual(JSON.parse(JSON.stringify(after)), before);
  // A freshly scored profile must match too, so nothing was mutated in place.
  assert.deepEqual(
    buildAudits(fixtures, { pinned: ["alpha"] }).map((audit) => audit.score),
    audits.map((audit) => audit.score)
  );
});

test("every recommendation carries at least one evidence-backed reason", () => {
  const result = optimizePinnedSet(buildAudits([
    strongFixture("alpha"),
    { name: "bravo", language: "Go", readme: shortReadme() },
    strongFixture("charlie", { fork: true, language: "Rust" }),
  ]));

  for (const entry of result.recommended) {
    assert.ok(entry.reasons.length > 0, `${entry.name} has no reasons`);
    for (const reason of entry.reasons) {
      assert.match(reason, /\.$/, `${entry.name} has an unfinished reason: ${reason}`);
    }
    assert.ok(!entry.reasons.some((reason) =>
      /one of your best|great portfolio project|amazing|impressive/i.test(reason)),
      `${entry.name} makes a claim with no deterministic definition: ${entry.reasons.join(" ")}`);
  }
});

// Breadth calibration: the falsification cases the comparable band was measured
// against, plus the decision trace the diagnostics read. See docs/scoring.md.

test("falsification: near-identical evidence in different languages lets breadth break the tie", () => {
  const languages = ["TypeScript", "Python", "Go", "Rust", "Ruby", "Swift"];
  const audits = buildAudits(languages.map((language, index) =>
    strongFixture(`project-${"abcdef"[index]}`, { language, homepage: "https://example.dev" })));
  const scores = audits.map((audit) => audit.score);
  const result = optimizePinnedSet(audits);

  assert.ok(Math.max(...scores) - Math.min(...scores) <= COMPARABLE_SCORE_BAND,
    `this case needs comparable evidence, received ${scores.join(", ")}`);

  // Nothing is displaced: every repository fits, and each one is credited with the
  // language it actually adds.
  assert.equal(result.recommended.length, 6);
  assert.equal(result.diversity.languages.length, 6);
  for (const entry of result.recommended.slice(1)) {
    assert.ok(entry.reasons.some((reason) => reason.startsWith("Adds ")), describe(result));
  }
});

test("falsification: a shared language marks redundancy even when topics differ entirely", () => {
  const audits = buildAudits([
    strongFixture("solver", { language: "Python", topics: ["optimization", "solver"] }),
    strongFixture("scraper", { language: "Python", topics: ["scraping", "html"] }),
  ]);
  const result = optimizePinnedSet(audits);
  const second = result.recommended[1];

  // This records a deliberate limit rather than an endorsement. GitProfileLens has
  // no project or domain categories, so a shared primary language is the only
  // repetition it can observe here, and it is reported as exactly that: a shared
  // language, alongside the fact that the topics do not overlap.
  assert.match(second.reasons.find((reason) => reason.startsWith("Shares its primary language")) ?? "",
    /^Shares its primary language, Python, with (solver|scraper)\.$/);
  assert.ok(!second.reasons.some((reason) => /same (kind|type) of project|similar project/i.test(reason)),
    describe(result));
  assert.equal(result.diversity.sharedTopicPairs, 0);
});

test("falsification: a different language does not claim breadth when the topics repeat", () => {
  const audits = buildAudits([
    strongFixture("api-node", { language: "TypeScript", topics: ["rest-api", "openapi", "server"] }),
    strongFixture("api-go", { language: "Go", topics: ["rest-api", "openapi", "cli"] }),
  ]);
  const result = optimizePinnedSet(audits);
  const second = result.recommended[1];

  // The language is genuinely new, and that clause is earned. The overlapping
  // topics are reported alongside it rather than hidden by it.
  assert.ok(second.reasons.some((reason) => /^Adds (Go|TypeScript), which no other recommended repository represents\.$/.test(reason)),
    describe(result));
  assert.ok(second.reasons.some((reason) =>
    /^Shares the topics rest-api and openapi with api-(node|go), so the two may read as one project story\.$/.test(reason)),
    describe(result));
  assert.equal(result.diversity.sharedTopicPairs, 1);
});

test("a repository with no topics earns no breadth claim and no penalty", () => {
  const audits = buildAudits([
    strongFixture("tagged", { language: "Go", topics: ["cli", "tooling"] }),
    strongFixture("untagged", { language: "Go", topics: [] }),
  ]);
  const result = optimizePinnedSet(audits);
  const entry = recommendationFor(result, "untagged");

  assert.equal(result.recommended.length, 2);
  assert.ok(!entry.reasons.some((reason) => /topics do not overlap/.test(reason)), describe(result));
  assert.ok(!entry.reasons.some((reason) => /Shares the topics/.test(reason)), describe(result));
});

test("more than six Strong candidates are narrowed on evidence, not on arrival order", () => {
  const fixtures = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"]
    .map((name) => strongFixture(name, { language: "Go" }));
  const forward = optimizePinnedSet(buildAudits(fixtures));
  const reversed = optimizePinnedSet(buildAudits([...fixtures].reverse()));

  assert.equal(forward.eligibleCount, 8);
  assert.equal(forward.recommended.length, 6);
  assert.deepEqual(names(forward), names(reversed), "arrival order changed the recommendation");
});

test("the decision trace names the rule that settled each slot, and is absent unless asked for", () => {
  const audits = buildAudits([
    strongFixture("alpha", { language: "Go" }),
    strongFixture("bravo", { language: "Go" }),
    { name: "charlie", language: "Rust", readme: solidReadme(), description: TERSE_DESCRIPTION },
  ]);

  assert.equal(optimizePinnedSet(audits).trace, undefined, "diagnostics must be opt-in");

  const traced = optimizePinnedSet(audits, { trace: true });
  assert.equal(traced.trace.length, traced.recommended.length);
  for (const slot of traced.trace) {
    assert.equal(slot.winner.name, traced.recommended[slot.slot - 1].name);
    assert.ok(slot.decidingStage === null || typeof slot.decidingStage === "string");
    for (const alternative of slot.alternatives) {
      assert.ok(typeof alternative.lostAt === "string", "every alternative must lose at a named stage");
    }
  }

  // charlie presents far enough below the two Go repositories that breadth abstains
  // and the score stage settles it, which is exactly what the trace should say.
  const gap = scoreOf(audits, "alpha") - scoreOf(audits, "charlie");
  assert.ok(gap > COMPARABLE_SCORE_BAND, `this case needs a gap outside the band, received ${gap}`);
  assert.equal(traced.trace[1].winner.name, "bravo");
  assert.equal(traced.trace[1].decidingStage, "score");
});

test("tracing changes neither the recommended set nor any audit", () => {
  const fixtures = [
    strongFixture("alpha", { language: "Go" }),
    strongFixture("bravo", { language: "Rust" }),
    strongFixture("charlie", { language: "Python" }),
  ];
  const plain = optimizePinnedSet(buildAudits(fixtures));
  const traced = optimizePinnedSet(buildAudits(fixtures), { trace: true });

  assert.deepEqual(names(traced), names(plain));
  assert.deepEqual(
    traced.recommended.map((entry) => entry.reasons),
    plain.recommended.map((entry) => entry.reasons)
  );
});

test("current pin status stays out of selection under the comparable band", () => {
  // The band changes which repository wins a close comparison, so the invariant is
  // re-checked at exactly the distance where breadth is now decisive.
  const fixtures = [
    strongFixture("alpha", { language: "Python" }),
    strongFixture("bravo", { language: "Python" }),
    { name: "charlie", language: "TypeScript", readme: solidReadme() },
  ];
  const gapAudits = buildAudits(fixtures);
  const gap = scoreOf(gapAudits, "alpha") - scoreOf(gapAudits, "charlie");
  assert.ok(gap > 0 && gap <= COMPARABLE_SCORE_BAND, `this case needs a decisive band, received ${gap}`);

  const unpinned = optimizePinnedSet(buildAudits(fixtures), { limit: 2 });
  for (const pinned of [["bravo"], ["charlie"], ["alpha", "bravo", "charlie"]]) {
    const result = optimizePinnedSet(buildAudits(fixtures, { pinned }), { limit: 2 });
    assert.deepEqual(names(result), names(unpinned), `pinning ${pinned.join(", ")} changed the recommendation`);
  }
});
