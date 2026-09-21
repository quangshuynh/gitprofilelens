/**
 * Portfolio candidacy across the scoring evaluation corpus.
 *
 * `tests/audit.test.js` pins the classification rules against constructed
 * repositories. This file pins them against the corpus, where the evidence comes
 * from coherent synthetic accounts rather than from a fixture built to trigger a
 * single rule. Its job is to keep the two judgments apart: a repository's
 * presentation score and its suitability for prominent portfolio placement are
 * different claims, and this corpus contains repositories where they disagree in
 * both directions.
 *
 * Candidacy is not recorded in `evaluation/baseline.json`, so these assertions are
 * the only thing standing between a rule change and a silent corpus-wide shift.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditProfile } = require("./harness.js");
const { CORPUS, getProfile } = require("./fixtures/index.js");

const CANDIDATE_LABELS = new Set(["strong", "polish", "deemphasize"]);

/**
 * finds one repository's audit within a corpus profile
 * @param {string} profileId corpus profile identifier
 * @param {string} name repository name
 * @returns {Object} repository audit
 */
function auditFor(profileId, name) {
  const result = auditProfile(getProfile(profileId));
  const audit = result.audits.find((entry) => entry.repository.name === name);
  assert.ok(audit, `${profileId} has no repository named ${name}`);
  return audit;
}

/**
 * describes a repository audit for an assertion failure message
 * @param {Object} audit repository audit
 * @returns {string} readable description
 */
function describeCandidate(audit) {
  const candidate = audit.candidate;
  return `${audit.repository.name} scored ${audit.score} and was classified ${candidate.label}` +
    `${candidate.qualifier ? ` (${candidate.qualifier})` : ""}:\n  ${candidate.explanation}`;
}

/**
 * asserts a repository's candidate label
 * @param {string} profileId corpus profile identifier
 * @param {string} name repository name
 * @param {string} expected expected candidate label
 * @returns {Object} repository audit
 */
function assertLabel(profileId, name, expected) {
  const audit = auditFor(profileId, name);
  assert.equal(audit.candidate.label, expected, describeCandidate(audit));
  return audit;
}

test("every audited repository in the corpus receives a candidate classification", () => {
  for (const profile of CORPUS) {
    for (const audit of auditProfile(profile).audits) {
      const candidate = audit.candidate;
      assert.ok(candidate, `${profile.id}/${audit.repository.name} has no classification`);
      assert.ok(CANDIDATE_LABELS.has(candidate.label), `${profile.id}/${audit.repository.name} has label ${candidate.label}`);
      assert.ok(candidate.title.length > 0, `${profile.id}/${audit.repository.name} has no title`);
      assert.ok(candidate.explanation.length > 0, `${profile.id}/${audit.repository.name} has no explanation`);
      assert.match(candidate.explanation, /\.$/, `${profile.id}/${audit.repository.name} has an unfinished explanation`);
    }
  }
});

test("strong original work is a strong candidate", () => {
  for (const [profileId, name] of [
    ["polished-professional", "ledger-sync"],
    ["polished-professional", "queue-lens"],
    ["archive-heavy", "bench-suite"],
    ["oss-maintainer", "hexline-cli"],
    ["flagship-dominated", "promptkit"],
  ]) {
    const audit = assertLabel(profileId, name, "strong");
    assert.equal(audit.candidate.qualifier, null, describeCandidate(audit));
  }
});

test("original work with fixable gaps is worth polishing, and the gaps are named", () => {
  const dotfiles = assertLabel("polished-professional", "dotfiles", "polish");
  assert.match(dotfiles.candidate.explanation, /expanding the short README/i);
  assert.match(dotfiles.candidate.explanation, /adding a license/i);

  const website = assertLabel("beginner-account", "My_First_Website", "polish");
  assert.match(website.candidate.explanation, /adding topics/i);
});

test("weak original work is de-emphasized with reasons taken from its evidence", () => {
  const helloWorld = assertLabel("beginner-account", "hello-world", "deemphasize");
  assert.match(helloWorld.candidate.explanation, /it has no README/i);
  assert.match(helloWorld.candidate.explanation, /it has no description/i);

  assertLabel("student-coursework", "cs101-homework-3", "deemphasize");
  assertLabel("fork-dominated", "scripts", "deemphasize");
});

test("falsification: a fork with a perfect presentation score is not a strong candidate", () => {
  const renderKit = assertLabel("fork-dominated", "render-kit", "polish");

  assert.equal(renderKit.score, 100, "render-kit is the corpus repository that scores at the ceiling");
  assert.match(renderKit.candidate.explanation, /GitHub identifies this repository as a fork/);
  assert.match(renderKit.candidate.explanation, /cannot determine how much of the implementation belongs to the profile owner/);
  assert.doesNotMatch(renderKit.candidate.explanation, /did not write|no original work|forks are/i);

  // No fork anywhere in the corpus reaches Strong, whatever it scores.
  for (const profileId of ["fork-dominated", "student-coursework"]) {
    for (const audit of auditProfile(getProfile(profileId)).audits) {
      if (audit.repository.fork !== true) continue;
      assert.notEqual(audit.candidate.label, "strong", describeCandidate(audit));
    }
  }
});

