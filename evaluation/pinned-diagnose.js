#!/usr/bin/env node
/**
 * Pinned optimizer decision diagnostics.
 *
 * `npm run eval:pins` answers "did any recommendation move?". This answers the
 * different question "why does the optimizer recommend what it recommends?", by
 * running the real selection loop with tracing on and measuring which named rule
 * actually settled each choice.
 *
 * Nothing here influences selection. It reads the same optimizer the interface
 * uses, through the same entry point, so a measurement cannot drift from the
 * behavior it describes.
 *
 * It is deliberately opt-in and separate from `npm run eval:pins`, whose output
 * belongs in ordinary review. A non-zero exit means the diagnostic could not run,
 * never that recommendations changed.
 *
 *   npm run eval:pins:diagnose                     deciding stages, displacement, policies
 *   npm run eval:pins:diagnose -- --trace          also print every per-slot decision
 *   npm run eval:pins:diagnose -- --profile <id>   restrict to one corpus profile
 */

const { CORPUS } = require("../tests/scoring/fixtures/index.js");
const { EVALUATION_DATE, auditProfile } = require("../tests/scoring/harness.js");
const {
  COMPARABLE_SCORE_BAND,
  SELECTION_STAGES,
  SHARED_TOPIC_THRESHOLD,
  optimizePinnedSet,
} = require("../pinned-optimizer.js");

/** Stage names in the order the current policy applies them. */
const STAGE_NAMES = SELECTION_STAGES.map((stage) => stage.name);

/**
 * builds one candidate selection policy as an ordered list of named stages
 *
 * Every stage other than breadth is taken straight from the production order, so a
 * diagnostic cannot measure rules the optimizer does not have. Breadth is rebuilt
 * from the raw redundancy measurement because the production breadth stage already
 * carries a band; wrapping it would compose two bands and measure nothing real.
 *
 * A banded policy abstains unless the two candidates' presentation scores are close
 * enough to read as comparable evidence; outside the band the score stage decides
 * on its own. The run asserts that the production band reproduces the policy of the
 * same width, which is what keeps this honest.
 *
 * @param {string} kind policy identifier
 * @param {number} band presentation-score band, used by the banded policies
 * @returns {Array<Object>} ordering stages in order
 */
function policyStages(kind, band = 0) {
  const byName = Object.fromEntries(SELECTION_STAGES.map((stage) => [stage.name, stage]));
  const head = [byName.candidacy, byName.originality, byName.archive];
  const tail = [byName.maintenance, byName.metadata, byName.name];

  // Built from the raw redundancy measurement rather than from the production
  // breadth stage, which already carries a band of its own. Delegating to it would
  // compose the two bands and measure a rule nothing implements.
  const rawBreadth = (entryA, entryB) => entryA.redundancy.total - entryB.redundancy.total;

  if (kind === "current") return SELECTION_STAGES;
  if (kind === "unbounded") {
    // What breadth did before the comparable band: rank by redundancy whatever the
    // presentation gap. Kept so the change stays measurable.
    return [...head, { name: "breadth", compare: rawBreadth }, byName.score, ...tail];
  }
  if (kind === "score-first") {
    return [...head, byName.score, { name: "breadth", compare: rawBreadth }, ...tail];
  }

  const banded = {
    name: "breadth",
    compare: (entryA, entryB) =>
      Math.abs(entryB.candidate.score - entryA.candidate.score) <= band
        ? rawBreadth(entryA, entryB)
        : 0,
  };
  return [...head, banded, byName.score, ...tail];
}

/** The policies compared, in report order. */
const POLICIES = [
  {
    id: "current",
    label: `Current policy (breadth within ${COMPARABLE_SCORE_BAND} points)`,
    stages: policyStages("current"),
  },
  { id: "unbounded", label: "Breadth before score, unbounded", stages: policyStages("unbounded") },
  { id: "score-first", label: "Score before breadth", stages: policyStages("score-first") },
  { id: "band-2", label: "Breadth within 2 points", stages: policyStages("band", 2) },
  { id: "band-5", label: "Breadth within 5 points", stages: policyStages("band", 5) },
  { id: "band-10", label: "Breadth within 10 points", stages: policyStages("band", 10) },
];

/**
 * runs one policy across every corpus profile
 * @param {Array<Object>} profiles corpus profiles with their audits
 * @param {Object} policy policy descriptor carrying its stages
 * @returns {Object} per-profile results keyed by profile id
 */
