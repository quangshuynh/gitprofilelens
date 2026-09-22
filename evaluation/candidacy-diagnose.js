#!/usr/bin/env node
/**
 * Portfolio candidacy calibration diagnostics.
 *
 * `npm run eval:pins:diagnose` asks which optimizer stage settles each choice.
 * This asks a narrower question that stage report raised: the candidacy stage
 * settles most pairwise comparisons, so what exactly is it deciding with, how
 * often does it override presentation evidence, and by how much?
 *
 * Nothing here influences selection or classification. It reads the production
 * classifier and the production optimizer through their real entry points, so a
 * measurement cannot drift from the behavior it describes.
 *
 * A non-zero exit means the diagnostic could not run, never that a classification
 * or a recommendation changed.
 *
 *   npm run eval:candidacy                      gates, conflicts, cliffs, policies
 *   npm run eval:candidacy -- --pairs           also list every Strong/Worth score conflict
 *   npm run eval:candidacy -- --profile <id>    restrict to one corpus profile
 */

const { CORPUS } = require("../tests/scoring/fixtures/index.js");
const { EVALUATION_DATE, auditProfile } = require("../tests/scoring/harness.js");
const {
  CANDIDACY_SCORE_BAND,
  SELECTION_STAGES,
  optimizePinnedSet,
} = require("../pinned-optimizer.js");

/**
 * The Strong candidate gates, named and reproduced from the production classifier.
 *
 * Each entry reads the same evidence field `isStrongCandidate` reads. The run
 * asserts that every gate passing is exactly equivalent to the production label
 * being "strong", so this table can never describe a classifier the product does
 * not have.
 */
const STRONG_GATES = [
  {
    name: "original",
    input: "repository.fork === false",
    threshold: "confirmed original",
    missing: "fails; an unreported fork status is unknown, not original",
    test: (evidence) => evidence.originality === "original",
    duplicatesScore: false,
  },
  {
    name: "notArchived",
    input: "repository.archived",
    threshold: "not archived",
    missing: "fails",
    test: (evidence) => !evidence.archived,
    duplicatesScore: false,
  },
  {
    name: "readme",
    input: "formatReadmeStatus(repository.readme)",
    threshold: "present or comprehensive",
    missing: "fails; unverified is unknown, not absent",
    test: (evidence) => evidence.readmeState === "present" || evidence.readmeState === "comprehensive",
    duplicatesScore: true,
  },
  {
    name: "description",
    input: "categoryScores.descriptions",
    threshold: ">= 70",
    missing: "fails at 0",
    test: (evidence) => evidence.description >= 70,
    duplicatesScore: true,
  },
  {
    name: "topics",
    input: "repository.topics.length",
    threshold: ">= 1",
    missing: "fails at 0",
    test: (evidence) => evidence.topics >= 1,
    duplicatesScore: true,
  },
  {
    name: "maintenance",
    input: "categoryScores.maintenance",
    threshold: ">= 85",
    missing: "fails; an unusable push date scores below the gate",
    test: (evidence) => evidence.maintenance >= 85,
    duplicatesScore: true,
  },
  {
    name: "noHighFindings",
    input: "findings of severity high",
    threshold: "=== 0",
    missing: "n/a",
    test: (evidence) => evidence.highFindings === 0,
    duplicatesScore: true,
  },
  {
    name: "mediumAtMostOne",
    input: "findings of severity medium",
    threshold: "<= 1",
    missing: "n/a",
    test: (evidence) => evidence.mediumFindings <= 1,
    duplicatesScore: true,
  },
  {
    name: "scoreBackstop",
    input: "audit.score",
    threshold: ">= 75",
    missing: "n/a",
    test: (evidence) => evidence.score >= 75,
    duplicatesScore: true,
  },
];

/**
 * builds one candidate ordering policy for the candidacy stage
 *
 * Every stage other than candidacy is taken straight from the production order, so
 * the diagnostic cannot measure rules the optimizer does not have. Only the
 * candidacy stage is substituted, which is the rule under examination.
 *
 * @param {string} kind policy identifier
 * @param {number} band presentation-score band used by the banded policies
 * @returns {Array<Object>} ordering stages in order
 */
