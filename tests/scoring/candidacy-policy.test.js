const test = require("node:test");
const assert = require("node:assert/strict");

const { CORPUS } = require("./fixtures/index.js");
const { auditProfile } = require("./harness.js");
const { CANDIDACY_SCORE_BAND } = require("../../pinned-optimizer.js");
const {
  STRONG_GATES,
  findScoreConflicts,
  measureCandidacyDecisions,
  measureCliffs,
  measureReachableBounds,
  policyStages,
  runFalsificationCases,
  runPolicy,
  verifyGateTable,
} = require("../../evaluation/candidacy-diagnose.js");

/**
 * These tests pin the calibration findings behind the candidacy score band.
 *
 * The decision rests on measurements, not on taste, so the measurements are
 * asserted. If any of them stops holding, the partition has started doing
 * something it was not doing when it was examined, and the question should be
 * reopened with the failing case in hand rather than rediscovered by accident.
 *
 * They deliberately read the diagnostic's own functions. A test that
 * re-implemented the measurement could agree with itself while disagreeing with
 * the report a reviewer actually reads.
 *
 * One of these tests previously asserted a bound taken from a single hand-built
 * pair — a Strong at 87 and a Worth at 90 — and called the 3-point gap between
 * them the widest inversion the classifier could produce. It was not a bound at
 * all, only that generator's output, and the real figure found by search is 16.
 * Bounds are now established by `measureReachableBounds`, which searches rather
 * than exhibits.
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

test("the candidacy band moves no corpus recommendation", () => {
  // The band bounds a structural override; it is not a way to move a set. Every
  // width, and removing the rule from the ordering altogether, recommends exactly
  // what production recommends across all 185 corpus repositories.
  const current = recommendationsUnder("current");

  for (const [kind, band] of [["unbounded"], ["score-first"], ["band", 2], ["band", 5], ["band", 10]]) {
    const other = recommendationsUnder(kind, band);
    for (const id of Object.keys(current)) {
      assert.deepEqual(
        other[id],
        current[id],
        `${id} changed under ${kind}${band === undefined ? "" : ` ${band}`}`
      );
    }
  }
});

test("production is exactly the band it documents", () => {
  const current = recommendationsUnder("current");
  const banded = recommendationsUnder("band", CANDIDACY_SCORE_BAND);
  for (const id of Object.keys(current)) {
    assert.deepEqual(banded[id], current[id], `${id} does not match band ${CANDIDACY_SCORE_BAND}`);
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

test("the duplicated evidence does not bound the inversion on its own", () => {
  // This is why a band exists. Seven of the nine Strong gates read evidence the
  // presentation score already reads, and it is tempting to conclude that a
  // repository failing one has already paid for it in score and so cannot run
  // away with it. Searching the reachable space says otherwise: the coupling caps
  // the inversion at 16 points, which on a 0-100 scale is not a cap worth relying
  // on. The band is what actually bounds it.
  const bounds = measureReachableBounds();

  assert.ok(bounds.searched > 100000, "the bound must come from a search, not an example");
  assert.equal(bounds.strongFloor, 79);
  assert.equal(bounds.sharedCeiling, 95);
  assert.deepEqual(bounds.sharedCeilingFails, ["readme"]);
  assert.equal(bounds.sharedInversion, 16);
  assert.ok(
    bounds.sharedInversion > CANDIDACY_SCORE_BAND,
    "a band is only meaningful while the unbanded inversion exceeds it"
  );

  // Not a rare corner: most Strong shapes sit below the highest Worth shape.
  assert.ok(bounds.strongBelowCeiling / bounds.strongCount > 0.5);

  // Fork and archive status cost no presentation score at all, so those
  // inversions are capped only by the scale. They are handled by the originality
  // and archive stages instead, which is why the band does not weaken them.
  for (const key of ["forkUnknown", "archived", "fork"]) {
    assert.ok(bounds.exclusive[key].inversion >= bounds.sharedInversion, key);
  }
});

test("the corpus inversions are all caused by a gate the score does not read", () => {
  const conflicts = findScoreConflicts(PROFILES);
  assert.ok(
    conflicts.maximum <= CANDIDACY_SCORE_BAND,
    `a Worth repository outscored a Strong one by ${conflicts.maximum} points`
  );
  // Every corpus conflict comes from archive status, which the archive stage
  // settles regardless of the band, so banding candidacy cannot change them.
  assert.deepEqual(Object.keys(conflicts.byGate), ["notArchived"]);
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