test("falsification: an archived, well-presented repository is not a strong candidate", () => {
  const gateway = assertLabel("archive-heavy", "legacy-api-gateway", "polish");

  assert.ok(gateway.score >= 95, `expected a high presentation score, received ${gateway.score}`);
  assert.match(gateway.candidate.explanation, /it is archived/i);
  assert.match(gateway.candidate.explanation, /weaker choice for prominent portfolio placement/i);

  for (const profileId of ["archive-heavy", "oss-maintainer"]) {
    for (const audit of auditProfile(getProfile(profileId)).audits) {
      if (!audit.repository.archived) continue;
      assert.notEqual(audit.candidate.label, "strong", describeCandidate(audit));
    }
  }
});

test("falsification: private original work is judged by exactly the same rules", () => {
  const billingCore = assertLabel("private-audit-scope", "billing-core", "strong");

  assert.equal(billingCore.repository.private, true);
  assert.match(billingCore.candidate.explanation, /if you intend to publish or showcase/i);
  assert.doesNotMatch(billingCore.candidate.explanation, /make (it|this) public|publish (it|this) now/i);

  // Privacy is not an input, so it can neither help nor hurt. The rough private
  // experiment in the same account is de-emphasized on its own evidence.
  const spike = assertLabel("private-audit-scope", "spike-pricing-model", "deemphasize");
  assert.match(spike.candidate.explanation, /it has no README/i);
});

test("falsification: unverified README metadata is neutral, never read as absent", () => {
  for (const audit of auditProfile(getProfile("unverified-metadata")).audits) {
    const explanation = audit.candidate.explanation;
    assert.equal(audit.candidate.qualifier, "Some metadata unavailable", describeCandidate(audit));
    assert.match(explanation, /could not verify README status/i, describeCandidate(audit));
    assert.doesNotMatch(explanation, /no README|missing README|without a README|adding a README/i, describeCandidate(audit));
    assert.ok(!audit.candidate.weaknesses.includes("readme"), describeCandidate(audit));
  }

  // Unverifiable evidence blocks the affirmative Strong claim without pushing a
  // well-presented repository toward De-emphasize.
  assertLabel("unverified-metadata", "tidepool", "polish");
});

test("candidacy does not follow the score band", () => {
  // Three repositories whose ordering by score is the reverse of their ordering by
  // candidacy. If candidacy were a band, this test could not pass.
  const fork = auditFor("fork-dominated", "tinyhttp");
  const polished = auditFor("polished-professional", "dotfiles");
  const beginner = auditFor("beginner-account", "My_First_Website");

  assert.ok(fork.score > polished.score && polished.score > beginner.score,
    `expected scores to descend, received ${fork.score}, ${polished.score}, ${beginner.score}`);
  assert.equal(fork.candidate.label, "deemphasize", describeCandidate(fork));
  assert.equal(polished.candidate.label, "polish", describeCandidate(polished));
  assert.equal(beginner.candidate.label, "polish", describeCandidate(beginner));

  // And no pair of score thresholds reproduces the labels. Across the corpus the
  // Worth polishing range straddles both of the others: some polish repositories
  // outscore every strong one, and some score below every de-emphasized one.
  const audits = CORPUS.flatMap((profile) => auditProfile(profile).audits);
  const scoresFor = (label) => audits.filter((audit) => audit.candidate.label === label).map((audit) => audit.score);
  const polish = scoresFor("polish");
  const lowestStrong = Math.min(...scoresFor("strong"));
  const highestDeemphasized = Math.max(...scoresFor("deemphasize"));

  assert.ok(Math.max(...polish) > lowestStrong,
    `expected a Worth polishing repository above the lowest Strong candidate (${lowestStrong})`);
  assert.ok(Math.min(...polish) < highestDeemphasized,
    `expected a Worth polishing repository below the highest De-emphasize (${highestDeemphasized})`);
});

test("candidacy leaves the presentation score and its advice untouched", () => {
  // The interval that introduced candidacy changed no scoring. Re-running the
  // pipeline and stripping candidacy must reproduce the audit exactly.
  for (const profile of CORPUS) {
    const first = auditProfile(profile);
    const second = auditProfile(profile);

    assert.deepEqual(second.profile, first.profile, `${profile.id} profile scores are not deterministic`);
    assert.deepEqual(second.recommendations, first.recommendations, `${profile.id} advice is not deterministic`);

    for (const audit of first.audits) {
      assert.ok(Number.isInteger(audit.score) && audit.score >= 0 && audit.score <= 100);
      // Candidacy is derived, so nothing it reads may appear in the scored surface.
      assert.ok(!("candidate" in audit.categoryScores));
      assert.ok(audit.findings.every((finding) => !("candidate" in finding)));
    }
  }
});