function policyStages(kind, band = 0) {
  const byName = Object.fromEntries(SELECTION_STAGES.map((stage) => [stage.name, stage]));
  const rawCandidacy = (entryA, entryB) => entryA.candidate.tier - entryB.candidate.tier;
  const tail = [byName.originality, byName.archive, byName.breadth, byName.score,
    byName.maintenance, byName.metadata, byName.name];

  if (kind === "current") return SELECTION_STAGES;
  // Candidacy moved below score and nothing else moved, so any difference this
  // policy produces is attributable to the candidacy stage alone. Candidacy still
  // gates eligibility, which is not a stage and is deliberately left untouched.
  if (kind === "score-first") {
    return [byName.originality, byName.archive, byName.breadth, byName.score,
      { name: "candidacy", compare: rawCandidacy },
      byName.maintenance, byName.metadata, byName.name];
  }
  // What the production policy already is, restated as a stage list, so that the
  // run can assert the two agree rather than assume it.
  if (kind === "unbounded") return [{ name: "candidacy", compare: rawCandidacy }, ...tail];

  const banded = {
    name: "candidacy",
    compare: (entryA, entryB) =>
      Math.abs(entryB.candidate.score - entryA.candidate.score) <= band
        ? rawCandidacy(entryA, entryB)
        : 0,
  };
  return [banded, ...tail];
}

/** The policies compared, in report order. */
const POLICIES = [
  {
    id: "current",
    label: `Current policy (candidacy within ${CANDIDACY_SCORE_BAND} points)`,
    stages: policyStages("current"),
  },
  { id: "unbounded", label: "Candidacy before score, unbounded", stages: policyStages("unbounded") },
  { id: "score-first", label: "Score before candidacy", stages: policyStages("score-first") },
  { id: "band-2", label: "Candidacy within 2 points", stages: policyStages("band", 2) },
  { id: "band-5", label: "Candidacy within 5 points", stages: policyStages("band", 5) },
  { id: "band-10", label: "Candidacy within 10 points", stages: policyStages("band", 10) },
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
    results[profile.id] = optimizePinnedSet(profile.audits, { stages: policy.stages, trace: true });
  }
  return results;
}

/**
 * verifies that the gate table reproduces the production classifier exactly
 * @param {Array<Object>} profiles corpus profiles with their audits
 * @returns {Object} whether the table agrees, and the first disagreement
 */
function verifyGateTable(profiles) {
  for (const profile of profiles) {
    for (const entry of profile.audits) {
      const evidence = entry.candidate.evidence;
      const allPass = STRONG_GATES.every((gate) => gate.test(evidence));
      if (allPass !== (entry.candidate.label === "strong")) {
        return { agrees: false, profile: profile.id, repository: entry.repository.name };
      }
    }
  }
  return { agrees: true, profile: null, repository: null };
}

/**
 * counts which Strong gate each non-Strong repository actually failed
 * @param {Array<Object>} profiles corpus profiles with their audits
 * @returns {Object} per-gate failure counts and sole-failure counts
 */
function countGateFailures(profiles) {
  const failures = Object.fromEntries(STRONG_GATES.map((gate) => [gate.name, 0]));
  const soleFailures = Object.fromEntries(STRONG_GATES.map((gate) => [gate.name, 0]));
  const soleFailureCases = [];
  let evaluated = 0;

  for (const profile of profiles) {
    for (const entry of profile.audits) {
      if (entry.candidate.label === "strong") continue;
      evaluated += 1;
      const evidence = entry.candidate.evidence;
      const failed = STRONG_GATES.filter((gate) => !gate.test(evidence)).map((gate) => gate.name);
      for (const name of failed) failures[name] += 1;
      if (failed.length === 1) {
        soleFailures[failed[0]] += 1;
        soleFailureCases.push({
          profile: profile.id,
          repository: entry.repository.name,
          gate: failed[0],
          score: entry.score,
          label: entry.candidate.label,
        });
      }
    }
  }

  return { failures, soleFailures, soleFailureCases, evaluated };
}

/**
 * finds every pair where a Worth polishing repository outscores a Strong one
 *
 * Only eligible repositories are compared. A repository the optimizer would never
 * consider cannot be displaced by candidacy, so counting it would overstate the
 * rule's reach.
 *
 * @param {Array<Object>} profiles corpus profiles with their audits
 * @returns {Object} conflicting pairs and their distribution
 */
function findScoreConflicts(profiles) {
  const pairs = [];

  for (const profile of profiles) {
    const eligible = profile.audits.filter((entry) =>
      optimizePinnedSet([entry], {}).recommended.length > 0);
    const strong = eligible.filter((entry) => entry.candidate.label === "strong");
    const polish = eligible.filter((entry) => entry.candidate.label === "polish");

    for (const worth of polish) {
      for (const candidate of strong) {
        if (worth.score <= candidate.score) continue;
        const failed = STRONG_GATES.filter((gate) => !gate.test(worth.candidate.evidence));
        pairs.push({
          profile: profile.id,
          worth: worth.repository.name,
          worthScore: worth.score,
          strong: candidate.repository.name,
          strongScore: candidate.score,
          difference: worth.score - candidate.score,
          worthFailedGates: failed.map((gate) => gate.name),
        });
      }
    }
  }

  const differences = pairs.map((pair) => pair.difference).sort((a, b) => a - b);
  const byGate = {};
  for (const pair of pairs) {
    for (const gate of pair.worthFailedGates) byGate[gate] = (byGate[gate] ?? 0) + 1;
  }

  return {
    pairs,
    count: pairs.length,
    median: median(differences),
    mean: mean(differences),
    maximum: differences.length ? differences[differences.length - 1] : 0,
    byGate,
  };
}

