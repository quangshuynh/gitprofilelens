/**
 * Expected scoring outcomes for corpus edge cases.
 *
 * These cover data shapes and audit modes rather than kinds of account: an
 * account with nothing in it, an audit running without the serverless metadata
 * endpoint, the authenticated private-repository audit, and repository metadata
 * that only GitHub produces.
 *
 * As in the persona tests, assertions marked "records current behavior" pin
 * outcomes that are arguably wrong, so that changing them is a decision.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { getProfile } = require("./fixtures/index.js");
const { auditProfile, recommendationKeys } = require("./harness.js");
const { assertAdvice, assertNoAdvice, describeAdvice } = require("./expectations.js");

const empty = auditProfile(getProfile("empty-account"));
const unverified = auditProfile(getProfile("unverified-metadata"));
const privateScope = auditProfile(getProfile("private-audit-scope"));
const unusual = auditProfile(getProfile("unusual-metadata"));

test("an account with no repositories scores zero and says nothing", () => {
  assert.equal(empty.repositories.length, 0);
  assert.equal(empty.profile.overall, 0);
  for (const [category, score] of Object.entries(empty.profile.categories)) {
    assert.equal(score, 0, `${category} scored ${score} for an account with no repositories`);
  }
  assert.deepEqual(empty.recommendations, [], "an empty account must not be given advice");
});

test("unknown README status is neutral and never becomes advice", () => {
  // Without the serverless metadata endpoint the tool does not know whether a
  // README exists. Scoring it as missing would be a claim the data cannot
  // support, so it scores neutrally and reports an info finding instead.
  assert.equal(unverified.profile.categories.readme, 60);

  for (const audit of unverified.audits) {
    assert.equal(audit.repository.readme.present, null);
    assert.equal(audit.categoryScores.readme, 60, `${audit.repository.name} did not score neutrally`);
    const unverifiable = audit.findings.find((finding) => finding.category === "README quality");
    assert.equal(unverifiable.severity, "info");
    assert.doesNotMatch(unverifiable.reason, /no root README/i);
  }

  for (const recommendation of unverified.recommendations) {
    assert.notEqual(
      recommendation.category,
      "README quality",
      `README advice was produced without README data.\n${describeAdvice(unverified)}`
    );
  }
});

test("unknown pin state suppresses every pin recommendation", () => {
  // The only profile in the corpus that proves the suppression. Advising
  // someone to pin or unpin work without knowing what is pinned would be wrong.
  for (const repository of unverified.repositories) {
    assert.equal(repository.pinned, null, `${repository.name} reported a pin state the audit could not know`);
  }
  assertNoAdvice(unverified, "Portfolio focus", /consider pinning/i, "Pinned state is unknown.");
  assertNoAdvice(unverified, "Portfolio focus", /improve or unpin/i, "Pinned state is unknown.");
});

test("missing metadata does not suppress advice the public data supports", () => {
  // Descriptions, topics, licenses, names, and push dates all come from the
  // public REST response, so they must keep working when the endpoint is down.
  assertAdvice(unverified, "Discoverability", /add three to five specific topics/i, { repositories: ["buoy-feed"] });
  assertAdvice(unverified, "Descriptions", /add concrete context/i, { repositories: ["knot"] });
  assertAdvice(unverified, "Project maintenance", /update it, clearly mark it complete/i, { repositories: ["logbook"] });
});

test("privacy changes which repositories are audited, never how they are judged", () => {
  const profile = getProfile("private-audit-scope");
  const asPublic = auditProfile({
    ...profile,
    repositories: profile.repositories.map((repository) => ({
      ...repository,
      private: false,
      visibility: "public",
    })),
  });

  assert.equal(privateScope.repositories.filter((repository) => repository.private).length, 4);
  assert.deepEqual(
    asPublic.profile,
    privateScope.profile,
    "making every repository public changed the scores, so privacy is leaking into scoring"
  );
  assert.deepEqual(recommendationKeys(asPublic), recommendationKeys(privateScope));
});

test("an authenticated audit suggests pinning private repositories", () => {
  // Records current behavior. The authenticated audit builds supplemental
  // metadata with an empty pin list, so every repository reads as explicitly
  // unpinned and strong private work becomes a pin candidate, advised as "the
  // work you want visitors to notice first". Private repositories cannot be
  // pinned to a public profile. Flagged as a scoring question.
  const advice = assertAdvice(privateScope, "Portfolio focus", /consider pinning/i, { severity: "medium" });
  const privateNames = new Set(
    privateScope.repositories.filter((repository) => repository.private).map((repository) => repository.name)
  );

  assert.ok(
    advice.repositories.some((name) => privateNames.has(name)),
    `no private repository was suggested for pinning; the private pin path may have changed.\n${describeAdvice(privateScope)}`
  );
});

test("a repository with no commits falls back to its updated date", () => {
  // GitHub reports pushed_at as null until the first commit. Maintenance must
  // read updated_at instead of treating the missing date as the Unix epoch,
  // which would report a repository created today as decades abandoned.
  const source = getProfile("unusual-metadata").repositories
    .find((repository) => repository.name === "tessellate-web");
  const audit = unusual.audits.find((candidate) => candidate.repository.name === "tessellate-web");

  assert.equal(source.pushed_at, null, "the fixture no longer models a repository without commits");
  assert.equal(source.updated_at, "2026-08-19T00:00:00Z");
  assert.equal(
    audit.categoryScores.maintenance,
    100,
    `a repository created two days ago scored ${audit.categoryScores.maintenance} for maintenance`
  );
  assert.equal(
    audit.findings.some((finding) => finding.category === "Project maintenance"),
    false
  );
});

test("a name too long to scan is flagged without failing the whole category", () => {
  const audit = unusual.audits.find((candidate) => candidate.repository.name.length > 50);

  assert.ok(audit, "the fixture no longer models an over-long repository name");
  assertAdvice(unusual, "Repository presentation", /shorten the name/i, {
    severity: "medium",
    repositories: [audit.repository.name],
  });
  assert.equal(audit.categoryScores.presentation, 80);
});

test("a license GitHub cannot identify is accepted as a license", () => {
  // Records current behavior. GitHub reports spdx_id "NOASSERTION" for a license
  // file it cannot match. Discoverability only checks that a license exists, so
  // this passes even though a visitor still cannot tell what the terms are.
  // Flagged as a scoring question.
  const audit = unusual.audits.find((candidate) => candidate.repository.name === "pattern-studio");

  assert.equal(audit.repository.license, "NOASSERTION");
  assert.equal(audit.categoryScores.discoverability, 100);
  assert.equal(
    audit.findings.some((finding) => /no detected license/i.test(finding.reason)),
    false
  );
});