function runPolicy(profiles, policy) {
  const results = {};
  for (const profile of profiles) {
    results[profile.id] = optimizePinnedSet(profile.audits, {
      stages: policy.stages,
      trace: true,
    });
  }
  return results;
}

/**
 * counts how often each named stage settled a decision
 *
 * Two different questions are answered separately. The per-slot count asks which
 * rule chose the winner over the runner-up, which is the decision that actually
 * determined the set. The pairwise count asks which rule separated the winner
 * from each remaining candidate, which shows how much work each rule does across
 * the whole field rather than only at the margin.
 *
 * @param {Object} results per-profile optimizer results
 * @returns {Object} slot-level and pairwise stage tallies
 */
function countDecidingStages(results) {
  const slots = Object.fromEntries(STAGE_NAMES.map((name) => [name, 0]));
  const pairwise = Object.fromEntries(STAGE_NAMES.map((name) => [name, 0]));
  let slotTotal = 0;
  let pairTotal = 0;
  let uncontestedSlots = 0;

  for (const result of Object.values(results)) {
    for (const slot of result.trace ?? []) {
      if (slot.decidingStage === null) {
        uncontestedSlots += 1;
      } else {
        slots[slot.decidingStage] += 1;
        slotTotal += 1;
      }
      for (const alternative of slot.alternatives) {
        if (alternative.lostAt === null) continue;
        pairwise[alternative.lostAt] += 1;
        pairTotal += 1;
      }
    }
  }

  return { slots, slotTotal, pairwise, pairTotal, uncontestedSlots };
}

/**
 * separates breadth decisions into the signal that actually earned the advantage
 *
 * A breadth decision is attributed to language when the winner adds a primary
 * language the runner-up does not, and to topics when the winner adds unrepeated
 * topics the runner-up does not. Both can be true at once, which is recorded as
 * its own category rather than silently counted twice.
 *
 * @param {Object} results per-profile optimizer results
 * @returns {Object} breadth attribution with the score differences it overrode
 */
function attributeBreadth(results) {
  const attribution = { language: [], topics: [], both: [] };

  for (const [id, result] of Object.entries(results)) {
    for (const slot of result.trace ?? []) {
      if (slot.decidingStage !== "breadth") continue;
      const winner = slot.winner;
      const runnerUp = slot.alternatives[0];
      const languageDecided = winner.addsLanguage && !runnerUp.addsLanguage;
      const topicsDecided = winner.addsTopics && !runnerUp.addsTopics;
      const key = languageDecided && topicsDecided ? "both" : languageDecided ? "language" : "topics";

      attribution[key].push({
        profile: id,
        slot: slot.slot,
        winner: winner.name,
        winnerScore: winner.score,
        winnerLanguage: winner.language,
        runnerUp: runnerUp.name,
        runnerUpScore: runnerUp.score,
        runnerUpLanguage: runnerUp.language,
        // Positive when breadth promoted the lower-scoring repository.
        scoreOverridden: runnerUp.score - winner.score,
      });
    }
  }

  return attribution;
}

/**
 * measures how often a selected repository scores below one that was left out
 *
 * Displacement is measured per filled slot against the highest-scoring eligible
 * repository the set never took. It does not assume the higher score should have
 * won; it measures how often, and by how much, the optimizer deliberately
 * overrides presentation evidence.
 *
 * @param {Object} results per-profile optimizer results
 * @returns {Object} displacement cases and their distribution
 */
function measureDisplacement(results) {
  const cases = [];

  for (const [id, result] of Object.entries(results)) {
    const selectedNames = new Set(result.recommended.map((entry) => entry.name));

    for (const slot of result.trace ?? []) {
      const passedOver = slot.alternatives.filter((entry) => !selectedNames.has(entry.name));
      if (passedOver.length === 0) continue;
      const best = passedOver.reduce((a, b) => (b.score > a.score ? b : a));
      if (best.score <= slot.winner.score) continue;

      cases.push({
        profile: id,
        slot: slot.slot,
        selected: slot.winner.name,
        selectedScore: slot.winner.score,
        excluded: best.name,
        excludedScore: best.score,
        difference: best.score - slot.winner.score,
        decidingStage: best.lostAt,
      });
    }
  }

  const differences = cases.map((entry) => entry.difference).sort((a, b) => a - b);
  const causes = {};
  for (const entry of cases) causes[entry.decidingStage] = (causes[entry.decidingStage] ?? 0) + 1;

  return {
    cases,
    count: cases.length,
    median: median(differences),
    maximum: differences.length ? differences[differences.length - 1] : 0,
    causes,
  };
}