/**
 * measures how often, and by how much, candidacy decided a slot over presentation score
 * @param {Object} results per-profile optimizer results
 * @returns {Object} deciding counts and the displacement candidacy caused
 */
function measureCandidacyDecisions(results) {
  let slotDecisions = 0;
  let pairwiseDecisions = 0;
  let pairwiseTotal = 0;
  let slotTotal = 0;
  const displacement = [];
  const affectedProfiles = new Set();

  for (const [id, result] of Object.entries(results)) {
    const selectedNames = new Set(result.recommended.map((entry) => entry.name));

    for (const slot of result.trace ?? []) {
      if (slot.decidingStage !== null) slotTotal += 1;
      if (slot.decidingStage === "candidacy") slotDecisions += 1;
      for (const alternative of slot.alternatives) {
        if (alternative.lostAt === null) continue;
        pairwiseTotal += 1;
        if (alternative.lostAt === "candidacy") pairwiseDecisions += 1;
      }

      // Candidacy displaced presentation evidence when the slot's winner scored
      // below a higher-scoring repository that lost at the candidacy stage and
      // never entered the set at all.
      const lostToCandidacy = slot.alternatives.filter((entry) =>
        entry.lostAt === "candidacy" && entry.score > slot.winner.score && !selectedNames.has(entry.name));
      if (lostToCandidacy.length === 0) continue;
      const best = lostToCandidacy.reduce((a, b) => (b.score > a.score ? b : a));
      affectedProfiles.add(id);
      displacement.push({
        profile: id,
        slot: slot.slot,
        selected: slot.winner.name,
        selectedScore: slot.winner.score,
        excluded: best.name,
        excludedScore: best.score,
        difference: best.score - slot.winner.score,
      });
    }
  }

  const differences = displacement.map((entry) => entry.difference).sort((a, b) => a - b);
  return {
    slotDecisions,
    slotTotal,
    pairwiseDecisions,
    pairwiseTotal,
    displacement,
    displacementCount: displacement.length,
    displacementMedian: median(differences),
    displacementMaximum: differences.length ? differences[differences.length - 1] : 0,
    affectedProfiles: affectedProfiles.size,
  };
}

/**
 * measures which evidence feeds the presentation score, candidacy, or both
 *
 * Duplication is not automatically a fault: the same fact can legitimately answer
 * two questions. What matters is whether the second use is bounded. A gate that
 * both lowers a score and then outranks that score counts the same evidence twice
 * with no ceiling on the second count, which is what this table exposes.
 *
 * @returns {Array<Object>} one row per gate
 */
function measureDuplicateEvidence() {
  return STRONG_GATES.map((gate) => ({
    gate: gate.name,
    input: gate.input,
    threshold: gate.threshold,
    missingBehavior: gate.missing,
    influences: gate.duplicatesScore ? "score and candidacy" : "candidacy only",
  }));
}

/**
 * measures what a one-unit miss on each Strong gate costs a repository
 *
 * Every case is the same synthetic repository with one gate input moved across its
 * threshold, so the difference reported is attributable to that gate alone.
 *
 * @returns {Array<Object>} one row per gate showing the label and score either side
 */
function measureCliffs() {
  const audit = require("../audit.js");
  const { buildRepository } = require("../tests/scoring/fixtures/builders.js");
  const rows = [];

  // Each pair moves exactly one gate input across its threshold and nothing else,
  // so the reported difference is attributable to that gate alone.
  const variants = [
    {
      gate: "description",
      // 70 and 40 are adjacent *reachable* description scores; the scorer produces
      // no value between them, so this gate has no knife edge to fall off.
      note: "description 70 (the gate itself) versus 40, the nearest reachable score below it",
      above: { description: "deterministic layout engine" },
      below: { description: "A tool" },
    },
    { gate: "topics", note: "one topic versus none", above: { topics: ["layout"] }, below: { topics: [] } },
    {
      gate: "maintenance",
      // 730 days is the band boundary. One day either side of it is a real,
      // reachable one-unit difference in the gate's input.
      note: "pushed 700 days ago versus 760, one maintenance band apart",
      above: { pushedAt: isoDaysBefore(700) },
      below: { pushedAt: isoDaysBefore(760) },
    },
    {
      gate: "readme",
      note: "two core README sections versus one",
      above: { readme: readmeWithCoreSections(2) },
      below: { readme: readmeWithCoreSections(1) },
    },
    {
      gate: "mediumAtMostOne",
      note: "one medium finding versus two",
      above: { readme: readmeWithCoreSections(2), license: null },
      below: { readme: shortReadme(), license: null },
    },
  ];

  for (const variant of variants) {
    const above = scoreVariant(audit, buildRepository, variant.above);
    const below = scoreVariant(audit, buildRepository, variant.below);
    rows.push({
      gate: variant.gate,
      note: variant.note,
      aboveLabel: above.candidate.label,
      aboveScore: above.score,
      belowLabel: below.candidate.label,
      belowScore: below.score,
      scoreCost: above.score - below.score,
      labelChanged: above.candidate.label !== below.candidate.label,
    });
  }

  return rows;
}

