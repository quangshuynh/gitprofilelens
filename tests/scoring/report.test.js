/**
 * Tests for the scoring evaluation report.
 *
 * The report is the tool that answers "did this scoring change move anything?",
 * so a diff it fails to detect is worse than having no report at all: the run
 * prints "No corpus outcome changed." and the reviewer believes it. These tests
 * perturb a real corpus snapshot and assert the report notices.
 *
 * They deliberately do NOT assert the scores recorded in the committed baseline.
 * Weight tuning is supposed to move those numbers, and `npm run eval` is a review
 * tool rather than a gate. What is asserted about the baseline is only that it
 * still describes the corpus it claims to.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  BASELINE_PATH,
  buildSnapshot,
  diffSnapshot,
  renderDiff,
  run,
} = require("../../evaluation/report.js");
const { CORPUS } = require("./fixtures/index.js");
const { EVALUATION_DATE } = require("./harness.js");

const CATEGORIES = ["presentation", "descriptions", "readme", "discoverability", "maintenance", "focus"];
const RECOMMENDATION_FIELDS = ["action", "category", "key", "reason", "repositoryCount", "repositorySample", "severity"];
const CORPUS_IDS = CORPUS.map((profile) => profile.id);

/** One real corpus run, reused as the baseline every perturbation starts from. */
const SNAPSHOT = buildSnapshot();

/**
 * copies the corpus snapshot and applies a change to the copy
 * @param {Function} mutate receives the cloned profiles and edits them in place
 * @returns {Object} perturbed snapshot
 */
function perturb(mutate) {
  const clone = structuredClone(SNAPSHOT);
  mutate(clone.profiles);
  return clone;
}

/**
 * finds the single profile diff a perturbation was expected to produce
 * @param {string} id corpus profile identifier
 * @param {Object} current perturbed snapshot
 * @returns {Object} profile diff
 */
function onlyDiff(id, current) {
  const diffs = diffSnapshot(SNAPSHOT, current);
  assert.deepEqual(diffs.map((diff) => diff.id), [id], "the perturbation should move exactly one profile");
  return diffs[0];
}

test("the snapshot records every corpus profile in the shape the baseline commits", () => {
  assert.equal(SNAPSHOT.profileCount, CORPUS.length);
  assert.deepEqual(Object.keys(SNAPSHOT.profiles), CORPUS_IDS);
  assert.equal(
    Object.values(SNAPSHOT.profiles).reduce((total, profile) => total + profile.repositoryCount, 0),
    SNAPSHOT.repositoryCount
  );

  for (const [id, profile] of Object.entries(SNAPSHOT.profiles)) {
    assert.deepEqual(Object.keys(profile.categories), CATEGORIES, `${id} category set changed`);
    assert.ok(profile.recommendations.length <= 5, `${id} exceeded the five-recommendation cap`);

    for (const entry of profile.recommendations) {
      assert.deepEqual([...Object.keys(entry)].sort(), RECOMMENDATION_FIELDS, `${id} recommendation shape changed`);
      // The sample is capped so one 106-repository recommendation cannot make the
      // committed baseline unreadable.
      assert.ok(entry.repositorySample.length <= 6, `${id} recorded an uncapped repository sample`);
      assert.ok(entry.repositorySample.length <= entry.repositoryCount);
    }
  }
});

test("an unchanged corpus reports nothing at all", () => {
  const rerun = buildSnapshot();

  assert.deepEqual(diffSnapshot(SNAPSHOT, rerun), []);
  assert.match(renderDiff(SNAPSHOT, rerun).join("\n"), /No corpus outcome changed\./);
});

test("a moved overall score is reported with its direction and size", () => {
  const before = SNAPSHOT.profiles["beginner-account"].overall;
  const current = perturb((profiles) => { profiles["beginner-account"].overall = before - 4; });
  const diff = onlyDiff("beginner-account", current);
  const report = renderDiff(SNAPSHOT, current).join("\n");

  assert.equal(diff.status, "changed");
  assert.match(report, new RegExp(`beginner-account\\s+overall ${before} -> ${before - 4} \\(-4\\)`));
  assert.match(report, new RegExp(`1 of ${CORPUS.length} profiles changed`));
});

test("a category score is reported even when the rounded overall score does not move", () => {
  const before = SNAPSHOT.profiles["archive-heavy"].categories.readme;
  const current = perturb((profiles) => { profiles["archive-heavy"].categories.readme = before - 1; });
  const diff = onlyDiff("archive-heavy", current);

  assert.deepEqual(diff.categories, [{ category: "readme", before, after: before - 1 }]);
  assert.match(
    renderDiff(SNAPSHOT, current).join("\n"),
    new RegExp(`readme\\s+${before} -> ${before - 1} \\(-1\\)`)
  );
});

test("a new recommendation is reported with the rank it entered at", () => {
  const current = perturb((profiles) => {
    profiles["polished-professional"].recommendations.splice(1, 0, {
      key: "discoverability:invented-for-this-test-0000",
      severity: "high",
      category: "Discoverability",
      action: "Invented so the report has something new to notice.",
      repositoryCount: 2,
      repositorySample: ["payments-api", "ledger-sync"],
    });
  });
  const diff = onlyDiff("polished-professional", current);
  const added = diff.recommendations.filter((change) => change.change === "added");

  assert.deepEqual(added.map((change) => change.rank), [2]);
  assert.match(
    renderDiff(SNAPSHOT, current).join("\n"),
    /\+ rank 2 {2}\[high\] Discoverability: Invented so the report has something new.*\(2 repos\)/
  );
});