/**
 * returns the median of an already sorted list, or 0 when it is empty
 * @param {Array<number>} sorted ascending values
 * @returns {number} median value
 */
function median(sorted) {
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * averages a list of numbers, reporting an empty list as zero
 * @param {Array<number>} values numbers to average
 * @returns {number} mean rounded to two decimals
 */
function mean(values) {
  if (values.length === 0) return 0;
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}

/**
 * summarizes the character of the sets one policy produced
 * @param {Object} results per-profile optimizer results
 * @returns {Object} aggregate set metrics
 */
function summarizePolicy(results) {
  const scores = [];
  const languageCounts = [];
  let sharedTopicPairs = 0;
  let pinRetention = 0;
  let pinTotal = 0;

  for (const result of Object.values(results)) {
    const selected = result.recommended;
    for (const entry of selected) scores.push(entry.score);
    languageCounts.push(new Set(selected.map((entry) => entry.language).filter(Boolean)).size);

    for (let i = 0; i < selected.length; i += 1) {
      for (let j = i + 1; j < selected.length; j += 1) {
        const shared = (selected[i].topics ?? [])
          .filter((topic) => (selected[j].topics ?? []).includes(topic));
        if (shared.length >= SHARED_TOPIC_THRESHOLD) sharedTopicPairs += 1;
      }
    }

    // Observation only. Current pin status never reaches selection.
    if (result.currentPinsKnown) {
      pinTotal += result.currentPinned.length;
      pinRetention += selected.filter((entry) => result.currentPinned.includes(entry.name)).length;
    }
  }

  const displacement = measureDisplacement(results);

  return {
    meanScore: mean(scores),
    medianScore: median([...scores].sort((a, b) => a - b)),
    meanLanguages: mean(languageCounts),
    sharedTopicPairs,
    displacementCount: displacement.count,
    displacementMedian: displacement.median,
    displacementMaximum: displacement.maximum,
    pinRetention,
    pinTotal,
  };
}

/**
 * compares one candidate policy's sets against the current policy's sets
 * @param {Object} current results under the current policy
 * @param {Object} candidate results under the candidate policy
 * @returns {Object} how many profiles and slots moved, and where
 */
function comparePolicies(current, candidate) {
  let profilesChanged = 0;
  let slotsChanged = 0;
  const changes = [];

  for (const id of Object.keys(current)) {
    const before = current[id].recommended.map((entry) => entry.name);
    const after = candidate[id].recommended.map((entry) => entry.name);
    const length = Math.max(before.length, after.length);
    let moved = 0;
    for (let i = 0; i < length; i += 1) if (before[i] !== after[i]) moved += 1;
    if (moved === 0) continue;
    profilesChanged += 1;
    slotsChanged += moved;
    changes.push({ id, before, after });
  }

  return { profilesChanged, slotsChanged, changes };
}

/**
 * counts candidacy labels across the corpus
 * @param {Array<Object>} profiles corpus profiles with their audits
 * @returns {Object} label distribution and saturation counts
 */
function measureCandidacy(profiles) {
  const labels = { strong: 0, polish: 0, deemphasize: 0 };
  let profilesWithSixStrong = 0;
  let profilesWellOverSix = 0;

  for (const profile of profiles) {
    const counts = { strong: 0, polish: 0, deemphasize: 0 };
    for (const audit of profile.audits) counts[audit.candidate.label] += 1;
    for (const key of Object.keys(counts)) labels[key] += counts[key];
    if (counts.strong >= 6) profilesWithSixStrong += 1;
    if (counts.strong >= 12) profilesWellOverSix += 1;
  }

  return { labels, profilesWithSixStrong, profilesWellOverSix };
}

/**
 * renders the stage inputs of one traced candidate on a single line
 * @param {Object} entry traced candidate
 * @returns {string} one-line description
 */
function describeTraced(entry) {
  const breadth = `lang${entry.addsLanguage ? "+" : "="}${entry.language ?? "unknown"}` +
    ` topics${entry.addsTopics ? "+" : "="}${entry.topics.length}`;
  const repeats = entry.languageMatch ? ` repeats:${entry.languageMatch}` : "";
  const overlap = entry.topicMatch
    ? ` overlap:${entry.topicMatch.name}[${entry.topicMatch.shared.join(",")}]`
    : "";
  return `${entry.name} (${entry.label} ${entry.score}) ${breadth} ` +
    `redundancy=${entry.redundancyTotal}${repeats}${overlap}`;
}

/**
 * prints one profile's per-slot decision trace
 * @param {string} id corpus profile identifier
 * @param {Object} result optimizer result carrying a trace
 * @returns {void} no return value
 */
function printTrace(id, result) {
  console.log(`\n--- ${id} ---`);
  for (const slot of result.trace ?? []) {
    console.log(
      `\nSlot ${slot.slot}  candidates remaining: ${slot.candidatesRemaining}  ` +
      `deciding stage: ${slot.decidingStage ?? "uncontested"}`
    );
    console.log(`  winner: ${describeTraced(slot.winner)}`);
    for (const alternative of slot.alternatives.slice(0, 3)) {
      console.log(`    ${describeTraced(alternative)}  lost at: ${alternative.lostAt}`);
    }
  }
}

/**
 * prints a label and value pair aligned into a column
 * @param {string} name row label
 * @param {*} value row value
 * @returns {void} no return value
 */
function row(name, value) {
  console.log(`  ${String(name).padEnd(36)}${value}`);
}

/**
 * prints the stage tallies for one decision population
 * @param {Object} counts stage name to count
 * @param {number} total number of decisions counted
 * @returns {void} no return value
 */
function printStageCounts(counts, total) {
  for (const name of STAGE_NAMES) {
    const share = total ? ((counts[name] / total) * 100).toFixed(1) : "0.0";
    row(name, `${counts[name]}  (${share}%)`);
  }
}

/**
 * runs the diagnostic and prints every measurement
 * @returns {void} no return value
 */
function main() {
  const args = process.argv.slice(2);
  const wantTrace = args.includes("--trace");
  const only = args.includes("--profile") ? args[args.indexOf("--profile") + 1] : null;

  const profiles = CORPUS
    .filter((profile) => !only || profile.id === only)
    .map((profile) => ({ id: profile.id, audits: auditProfile(profile).audits }));

  if (profiles.length === 0) {
    console.error(only ? `No corpus profile named ${only}.` : "The corpus is empty.");
    process.exitCode = 1;
    return;
  }

  const repositoryCount = profiles.reduce((total, profile) => total + profile.audits.length, 0);
  console.log(
    `Pinned optimizer diagnostics: ${profiles.length} profiles, ${repositoryCount} repositories, ` +
    `evaluated at ${EVALUATION_DATE.toISOString().slice(0, 10)}`
  );
  console.log(`Current stage order: ${STAGE_NAMES.join(" -> ")}`);

  const byPolicy = Object.fromEntries(
    POLICIES.map((policy) => [policy.id, runPolicy(profiles, policy)])
  );
  const current = byPolicy.current;

  console.log("\n== Candidacy distribution ==");
  const candidacy = measureCandidacy(profiles);
  row("Strong", candidacy.labels.strong);
  row("Worth polishing", candidacy.labels.polish);
  row("De-emphasize", candidacy.labels.deemphasize);
  row("Profiles with >= 6 Strong", `${candidacy.profilesWithSixStrong} of ${profiles.length}`);
  row("Profiles with >= 12 Strong", `${candidacy.profilesWellOverSix} of ${profiles.length}`);

  console.log("\n== Deciding stage, per filled slot (winner vs runner-up) ==");
  const stages = countDecidingStages(current);
  printStageCounts(stages.slots, stages.slotTotal);
  row("contested slots", stages.slotTotal);
  row("uncontested slots", stages.uncontestedSlots);

  const scoreReached = STAGE_NAMES.slice(STAGE_NAMES.indexOf("score"))
    .reduce((total, name) => total + stages.slots[name], 0);
  const share = (count) => (stages.slotTotal ? ((count / stages.slotTotal) * 100).toFixed(1) : "0.0");
  row("decided by breadth before score", `${stages.slots.breadth}  (${share(stages.slots.breadth)}%)`);
  row("reached the score stage", `${scoreReached}  (${share(scoreReached)}%)`);
  row("decided by score itself", `${stages.slots.score}  (${share(stages.slots.score)}%)`);

  console.log("\n== Deciding stage, per pairwise comparison (winner vs each remaining) ==");
  printStageCounts(stages.pairwise, stages.pairTotal);

  console.log("\n== What earned the breadth decisions ==");
  const breadth = attributeBreadth(current);
  for (const [key, entries] of Object.entries(breadth)) {
    const overrides = entries.filter((entry) => entry.scoreOverridden > 0);
    const differences = overrides.map((entry) => entry.scoreOverridden).sort((a, b) => a - b);
    row(`${key} decided`, entries.length);
    row("  of those, overrode a higher score", overrides.length);
    row("  mean score overridden", differences.length ? mean(differences) : "n/a");
    row("  max score overridden", differences.length ? differences[differences.length - 1] : "n/a");
  }

  const languageCases = [...breadth.language, ...breadth.both]
    .filter((entry) => entry.scoreOverridden > 0);
  if (languageCases.length) {
    console.log("  cases where a unique language beat a higher score:");
    for (const entry of languageCases) {
      console.log(
        `    ${entry.profile} slot ${entry.slot}: ${entry.winner} ` +
        `(${entry.winnerLanguage ?? "unknown"}, ${entry.winnerScore}) over ${entry.runnerUp} ` +
        `(${entry.runnerUpLanguage ?? "unknown"}, ${entry.runnerUpScore}), by ${entry.scoreOverridden}`
      );
    }
  }

  console.log("\n== Score displacement under the current policy ==");
  const displacement = measureDisplacement(current);
  row("displacement cases", displacement.count);
  row("median difference", displacement.median);
  row("maximum difference", displacement.maximum);
  row("cause distribution", JSON.stringify(displacement.causes));
  for (const entry of displacement.cases) {
    console.log(
      `    ${entry.profile} slot ${entry.slot}: ${entry.selected} (${entry.selectedScore}) over ` +
      `${entry.excluded} (${entry.excludedScore}), by ${entry.difference}, ` +
      `lost at ${entry.decidingStage}`
    );
  }

  console.log("\n== Candidate policy comparison ==");
  for (const policy of POLICIES) {
    const results = byPolicy[policy.id];
    const metrics = summarizePolicy(results);
    const moved = comparePolicies(current, results);
    console.log(`\n${policy.label}`);
    row("profiles changed", moved.profilesChanged);
    row("slots changed", moved.slotsChanged);
    row("mean selected score", metrics.meanScore);
    row("median selected score", metrics.medianScore);
    row("mean languages per set", metrics.meanLanguages);
    row("shared-topic pairs in sets", metrics.sharedTopicPairs);
    row("score displacement cases", metrics.displacementCount);
    row("displacement median / max", `${metrics.displacementMedian} / ${metrics.displacementMaximum}`);
    row("current pins retained (observed)", `${metrics.pinRetention} of ${metrics.pinTotal}`);
    for (const change of moved.changes) {
      console.log(`    ${change.id}`);
      console.log(`      before: ${change.before.join(", ") || "(none)"}`);
      console.log(`      after:  ${change.after.join(", ") || "(none)"}`);
    }
  }

  // Band 0 abstains unless the scores are exactly equal, which is what moving
  // breadth after score already does. If these ever disagree, a policy is wrong.
  const bandZero = runPolicy(profiles, { stages: policyStages("band", 0) });
  const scoreFirst = byPolicy["score-first"];
  const identical = Object.keys(bandZero).every((id) =>
    JSON.stringify(bandZero[id].recommended.map((entry) => entry.name)) ===
    JSON.stringify(scoreFirst[id].recommended.map((entry) => entry.name)));
  console.log(`\nConsistency check: band 0 matches score-before-breadth: ${identical}`);

  // The production band must be exactly one of the compared policies, or this
  // comparison is describing a rule the optimizer does not have.
  const productionBand = byPolicy[`band-${COMPARABLE_SCORE_BAND}`];
  const matchesProduction = Object.keys(current).every((id) =>
    JSON.stringify(current[id].recommended.map((entry) => entry.name)) ===
    JSON.stringify(productionBand[id].recommended.map((entry) => entry.name)));
  console.log(
    `Consistency check: production matches band ${COMPARABLE_SCORE_BAND}: ${matchesProduction}`
  );

  if (wantTrace) {
    console.log("\n== Per-slot decision traces (current policy) ==");
    for (const id of Object.keys(current)) printTrace(id, current[id]);
  }
}

main();