/**
 * scores one synthetic repository variant
 * @param {Object} audit audit module
 * @param {Function} buildRepository corpus repository builder
 * @param {Object} overrides fields to override on the baseline repository
 * @returns {Object} repository audit
 */
function scoreVariant(audit, buildRepository, overrides) {
  const { readme, ...fixture } = overrides;
  const raw = buildRepository("example", {
    name: "layout-engine",
    note: "Candidacy threshold probe; one gate input is moved across its boundary.",
    description: "A deterministic layout engine with a documented plugin interface",
    language: "Rust",
    topics: ["layout", "rust"],
    license: "MIT",
    pushedAt: isoDaysBefore(30),
    fork: false,
    archived: false,
    ...fixture,
  });
  return audit.scoreRepository(
    audit.transformRepository(raw, {
      pinnedRepositories: [],
      readmes: { "layout-engine": readme ?? readmeWithCoreSections(3) },
    }),
    EVALUATION_DATE
  );
}

/**
 * builds a README analysis short enough to raise a medium finding
 * @returns {Object} README analysis
 */
function shortReadme() {
  return { present: true, size: 320 };
}

/**
 * builds a README analysis carrying a chosen number of core sections
 * @param {number} coreSections how many of overview, installation, usage are present
 * @returns {Object} README analysis
 */
function readmeWithCoreSections(coreSections) {
  return {
    present: true,
    size: 2400,
    sections: {
      overview: coreSections >= 1,
      installation: coreSections >= 2,
      usage: coreSections >= 3,
      examples: false,
      contributing: false,
    },
    hasCodeBlock: true,
    hasImage: false,
    headingCount: 4,
  };
}

/**
 * builds a corpus-style date a number of days before the evaluation date
 *
 * The fixture builder appends its own time component, so this yields the date
 * portion only, exactly as every committed fixture does.
 *
 * @param {number} days how many days before the evaluation date
 * @returns {string} date in YYYY-MM-DD form
 */
