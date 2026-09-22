const test = require("node:test");
const assert = require("node:assert/strict");

const { CORPUS } = require("./fixtures/index.js");
const { auditProfile } = require("./harness.js");
const {
  STRONG_GATES,
  findScoreConflicts,
  measureCandidacyDecisions,
  measureCliffs,
  policyStages,
  runFalsificationCases,
  runPolicy,
  verifyGateTable,
} = require("../../evaluation/candidacy-diagnose.js");

/**
 * These tests pin the calibration findings behind the decision to leave the
 * Strong / Worth partition ranked ahead of presentation score.
 *
 * The decision rests on measurements, not on taste, so the measurements are
 * asserted. If any of them stops holding, the partition has started doing
 * something it was not doing when it was examined, and the question should be
 * reopened with the failing case in hand rather than rediscovered by accident.
 *
 * They deliberately read the diagnostic's own functions. A test that
 * re-implemented the measurement could agree with itself while disagreeing with
 * the report a reviewer actually reads.
 */

const PROFILES = CORPUS.map((profile) => ({ id: profile.id, audits: auditProfile(profile).audits }));

/**
 * runs one policy and returns each profile's recommended names
 * @param {string} kind policy identifier
 * @param {number} band score band for the banded policies
 * @returns {Object} profile id to recommended repository names
 */
function recommendationsUnder(kind, band) {
  const results = runPolicy(PROFILES, { stages: policyStages(kind, band) });
  return Object.fromEntries(
    Object.entries(results).map(([id, result]) => [id, result.recommended.map((entry) => entry.name)])
  );
}

test("the documented Strong gates are exactly the classifier's gates", () => {
  const verified = verifyGateTable(PROFILES);
  assert.equal(
    verified.agrees,
    true,
    verified.agrees ? "" : `gate table disagrees at ${verified.profile}/${verified.repository}`
  );
});

test("candidacy ranked ahead of score changes no corpus recommendation", () => {
  // The load-bearing measurement. Across 185 repositories the hard partition
  // never changes which repositories are recommended, or in which order, versus
  // ranking presentation score first.
  const current = recommendationsUnder("current");
  const scoreFirst = recommendationsUnder("score-first");

  for (const id of Object.keys(current)) {
    assert.deepEqual(scoreFirst[id], current[id], `${id} changed when candidacy moved below score`);
  }
});

test("bounding candidacy by a score band changes no corpus recommendation", () => {
  const current = recommendationsUnder("current");
  for (const band of [2, 5, 10]) {
    const banded = recommendationsUnder("band", band);
    for (const id of Object.keys(current)) {
      assert.deepEqual(banded[id], current[id], `${id} changed under a ${band}-point candidacy band`);
    }
  }
});

test("candidacy displaces presentation score by at most a small margin on the corpus", () => {
  const decisions = measureCandidacyDecisions(runPolicy(PROFILES, { stages: policyStages("current") }));

  // Measured at 1 case of 2 points when the partition was examined. The assertion
  // is a ceiling rather than an equality, so ordinary corpus edits do not fail it
  // while a genuine change in the rule's reach does.
  assert.ok(
    decisions.displacementMaximum <= 5,
    `candidacy displaced presentation score by ${decisions.displacementMaximum} points`
  );
  assert.ok(
    decisions.displacementCount <= 3,
    `candidacy caused ${decisions.displacementCount} score displacements`
  );
});

test("a Worth polishing repository can only outscore a Strong one by a narrow margin", () => {
  // This is why the partition is bounded without needing a band. Seven of the nine
  // Strong gates read evidence the presentation score already reads, so a
  // repository that fails one of them has already paid for it in score. It cannot
  // fail a gate and still run away with the score.
  const conflicts = findScoreConflicts(PROFILES);
  assert.ok(
    conflicts.maximum <= 10,
    `a Worth repository outscored a Strong one by ${conflicts.maximum} points`
  );

  const cases = runFalsificationCases();
  const widest = cases.find((entry) => entry.name.startsWith("1. "));
  const scores = [...widest.description.matchAll(/(\S+) (\d+) (strong|polish)/g)]
    .map((match) => ({ name: match[1], score: Number(match[2]), label: match[3] }));
  const strongFloor = scores.find((entry) => entry.label === "strong");
  const worthCeiling = scores.find((entry) => entry.label === "polish");

  assert.ok(worthCeiling.score > strongFloor.score, "the constructed inversion must actually invert");
  assert.ok(
    worthCeiling.score - strongFloor.score <= 5,
    `the constructed inversion reached ${worthCeiling.score - strongFloor.score} points`
  );
});

test("the gates candidacy alone reads are already enforced by their own ranking stages", () => {
  // Originality and archive status are the two Strong gates the presentation score
  // does not read, and each has a dedicated stage immediately after candidacy. So
  // for those two, candidacy's ordering contributes nothing: removing it from the
  // order leaves these cases identical.
  const exclusive = STRONG_GATES.filter((gate) => !gate.duplicatesScore).map((gate) => gate.name);
  assert.deepEqual(exclusive, ["original", "notArchived"]);

  const cases = runFalsificationCases();
  const governedByOwnStage = cases.filter((entry) =>
    entry.name.startsWith("1b.") || entry.name.startsWith("8.") || entry.name.startsWith("9."));
  assert.equal(governedByOwnStage.length, 3);

  for (const entry of governedByOwnStage) {
    const orders = Object.values(entry.byPolicy).map((order) => order.join(","));
    assert.equal(
      new Set(orders).size,
      1,
      `${entry.name} ordered differently under different candidacy policies: ${orders.join(" | ")}`
    );
  }
});

test("every Strong gate is a threshold a repository can fall off", () => {
  // Not a defect on its own; it is the reason the partition was examined at all.
  // Recording it keeps the cliff visible rather than forgotten.
  for (const cliff of measureCliffs()) {
    assert.equal(cliff.aboveLabel, "strong", `${cliff.gate} did not reach Strong above its threshold`);
    assert.equal(cliff.belowLabel, "polish", `${cliff.gate} did not fall to Worth below its threshold`);
    assert.equal(cliff.labelChanged, true);
    // The score always moves in the same direction as the label, which is the
    // coupling that bounds how far the label can override the score.
    assert.ok(cliff.scoreCost > 0, `${cliff.gate} flipped the label at no cost to the score`);
  }
});

test("current pin state never orders a recommendation", () => {
  const cases = runFalsificationCases();
  const pinCase = cases.find((entry) => entry.name.startsWith("7. "));
  for (const order of Object.values(pinCase.byPolicy)) {
    // Separated by the name rule alone, which is the only rule left once every
    // piece of evidence is identical. The pinned one is not promoted.
    assert.deepEqual(order, ["aa-pinned", "bb-unpinned"]);
  }
});