test("a recommendation that disappears is reported with the rank it held", () => {
  const dropped = SNAPSHOT.profiles["student-coursework"].recommendations[3];
  const current = perturb((profiles) => { profiles["student-coursework"].recommendations.splice(3, 1); });
  const diff = onlyDiff("student-coursework", current);
  const removed = diff.recommendations.filter((change) => change.change === "removed");

  assert.deepEqual(removed.map((change) => change.key), [dropped.key]);
  assert.deepEqual(removed.map((change) => change.rank), [4]);
  assert.match(renderDiff(SNAPSHOT, current).join("\n"), /- was rank 4 {2}\[high\] Portfolio focus:/);
});

test("advice that only changes rank is reported as a move, not as new advice", () => {
  const current = perturb((profiles) => {
    const advice = profiles["flagship-dominated"].recommendations;
    [advice[0], advice[1]] = [advice[1], advice[0]];
  });
  const diff = onlyDiff("flagship-dominated", current);
  const report = renderDiff(SNAPSHOT, current).join("\n");

  assert.equal(diff.categories.length, 0);
  assert.deepEqual(diff.recommendations.map((change) => change.change), ["changed", "changed"]);
  assert.match(report, /~ .*\(rank 2 -> 1\)/);
  assert.match(report, /~ .*\(rank 1 -> 2\)/);
  assert.equal(/\+ rank/.test(report), false, "a reordering must not read as advice appearing");
});

test("advice affecting a different set of repositories is reported at an unchanged count", () => {
  const current = perturb((profiles) => {
    profiles["fork-dominated"].recommendations[0].repositorySample = ["a-different-repository"];
  });
  const diff = onlyDiff("fork-dominated", current);
  const [change] = diff.recommendations;

  assert.equal(change.change, "changed");
  assert.equal(change.entry.repositoryCount, change.previousEntry.repositoryCount);
  assert.match(renderDiff(SNAPSHOT, current).join("\n"), /\(repos .+ -> a-different-repository\)/);
});

test("advice that changes severity is reported without changing its identity", () => {
  const before = SNAPSHOT.profiles["archive-heavy"].recommendations[0].severity;
  const after = before === "low" ? "high" : "low";
  const current = perturb((profiles) => {
    profiles["archive-heavy"].recommendations[0].severity = after;
  });
  const diff = onlyDiff("archive-heavy", current);

  assert.deepEqual(diff.recommendations.map((change) => change.change), ["changed"]);
  assert.match(renderDiff(SNAPSHOT, current).join("\n"), new RegExp(`\\(severity ${before} -> ${after}\\)`));
});

test("advice whose explanation changes is reported even when nothing else moves", () => {
  const current = perturb((profiles) => {
    profiles["archive-heavy"].recommendations[0].reason = "Rewritten explanation.";
  });
  const diff = onlyDiff("archive-heavy", current);

  assert.deepEqual(diff.recommendations.map((change) => change.change), ["changed"]);
  assert.equal(diff.categories.length, 0);
  assert.match(renderDiff(SNAPSHOT, current).join("\n"), /\(reason ".+" -> "Rewritten explanation\."\)/);
});

test("a corpus profile appearing or disappearing is reported rather than skipped", () => {
  const withoutEmpty = perturb((profiles) => { delete profiles["empty-account"]; });
  const removed = diffSnapshot(SNAPSHOT, withoutEmpty);
  const added = diffSnapshot(withoutEmpty, SNAPSHOT);

  assert.deepEqual(removed.map((diff) => [diff.id, diff.status]), [["empty-account", "removed"]]);
  assert.deepEqual(added.map((diff) => [diff.id, diff.status]), [["empty-account", "added"]]);
  assert.match(renderDiff(withoutEmpty, SNAPSHOT).join("\n"), /empty-account {2}ADDED/);
});

test("a changed repository count is reported so a fixture edit is never read as a scoring change", () => {
  const before = SNAPSHOT.profiles["prolific-account"].repositoryCount;
  const current = perturb((profiles) => { profiles["prolific-account"].repositoryCount = before - 1; });
  const diff = onlyDiff("prolific-account", current);

  assert.equal(diff.repositoryCountChanged, true);
  assert.match(
    renderDiff(SNAPSHOT, current).join("\n"),
    new RegExp(`repositories {2}${before} -> ${before - 1} \\(-1\\)`)
  );
});

test("the full listing names every corpus profile and its ranked advice", () => {
  const output = run(["--full"]).join("\n");

  for (const id of CORPUS_IDS) assert.match(output, new RegExp(`^${id}:`, "m"), `${id} is missing from the listing`);
  assert.match(output, /^empty-account: no recommendations$/m);
});

test("an unknown option fails loudly instead of quietly reporting nothing", () => {
  assert.throws(() => run(["--nope"]), /Unknown option "--nope"/);
});

test("the committed baseline still describes the corpus it claims to", () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));

  assert.deepEqual(Object.keys(baseline.profiles), CORPUS_IDS, "run: npm run eval -- --update");
  assert.equal(baseline.evaluationDate, EVALUATION_DATE.toISOString(), "run: npm run eval -- --update");
  assert.equal(baseline.profileCount, CORPUS.length, "run: npm run eval -- --update");
  // Recorded scores are intentionally not asserted. A weight change is supposed
  // to move them, and reviewing that movement is what `npm run eval` is for.
});