function isoDaysBefore(days) {
  return new Date(EVALUATION_DATE.getTime() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * searches the reachable repository space for the true Strong floor and Worth ceiling
 *
 * An earlier version of this report answered this question with a single
 * hand-built pair and reported its two scores as though they were bounds. They
 * were not; they were one generator's output. A bound has to come from a search,
 * so this enumerates the cross product of every scoring input that can vary and
 * reports the extremes the classifier actually admits.
 *
 * The distinction that matters is which gate a Worth polishing repository failed.
 * Failing a gate the presentation score also reads costs it score, so those
 * inversions are capped by the scorer. Failing fork or archive status costs it no
 * score at all, so those are capped only by the range of the scale.
 *
 * @returns {Object} the extremes the search found
 */
function measureReachableBounds() {
  const auditModule = require("../audit.js");
  const { buildRepository } = require("../tests/scoring/fixtures/builders.js");

  const names = ["layout-engine", "My_Project", "project", "tutorial-notes"];
  const descriptions = [
    "A deterministic layout engine with a documented plugin interface",
    "deterministic layout engine",
    "A tool",
    null,
    "(wip) A deterministic layout engine with a documented plugin interface",
    "a deterministic layout engine with a documented plugin interface here",
  ];
  const readmes = [];
  for (const core of [0, 1, 2, 3]) {
    for (const examples of [false, true]) {
      for (const image of [false, true]) {
        for (const contributing of [false, true]) {
          readmes.push({
            present: true,
            size: 2400,
            sections: {
              overview: core >= 1,
              installation: core >= 2,
              usage: core >= 3,
              examples,
              contributing,
            },
            hasCodeBlock: true,
            hasImage: image,
            headingCount: 6,
          });
        }
      }
    }
  }
  readmes.push({ present: true, size: 320 }, { present: false, size: null }, { present: null, size: null });

  /**
   * scores one point in the search space
   * @param {Object} shape repository inputs
   * @returns {Object} repository audit
   */
  function scoreShape(shape) {
    const raw = buildRepository("example", {
      name: shape.name,
      note: "Reachable-bound search; one point in the input cross product.",
      description: shape.description,
      language: shape.language,
      topics: shape.topics,
      license: shape.license,
      homepage: shape.homepage,
      pushedAt: isoDaysBefore(shape.age),
      fork: shape.fork,
      archived: shape.archived,
    });
    return auditModule.scoreRepository(
      auditModule.transformRepository(
        shape.forkUnknown ? { ...raw, fork: undefined } : raw,
        { pinnedRepositories: [], readmes: { [shape.name]: shape.readme } }
      ),
      EVALUATION_DATE
    );
  }

  /**
   * enumerates the cross product under one originality and archive setting
   * @param {Object} fixed fork, archived and forkUnknown settings held constant
   * @returns {Array<Object>} every audited shape
   */
  function enumerate(fixed) {
    const found = [];
    for (const name of names) {
      for (const description of descriptions) {
        for (const readme of readmes) {
          for (const topics of [[], ["a"], ["a", "b", "c"]]) {
            for (const license of [null, "MIT"]) {
              for (const homepage of [null, "https://example.com"]) {
                for (const language of ["Rust", "JavaScript", null]) {
                  for (const age of [30, 400, 800, 1200]) {
                    const shape = {
                      name, description, readme, topics, license, homepage, language, age,
                      fork: false, archived: false, forkUnknown: false, ...fixed,
                    };
                    found.push({ shape, audit: scoreShape(shape) });
                  }
                }
              }
            }
          }
        }
      }
    }
    return found;
  }

  /**
   * reports the highest-scoring Worth polishing shape in one population
   * @param {Array<Object>} population audited shapes
   * @returns {Object|null} the highest Worth shape, or null when there is none
   */
  function highestWorth(population) {
    const worth = population.filter((entry) => entry.audit.candidate.label === "polish");
    return worth.length === 0
      ? null
      : worth.reduce((best, entry) => (entry.audit.score > best.audit.score ? entry : best));
  }

  const active = enumerate({});
  const strong = active.filter((entry) => entry.audit.candidate.label === "strong");
  const lowestStrong = strong.reduce((best, entry) =>
    (entry.audit.score < best.audit.score ? entry : best));
  const sharedCeiling = highestWorth(active);

  const exclusive = {
    forkUnknown: highestWorth(enumerate({ forkUnknown: true })),
    archived: highestWorth(enumerate({ archived: true })),
    fork: highestWorth(enumerate({ fork: true })),
  };

  return {
    searched: active.length,
    strongFloor: lowestStrong.audit.score,
    sharedCeiling: sharedCeiling.audit.score,
    sharedCeilingFails: STRONG_GATES
      .filter((gate) => !gate.test(sharedCeiling.audit.candidate.evidence))
      .map((gate) => gate.name),
    sharedInversion: sharedCeiling.audit.score - lowestStrong.audit.score,
    exclusive: Object.fromEntries(Object.entries(exclusive).map(([key, entry]) => [
      key,
      entry === null
        ? null
        : { score: entry.audit.score, inversion: entry.audit.score - lowestStrong.audit.score },
    ])),
    strongBelowCeiling: strong.filter((entry) => entry.audit.score < sharedCeiling.audit.score).length,
    strongCount: strong.length,
  };
}

/**
 * summarizes the character of the sets one policy produced
 * @param {Object} results per-profile optimizer results
 * @returns {Object} aggregate set metrics
 */
function summarizePolicy(results) {
  const scores = [];
  const languageCounts = [];
  let strongSelected = 0;
  let polishSelected = 0;
  let pinRetention = 0;
  let pinTotal = 0;

  for (const result of Object.values(results)) {
    for (const entry of result.recommended) {
      scores.push(entry.score);
      if (entry.label === "strong") strongSelected += 1;
      else polishSelected += 1;
    }
    languageCounts.push(new Set(result.recommended.map((entry) => entry.language).filter(Boolean)).size);

    // Observation only. Current pin status never reaches selection.
    if (result.currentPinsKnown) {
      pinTotal += result.currentPinned.length;
      pinRetention += result.recommended.filter((entry) => result.currentPinned.includes(entry.name)).length;
    }
  }

  const candidacy = measureCandidacyDecisions(results);
  return {
    meanScore: mean(scores),
    medianScore: median([...scores].sort((a, b) => a - b)),
    meanLanguages: mean(languageCounts),
    strongSelected,
    polishSelected,
    displacementCount: candidacy.displacementCount,
    displacementMaximum: candidacy.displacementMaximum,
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
    for (let index = 0; index < length; index += 1) if (before[index] !== after[index]) moved += 1;
    if (moved === 0) continue;
    profilesChanged += 1;
    slotsChanged += moved;
    changes.push({ id, before, after });
  }

  return { profilesChanged, slotsChanged, changes };
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
 * prints a label and value pair aligned into a column
 * @param {string} name row label
 * @param {*} value row value
 * @returns {void} no return value
 */
function row(name, value) {
  console.log(`  ${String(name).padEnd(34)}${value}`);
}

/**
 * runs the diagnostic and prints every measurement
 * @returns {void} no return value
 */
function main() {
  const args = process.argv.slice(2);
  const wantPairs = args.includes("--pairs");
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
    `Candidacy diagnostics: ${profiles.length} profiles, ${repositoryCount} repositories, ` +
    `evaluated at ${EVALUATION_DATE.toISOString().slice(0, 10)}`
  );

  const verified = verifyGateTable(profiles);
  console.log(`Gate table reproduces the production classifier: ${verified.agrees}`);
  if (!verified.agrees) {
    console.error(`  disagreement at ${verified.profile}/${verified.repository}`);
    process.exitCode = 1;
    return;
  }

  console.log("\n== Strong candidate gates ==");
  for (const gate of measureDuplicateEvidence()) {
    console.log(`  ${gate.gate.padEnd(18)} ${gate.threshold.padEnd(24)} ${gate.influences}`);
    console.log(`    input: ${gate.input}`);
    console.log(`    missing evidence: ${gate.missingBehavior}`);
  }

  console.log("\n== Which gate non-Strong repositories failed ==");
  const gates = countGateFailures(profiles);
  row("non-Strong repositories", gates.evaluated);
  for (const gate of STRONG_GATES) {
    row(gate.name, `failed ${gates.failures[gate.name]}  sole reason ${gates.soleFailures[gate.name]}`);
  }
  console.log("  repositories held out of Strong by exactly one gate:");
  for (const entry of gates.soleFailureCases.sort((a, b) => b.score - a.score).slice(0, 15)) {
    console.log(`    ${entry.profile}/${entry.repository} (${entry.score}) failed ${entry.gate}`);
  }

  console.log("\n== Strong / Worth presentation-score conflicts ==");
  const conflicts = findScoreConflicts(profiles);
  row("conflicting pairs", conflicts.count);
  row("mean difference", conflicts.mean);
  row("median difference", conflicts.median);
  row("maximum difference", conflicts.maximum);
  row("Worth gate behind each conflict", JSON.stringify(conflicts.byGate));
  if (wantPairs) {
    for (const pair of conflicts.pairs.sort((a, b) => b.difference - a.difference)) {
      console.log(
        `    ${pair.profile}: ${pair.worth} (${pair.worthScore}, Worth) outscores ` +
        `${pair.strong} (${pair.strongScore}, Strong) by ${pair.difference}; ` +
        `missing ${pair.worthFailedGates.join(",")}`
      );
    }
  }

  const byPolicy = Object.fromEntries(POLICIES.map((policy) => [policy.id, runPolicy(profiles, policy)]));
  const current = byPolicy.current;

  console.log("\n== How much the hard partition actually decides ==");
  const decisions = measureCandidacyDecisions(current);
  row("slots decided by candidacy", `${decisions.slotDecisions} of ${decisions.slotTotal} contested`);
  row("pairwise decided by candidacy", `${decisions.pairwiseDecisions} of ${decisions.pairwiseTotal}`);
  row("score displacements caused", decisions.displacementCount);
  row("profiles affected", decisions.affectedProfiles);
  row("median / max displacement", `${decisions.displacementMedian} / ${decisions.displacementMaximum}`);
  for (const entry of decisions.displacement) {
    console.log(
      `    ${entry.profile} slot ${entry.slot}: ${entry.selected} (${entry.selectedScore}) over ` +
      `${entry.excluded} (${entry.excludedScore}), by ${entry.difference}`
    );
  }

  console.log("\n== Threshold sensitivity: one unit either side of a gate ==");
  for (const cliff of measureCliffs()) {
    console.log(
      `  ${cliff.gate.padEnd(14)} above: ${cliff.aboveLabel} (${cliff.aboveScore})  ` +
      `below: ${cliff.belowLabel} (${cliff.belowScore})  ` +
      `score cost ${cliff.scoreCost}  label flips ${cliff.labelChanged}`
    );
    console.log(`                 ${cliff.note}`);
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
    row("Strong / Worth selected", `${metrics.strongSelected} / ${metrics.polishSelected}`);
    row("candidacy displacements", metrics.displacementCount);
    row("max candidacy displacement", metrics.displacementMaximum);
    row("current pins retained (observed)", `${metrics.pinRetention} of ${metrics.pinTotal}`);
    for (const change of moved.changes) {
      console.log(`    ${change.id}`);
      console.log(`      before: ${change.before.join(", ") || "(none)"}`);
      console.log(`      after:  ${change.after.join(", ") || "(none)"}`);
    }
  }

  // Band 0 abstains unless the scores are exactly equal, which is what moving
  // candidacy after score already does. If these disagree, a policy is wrong.
  const bandZero = runPolicy(profiles, { stages: policyStages("band", 0) });
  const identical = Object.keys(bandZero).every((id) =>
    JSON.stringify(bandZero[id].recommended.map((entry) => entry.name)) ===
    JSON.stringify(byPolicy["score-first"][id].recommended.map((entry) => entry.name)));
  console.log(`\nConsistency check: band 0 matches score-before-candidacy: ${identical}`);

  // The production policy must be exactly one of the policies compared, or this
  // whole comparison is describing a rule the optimizer does not have.
  const production = byPolicy[`band-${CANDIDACY_SCORE_BAND}`];
  const matches = production !== undefined && Object.keys(current).every((id) =>
    JSON.stringify(current[id].recommended.map((entry) => entry.name)) ===
    JSON.stringify(production[id].recommended.map((entry) => entry.name)));
  console.log(`Consistency check: production matches band ${CANDIDACY_SCORE_BAND}: ${matches}`);

  console.log("\n== Reachable bounds, found by search rather than by example ==");
  const bounds = measureReachableBounds();
  row("shapes searched per population", bounds.searched);
  row("lowest score a Strong can reach", bounds.strongFloor);
  row("highest a Worth can reach while", `${bounds.sharedCeiling}  (fails ${bounds.sharedCeilingFails.join(",")})`);
  row("  failing only score-visible gates", "");
  row("  => maximum inversion so caused", bounds.sharedInversion);
  for (const [key, entry] of Object.entries(bounds.exclusive)) {
    row(`highest Worth with ${key}`, entry === null
      ? "none classified Worth"
      : `${entry.score}  => inversion ${entry.inversion}`);
  }
  row("Strong shapes below that ceiling", `${bounds.strongBelowCeiling} of ${bounds.strongCount}`);

  console.log("\n== Falsification: constructed cases the corpus does not contain ==");
  for (const outcome of runFalsificationCases()) {
    console.log(`\n  ${outcome.name}`);
    console.log(`    ${outcome.description}`);
    for (const [policy, order] of Object.entries(outcome.byPolicy)) {
      console.log(`      ${policy.padEnd(12)} ${order.join(" > ") || "(nothing recommended)"}`);
    }
  }
}

/**
 * builds the constructed cases the evaluation corpus does not contain
 *
 * The corpus is real-shaped, which is its strength and its limit: it has never
 * held a Worth polishing repository that outscores a Strong one by a wide margin,
 * so a corpus comparison alone cannot say what the hard partition *would* do. Each
 * case here is a minimal pair built to ask exactly that.
 *
 * @returns {Array<Object>} one outcome per case, per policy
 */
function runFalsificationCases() {
  const auditModule = require("../audit.js");
  const { buildRepository, solidReadme, comprehensiveReadme } = require("../tests/scoring/fixtures/builders.js");

  /**
   * builds one audited repository from a compact description
   * @param {Object} shape repository shape
   * @returns {Object} repository audit
   */
  function make(shape) {
    const readme = shape.readme ?? comprehensiveReadme();
    const raw = buildRepository("example", {
      name: shape.name,
      note: "Falsification case; constructed to isolate one candidacy comparison.",
      description: shape.description ?? "A deterministic layout engine with a documented plugin interface",
      language: shape.language ?? "Rust",
      topics: shape.topics ?? ["layout", "rust"],
      license: shape.license === undefined ? "MIT" : shape.license,
      homepage: shape.homepage ?? null,
      pushedAt: shape.pushedAt ?? isoDaysBefore(30),
      fork: shape.fork ?? false,
      archived: shape.archived ?? false,
    });
    return auditModule.scoreRepository(
      auditModule.transformRepository(
        shape.forkUnknown ? { ...raw, fork: undefined } : raw,
        { pinnedRepositories: shape.pinned ? [shape.name] : [], readmes: { [shape.name]: readme } }
      ),
      EVALUATION_DATE
    );
  }

  // The two shapes the rest of the cases are built from. `minimalStrong` clears
  // every gate with nothing to spare, which is the lowest a Strong repository can
  // score; `richWorth` fails one gate and compensates everywhere else, which is
  // the highest a Worth repository can score. Their scores invert, which is the
  // inversion the corpus never contains.
  const minimalStrong = {
    topics: ["layout"],
    license: null,
    pushedAt: isoDaysBefore(700),
    readme: readmeWithCoreSections(2),
  };
  const richWorth = {
    topics: ["alpha", "beta", "gamma", "delta"],
    homepage: "https://example.com",
    readme: readmeWithCoreSections(1),
  };

  const cases = [
    {
      name: "1. Minimal Strong versus rich Worth",
      description: "The widest score inversion this classifier can produce from presentation evidence alone.",
      audits: [
        make({ name: "weak-strong", ...minimalStrong }),
        make({ name: "rich-worth", ...richWorth }),
      ],
    },
    {
      name: "1b. Minimal Strong versus a Worth held back only by unreported fork status",
      description: "Fork status does not enter the presentation score at all, so the inversion is unbounded by it.",
      audits: [
        make({ name: "weak-strong", ...minimalStrong }),
        make({ name: "unknown-fork", forkUnknown: true, homepage: "https://example.com" }),
      ],
    },
    {
      name: "2. Strong and Worth one point apart",
      description: "The regime a narrow score band would still leave to candidacy.",
      audits: [
        make({ name: "near-strong", readme: readmeWithCoreSections(2), license: null }),
        make({ name: "near-worth", ...richWorth }),
      ],
    },
    {
      name: "3. Worth misses only on description",
      description: "Identical but for a description at the nearest reachable score below the gate.",
      audits: [
        make({ name: "described", description: "A deterministic layout engine for documents" }),
        make({ name: "undescribed", description: "A tool" }),
      ],
    },
    {
      name: "4. Worth carries one extra medium finding",
      description: "Identical but for a second medium-severity presentation finding.",
      audits: [
        make({ name: "one-medium", license: null, readme: readmeWithCoreSections(2) }),
        make({ name: "two-medium", license: null, readme: { present: true, size: 320 } }),
      ],
    },
    {
      name: "5. README unavailable rather than absent",
      description: "Unknown evidence must not be read as a missing README.",
      audits: [
        make({ name: "readme-known", readme: readmeWithCoreSections(2) }),
        make({ name: "readme-unverified", readme: { present: null, size: null } }),
      ],
    },
    {
      name: "6. Strong and Worth otherwise identical",
      description: "Same language, topics, metadata; only the README structure differs.",
      audits: [
        make({ name: "aa-strong", readme: readmeWithCoreSections(2) }),
        make({ name: "bb-worth", readme: readmeWithCoreSections(1) }),
      ],
    },
    {
      name: "7. Current pin versus unpinned, otherwise identical",
      description: "Pin state is not selection evidence, so only the name rule may separate these.",
      audits: [
        make({ name: "aa-pinned", pinned: true }),
        make({ name: "bb-unpinned" }),
      ],
    },
    {
      name: "8. Fork unknown versus confirmed original, equal scores",
      description: "An unreported fork status is unknown: not a fork, and not original either.",
      audits: [
        make({ name: "aa-unknown-fork", forkUnknown: true }),
        make({ name: "bb-original" }),
      ],
    },
    {
      name: "9. Archived high score versus active lower score",
      description: "An explicit retirement, against an active repository scoring below it.",
      audits: [
        make({ name: "archived-high", archived: true, homepage: "https://example.com" }),
        make({ name: "active-lower", ...minimalStrong }),
      ],
    },
    {
      name: "10. Six Strong plus one materially higher-scoring Worth",
      description: "A full Strong pool at the Strong floor, with a Worth repository outscoring all of it.",
      audits: [
        ...["s1", "s2", "s3", "s4", "s5", "s6"].map((name, index) => make({
          ...minimalStrong,
          name,
          topics: [`topic-${index}`],
          language: ["Rust", "Go", "Python", "Java", "C", "Ruby"][index],
        })),
        make({ ...richWorth, name: "zz-rich-worth", language: "Elixir", topics: ["elixir", "beam"] }),
      ],
    },
  ];

  const policies = [["current", policyStages("current")], ["score-first", policyStages("score-first")],
    ["band-2", policyStages("band", 2)], ["band-5", policyStages("band", 5)],
    ["band-10", policyStages("band", 10)]];

  return cases.map((entry) => ({
    name: entry.name,
    description: `${entry.description} Scores: ` +
      entry.audits.map((item) => `${item.repository.name} ${item.score} ${item.candidate.label}`).join(", "),
    byPolicy: Object.fromEntries(policies.map(([id, stages]) => [
      id,
      optimizePinnedSet(entry.audits, { stages }).recommended.map((item) => item.name),
    ])),
  }));
}

// Running the file reports; requiring it hands the same measurements to the tests
// that pin them, so a test can never assert against a re-implementation.
if (require.main === module) main();

module.exports = {
  STRONG_GATES,
  countGateFailures,
  findScoreConflicts,
  measureCandidacyDecisions,
  measureCliffs,
  measureReachableBounds,
  policyStages,
  runFalsificationCases,
  runPolicy,
  verifyGateTable,
};
