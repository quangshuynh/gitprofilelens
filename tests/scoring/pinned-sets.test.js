/**
 * Pinned repository optimizer across the scoring evaluation corpus.
 *
 * `tests/pinned-optimizer.test.js` pins the rules against repositories built to
 * trigger one rule at a time. This file pins them against the corpus, where the
 * evidence comes from coherent synthetic accounts and the optimizer has to choose
 * between repositories that are all plausible.
 *
 * These assertions are properties, not a snapshot. `npm run eval:pins` records
 * the snapshot; this file records the claims that must survive any future change
 * to selection. Whenever the two disagree, this file is the one that decides.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditProfile } = require("./harness.js");
const { CORPUS, getProfile } = require("./fixtures/index.js");
const { optimizePinnedSet, MAXIMUM_PINNED_REPOSITORIES } = require("../../pinned-optimizer.js");

/**
 * runs the optimizer over one corpus profile
 * @param {string} profileId corpus profile identifier
 * @returns {Object} optimizer result
 */
function optimize(profileId) {
  return optimizePinnedSet(auditProfile(getProfile(profileId)).audits);
}

/**
 * lists recommended repository names
 * @param {Object} result optimizer result
 * @returns {Array<string>} recommended names
 */
function names(result) {
  return result.recommended.map((entry) => entry.name);
}

/**
 * describes a result for an assertion failure message
 * @param {string} profileId corpus profile identifier
 * @param {Object} result optimizer result
 * @returns {string} readable description
 */
function describe(profileId, result) {
  const lines = result.recommended.map((entry) =>
    `  ${entry.position}. ${entry.name} [${entry.title}] score ${entry.score}, ${entry.language || "no language"}`);
  return `${profileId} recommended ${result.recommended.length} of ${result.eligibleCount} eligible:\n${lines.join("\n")}`;
}

test("every corpus profile receives a set within GitHub's pin limit", () => {
  for (const profile of CORPUS) {
    const result = optimizePinnedSet(auditProfile(profile).audits);
    assert.ok(result.recommended.length <= MAXIMUM_PINNED_REPOSITORIES,
      describe(profile.id, result));
    assert.equal(new Set(names(result)).size, result.recommended.length,
      `${profile.id} recommended the same repository twice`);
    for (const entry of result.recommended) {
      assert.ok(entry.reasons.length > 0, `${profile.id}/${entry.name} has no recorded reason`);
      assert.ok(entry.url.startsWith("https://github.com/"), `${profile.id}/${entry.name} has no repository link`);
    }
  }
});

test("no De-emphasize repository is ever recommended, whatever it scores", () => {
  for (const profile of CORPUS) {
    const audits = auditProfile(profile).audits;
    const result = optimizePinnedSet(audits);
    const deemphasized = new Set(audits
      .filter((audit) => audit.candidate.label === "deemphasize")
      .map((audit) => audit.repository.name));

    for (const entry of result.recommended) {
      assert.ok(!deemphasized.has(entry.name),
        `${profile.id} recommended the de-emphasized ${entry.name}.\n${describe(profile.id, result)}`);
    }
  }

  // flagship-dominated holds seven de-emphasized repositories around one strong
  // one, so the rule has to hold while leaving five slots empty.
  const flagship = optimize("flagship-dominated");
  assert.deepEqual(names(flagship), ["promptkit"], describe("flagship-dominated", flagship));
});

test("no private repository reaches the publicly pinnable set", () => {
  for (const profile of CORPUS) {
    const audits = auditProfile(profile).audits;
    const result = optimizePinnedSet(audits);
    const isPrivate = new Set(audits
      .filter((audit) => audit.repository.private)
      .map((audit) => audit.repository.name));

    for (const entry of result.recommended) {
      assert.ok(!isPrivate.has(entry.name), `${profile.id} recommended the private ${entry.name}`);
    }
  }

  // Private work is still recognized, separately from what can be pinned.
  const result = optimize("private-audit-scope");
  assert.deepEqual(result.privateCandidates.map((entry) => entry.name), ["billing-core", "billing-admin"]);
  assert.equal(result.privateCandidates.every((entry) => entry.title === "Strong candidate"), true);
  assert.deepEqual(names(result), ["openapi-tools", "status-page"], describe("private-audit-scope", result));
});

test("active original work outranks archived work of comparable presentation", () => {
  const result = optimize("archive-heavy");
  const positions = Object.fromEntries(result.recommended.map((entry) => [entry.name, entry.position]));

  // legacy-api-gateway scores 98 and is archived; bench-suite scores less and is
  // an active Strong candidate. The active repository is recommended first.
  const gateway = result.recommended.find((entry) => entry.name === "legacy-api-gateway");
  const bench = result.recommended.find((entry) => entry.name === "bench-suite");
  assert.ok(gateway && bench, describe("archive-heavy", result));
  assert.ok(gateway.score > bench.score, `expected ${gateway.score} to exceed ${bench.score}`);
  assert.ok(positions["bench-suite"] < positions["legacy-api-gateway"], describe("archive-heavy", result));

  // Every archived repository that made the set says so.
  for (const entry of result.recommended.filter((candidate) => candidate.archived)) {
    assert.ok(entry.reasons.some((reason) => reason.includes("It is archived")),
      `${entry.name} was recommended without stating that it is archived`);
  }
});

test("forks are recommended only with the authorship limit stated, and never ahead of originals", () => {
  // student-coursework mixes originals with a fork that outscores all of them.
  const result = optimize("student-coursework");
  const fork = result.recommended.find((entry) => entry.name === "ml-teaching-notebooks");
  assert.ok(fork, describe("student-coursework", result));
  assert.equal(fork.originality, "fork");

  for (const entry of result.recommended.filter((candidate) => candidate.originality === "original")) {
    assert.ok(entry.score < fork.score,
      `expected the fork to outscore ${entry.name}, received ${fork.score} and ${entry.score}`);
    assert.ok(entry.position < fork.position,
      `the fork displaced the confirmed original ${entry.name}.\n${describe("student-coursework", result)}`);
  }

  // fork-dominated has no eligible originals at all, so forks do fill the set. Each
  // one carries the limit on what GitHub's fork flag can show, and none of them is
  // described as work the owner did not do.
  const forkDominated = optimize("fork-dominated");
  assert.equal(forkDominated.recommended.length, 6, describe("fork-dominated", forkDominated));
  for (const entry of forkDominated.recommended) {
    assert.equal(entry.originality, "fork");
    assert.ok(entry.reasons.some((reason) =>
      reason.includes("cannot determine how much of the implementation belongs to the profile owner")),
      `${entry.name} was recommended without stating the fork limit`);
    assert.ok(!entry.reasons.some((reason) => /did no work|no original work|forks are/i.test(reason)));
  }
});

test("fewer than the maximum is recommended when the evidence supports fewer", () => {
  for (const [profileId, expected] of [
    ["strong-work-weak-presentation", 2],
    ["beginner-account", 1],
    ["flagship-dominated", 1],
    ["unusual-metadata", 3],
    ["student-coursework", 4],
    ["empty-account", 0],
  ]) {
    const result = optimize(profileId);
    assert.equal(result.recommended.length, expected, describe(profileId, result));
    assert.ok(result.shortfall !== null, `${profileId} did not explain the short set`);
    assert.doesNotMatch(result.shortfall, /should pin|must pin/i);
  }
});

test("already optimal: a profile whose pins match the recommendation is told so", () => {
  const result = optimize("oss-maintainer");

  assert.equal(result.alreadyOptimal, true, describe("oss-maintainer", result));
  assert.deepEqual([...names(result)].sort(), [...result.currentPinned].sort());
  assert.equal(result.changes.filter((change) => ["add", "replace"].includes(change.action)).length, 0,
    `manufactured changes: ${result.changes.map((change) => `${change.action} ${change.repository}`).join(", ")}`);
});

test("unverified pin metadata leaves the comparison unknown rather than empty", () => {
  const result = optimize("unverified-metadata");

  assert.equal(result.currentPinsKnown, false);
  assert.deepEqual(result.changes, []);
  assert.equal(result.alreadyOptimal, false);
  assert.equal(result.recommended.length, 4, describe("unverified-metadata", result));

  // The set is still recommended, and every entry names what could not be verified.
  for (const entry of result.recommended) {
    assert.equal(entry.qualifier, "Some metadata unavailable");
    assert.ok(entry.reasons.some((reason) => reason.includes("could not verify README status")),
      `${entry.name} did not report its unverified evidence`);
  }
});

test("pin state changes the comparison, never the recommendation", () => {
  for (const profile of CORPUS) {
    const audits = auditProfile(profile).audits;
    const recommended = names(optimizePinnedSet(audits));

    // Re-run with every repository pinned, then with none pinned. If pin state fed
    // back into selection, at least one corpus profile would move.
    const allPinned = audits.map((audit) => withPinState(audit, true));
    const nonePinned = audits.map((audit) => withPinState(audit, false));

    assert.deepEqual(names(optimizePinnedSet(allPinned)), recommended,
      `${profile.id} changed when every repository was pinned`);
    assert.deepEqual(names(optimizePinnedSet(nonePinned)), recommended,
      `${profile.id} changed when nothing was pinned`);
  }
});

/**
 * copies an audit with a different pin state
 * @param {Object} audit repository audit
 * @param {boolean} pinned pin state to apply
 * @returns {Object} audit copy
 */
function withPinState(audit, pinned) {
  return { ...audit, repository: { ...audit.repository, pinned, pinnedPosition: pinned ? 0 : null } };
}

test("the optimizer is deterministic and independent of the order repositories arrive in", () => {
  for (const profile of CORPUS) {
    const audits = auditProfile(profile).audits;
    const forward = optimizePinnedSet(audits);
    const repeated = optimizePinnedSet(auditProfile(profile).audits);
    const reversed = optimizePinnedSet([...audits].reverse());

    assert.deepEqual(repeated, forward, `${profile.id} is not deterministic across runs`);
    assert.deepEqual(names(reversed), names(forward), `${profile.id} depends on repository order`);
  }
});

test("running the optimizer moves no score, category score, finding, or candidacy", () => {
  for (const profile of CORPUS) {
    const before = auditProfile(profile);
    const snapshot = JSON.parse(JSON.stringify({
      profile: before.profile,
      recommendations: before.recommendations,
      audits: before.audits.map((audit) => ({
        name: audit.repository.name,
        score: audit.score,
        categoryScores: audit.categoryScores,
        findings: audit.findings,
        candidate: audit.candidate,
      })),
    }));

    optimizePinnedSet(before.audits);

    assert.deepEqual(JSON.parse(JSON.stringify({
      profile: before.profile,
      recommendations: before.recommendations,
      audits: before.audits.map((audit) => ({
        name: audit.repository.name,
        score: audit.score,
        categoryScores: audit.categoryScores,
        findings: audit.findings,
        candidate: audit.candidate,
      })),
    })), snapshot, `${profile.id} changed while the optimizer ran`);
  }
});

test("the optimizer does not read the portfolio focus score", () => {
  // F2 records that portfolio focus rewards archived and forked repositories that
  // candidacy treats as weaknesses. The optimizer builds a set from repository
  // candidacy and fact, so a profile-level focus score is not one of its inputs.
  const source = require("node:fs")
    .readFileSync(require("node:path").join(__dirname, "..", "..", "pinned-optimizer.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/scorePortfolioFocus|scoreProfile/.test(source), false,
    "the optimizer reads a profile-level score, which reintroduces the F2 tension");
  assert.equal(/\.stars\b|stargazers|\.openIssues\b/.test(source), false,
    "the optimizer reads popularity, which no part of the product scores");
});
