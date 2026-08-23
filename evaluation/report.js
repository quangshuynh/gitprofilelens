#!/usr/bin/env node
/**
 * Corpus-wide scoring evaluation report.
 *
 * Runs every profile in the scoring evaluation corpus through the real audit
 * pipeline and diffs the result against a committed baseline, so a scoring
 * change can be reviewed as "here is what moved across 13 profiles" rather than
 * only as a list of passing or failing assertions.
 *
 * This is a developer command, not a CI gate. Weight tuning is supposed to move
 * these numbers; the point is to see the movement before committing it, and to
 * record the new numbers deliberately with `--update`. A non-zero exit means the
 * report could not run, never that outcomes changed.
 *
 *   npm run eval              diff the corpus against evaluation/baseline.json
 *   npm run eval -- --full    print current corpus outcomes without diffing
 *   npm run eval -- --update  rewrite the baseline from current outcomes
 *
 * The corpus and the pipeline wiring come from tests/scoring, so the report and
 * the scoring tests always evaluate the same profiles the same way.
 */

const fs = require("node:fs");
const path = require("node:path");
const { CORPUS } = require("../tests/scoring/fixtures/index.js");
const {
  EVALUATION_DATE,
  auditProfile,
  recommendationKey,
} = require("../tests/scoring/harness.js");

const BASELINE_PATH = path.join(__dirname, "baseline.json");

/** Category order used for every table and diff, matching scoreProfile. */
const CATEGORY_ORDER = [
  "presentation",
  "descriptions",
  "readme",
  "discoverability",
  "maintenance",
  "focus",
];

/**
 * How many affected repository names a baseline recommendation records.
 *
 * The full list is unbounded: a single recommendation on prolific-account names
 * 106 repositories, which would make the baseline diff unreadable for no gain.
 * A bounded sample still catches the changes where identity matters more than
 * volume, such as pin candidates, whose lists are never longer than three.
 */
const REPOSITORY_SAMPLE_LIMIT = 6;

/** Column headings for the `--full` table, narrow enough to stay aligned. */
const CATEGORY_LABELS = {
  presentation: "pres",
  descriptions: "desc",
  readme: "readme",
  discoverability: "disco",
  maintenance: "maint",
  focus: "focus",
};

/** Longest action text printed in a diff line before it is elided. */
const ACTION_WIDTH = 64;

/**
 * runs the whole corpus and captures the outcomes worth tracking
 * @returns {Object} corpus snapshot
 */
function buildSnapshot() {
  const profiles = {};
  let repositoryCount = 0;

  for (const profile of CORPUS) {
    const result = auditProfile(profile);
    repositoryCount += result.repositories.length;
    profiles[profile.id] = {
      repositoryCount: result.repositories.length,
      overall: result.profile.overall,
      categories: result.profile.categories,
      recommendations: result.recommendations.map(describeRecommendation),
    };
  }

  return {
    evaluationDate: EVALUATION_DATE.toISOString(),
    profileCount: CORPUS.length,
    repositoryCount,
    profiles,
  };
}

/**
 * captures one ranked recommendation in a diffable shape
 * @param {Object} recommendation portfolio recommendation
 * @returns {Object} baseline recommendation entry
 */
function describeRecommendation(recommendation) {
  return {
    key: recommendationKey(recommendation),
    severity: recommendation.severity,
    category: recommendation.category,
    action: recommendation.action,
    repositoryCount: recommendation.repositories.length,
    repositorySample: recommendation.repositories.slice(0, REPOSITORY_SAMPLE_LIMIT),
  };
}

/**
 * compares a fresh snapshot against the committed baseline
 * @param {Object} baseline previously recorded snapshot
 * @param {Object} current fresh snapshot
 * @returns {Array<Object>} one entry per profile whose outcomes moved
 */
function diffSnapshot(baseline, current) {
  const identifiers = [...new Set([
    ...Object.keys(current.profiles),
    ...Object.keys(baseline.profiles ?? {}),
  ])];

  return identifiers
    .map((id) => diffProfile(id, baseline.profiles?.[id], current.profiles[id]))
    .filter((diff) => diff !== null);
}

/**
 * compares one profile's outcomes against its baseline entry
 * @param {string} id corpus profile identifier
 * @param {Object|undefined} before baseline outcomes
 * @param {Object|undefined} after current outcomes
 * @returns {Object|null} profile diff, or null when nothing moved
 */
function diffProfile(id, before, after) {
  if (!before) return { id, status: "added", after };
  if (!after) return { id, status: "removed", before };

  const categories = CATEGORY_ORDER
    .filter((category) => before.categories[category] !== after.categories[category])
    .map((category) => ({
      category,
      before: before.categories[category],
      after: after.categories[category],
    }));
  const recommendations = diffRecommendations(before.recommendations, after.recommendations);
  const overallChanged = before.overall !== after.overall;
  const repositoryCountChanged = before.repositoryCount !== after.repositoryCount;

  if (!overallChanged && !repositoryCountChanged && categories.length === 0 && recommendations.length === 0) {
    return null;
  }

  return { id, status: "changed", before, after, categories, recommendations, repositoryCountChanged };
}

/**
 * compares two ranked recommendation lists by recommendation key
 * @param {Array<Object>} before baseline recommendations in rank order
 * @param {Array<Object>} after current recommendations in rank order
 * @returns {Array<Object>} added, removed, and changed recommendations
 */
function diffRecommendations(before, after) {
  const beforeByKey = new Map(before.map((entry, index) => [entry.key, { entry, rank: index + 1 }]));
  const afterByKey = new Map(after.map((entry, index) => [entry.key, { entry, rank: index + 1 }]));
  const changes = [];

  for (const [key, current] of afterByKey) {
    const previous = beforeByKey.get(key);
    if (!previous) {
      changes.push({ change: "added", key, entry: current.entry, rank: current.rank });
      continue;
    }

    const rankMoved = previous.rank !== current.rank;
    const severityMoved = previous.entry.severity !== current.entry.severity;
    const countMoved = previous.entry.repositoryCount !== current.entry.repositoryCount;
    const sampleMoved = previous.entry.repositorySample.join() !== current.entry.repositorySample.join();
    if (!rankMoved && !severityMoved && !countMoved && !sampleMoved) continue;

    changes.push({
      change: "changed",
      key,
      entry: current.entry,
      rank: current.rank,
      previousEntry: previous.entry,
      previousRank: previous.rank,
    });
  }

  for (const [key, previous] of beforeByKey) {
    if (afterByKey.has(key)) continue;
    changes.push({ change: "removed", key, entry: previous.entry, rank: previous.rank });
  }

  // Rank in the current list first, so a diff reads top-down like the advice a
  // visitor to the profile would actually be shown.
  return changes.sort(compareChangesByRank);
}

/**
 * orders recommendation changes by their rank
 * @param {Object} changeA first recommendation change
 * @param {Object} changeB second recommendation change
 * @returns {number} sort comparison
 */
function compareChangesByRank(changeA, changeB) {
  return changeA.rank - changeB.rank;
}

/**
 * renders the diff between the baseline and the current corpus outcomes
 * @param {Object} baseline previously recorded snapshot
 * @param {Object} current fresh snapshot
 * @returns {Array<string>} report lines
 */
function renderDiff(baseline, current) {
  const lines = [describeRun(current), `Baseline: ${relative(BASELINE_PATH)}`, ""];
  const diffs = diffSnapshot(baseline, current);

  if (baseline.evaluationDate !== current.evaluationDate) {
    lines.push(
      `Evaluation date moved ${baseline.evaluationDate} -> ${current.evaluationDate}. ` +
      "Every maintenance score below reflects that, not a scoring change.",
      ""
    );
  }

  if (diffs.length === 0) {
    lines.push("No corpus outcome changed.");
    return lines;
  }

  for (const diff of diffs) lines.push(...renderProfileDiff(diff), "");
  lines.push(renderSummary(baseline, current, diffs));
  return lines;
}

/**
 * renders one profile's movement
 * @param {Object} diff profile diff
 * @returns {Array<string>} report lines
 */
function renderProfileDiff(diff) {
  if (diff.status === "added") {
    return [`${diff.id}  ADDED  overall ${diff.after.overall} across ${diff.after.repositoryCount} repositories`];
  }
  if (diff.status === "removed") {
    return [`${diff.id}  REMOVED  was overall ${diff.before.overall}`];
  }

  const lines = [`${diff.id}  overall ${formatMove(diff.before.overall, diff.after.overall)}`];

  if (diff.repositoryCountChanged) {
    lines.push(`  repositories  ${formatMove(diff.before.repositoryCount, diff.after.repositoryCount)}`);
  }
  for (const category of diff.categories) {
    lines.push(`  ${category.category.padEnd(16)}${formatMove(category.before, category.after)}`);
  }
  for (const change of diff.recommendations) lines.push(`  ${renderRecommendationChange(change)}`);

  return lines;
}

/**
 * renders one recommendation change
 * @param {Object} change recommendation change
 * @returns {string} report line
 */
function renderRecommendationChange(change) {
  const { entry } = change;
  const advice = `[${entry.severity}] ${entry.category}: ${elide(entry.action)}`;

  if (change.change === "added") return `+ rank ${change.rank}  ${advice}  (${countRepositories(entry)})`;
  if (change.change === "removed") return `- was rank ${change.rank}  ${advice}  (${countRepositories(entry)})`;

  const details = [];
  if (change.previousRank !== change.rank) details.push(`rank ${change.previousRank} -> ${change.rank}`);
  if (change.previousEntry.severity !== entry.severity) {
    details.push(`severity ${change.previousEntry.severity} -> ${entry.severity}`);
  }
  if (change.previousEntry.repositoryCount !== entry.repositoryCount) {
    details.push(`repos ${change.previousEntry.repositoryCount} -> ${entry.repositoryCount}`);
  } else if (change.previousEntry.repositorySample.join() !== entry.repositorySample.join()) {
    details.push(`repos ${change.previousEntry.repositorySample.join(", ")} -> ${entry.repositorySample.join(", ")}`);
  }

  return `~ ${advice}  (${details.join("; ")})`;
}

/**
 * renders the closing corpus-wide summary
 * @param {Object} baseline previously recorded snapshot
 * @param {Object} current fresh snapshot
 * @param {Array<Object>} diffs profile diffs
 * @returns {string} report line
 */
function renderSummary(baseline, current, diffs) {
  const before = meanOverall(Object.values(baseline.profiles ?? {}));
  const after = meanOverall(Object.values(current.profiles));
  return (
    `${diffs.length} of ${current.profileCount} profiles changed. ` +
    `Mean overall ${formatMove(before, after)}. ` +
    `Record with: npm run eval -- --update`
  );
}

/**
 * renders the current corpus outcomes with no baseline comparison
 * @param {Object} snapshot fresh snapshot
 * @returns {Array<string>} report lines
 */
function renderFull(snapshot) {
  const nameWidth = Math.max(...Object.keys(snapshot.profiles).map((id) => id.length));
  const heading =
    "profile".padEnd(nameWidth) + "  repos  overall" +
    CATEGORY_ORDER.map((category) => CATEGORY_LABELS[category].padStart(7)).join("");
  const lines = [describeRun(snapshot), "", heading];

  for (const [id, profile] of Object.entries(snapshot.profiles)) {
    lines.push(
      id.padEnd(nameWidth) +
      String(profile.repositoryCount).padStart(7) +
      String(profile.overall).padStart(9) +
      CATEGORY_ORDER.map((category) => String(profile.categories[category]).padStart(7)).join("")
    );
  }

  lines.push("");
  for (const [id, profile] of Object.entries(snapshot.profiles)) {
    if (profile.recommendations.length === 0) {
      lines.push(`${id}: no recommendations`, "");
      continue;
    }
    lines.push(`${id}:`);
    profile.recommendations.forEach((entry, index) => {
      lines.push(
        `  ${index + 1}. [${entry.severity}] ${entry.category}: ` +
        `${elide(entry.action)}  (${countRepositories(entry)})`
      );
    });
    lines.push("");
  }

  return lines;
}

/**
 * describes what the run covered
 * @param {Object} snapshot corpus snapshot
 * @returns {string} report line
 */
function describeRun(snapshot) {
  return (
    `Scoring evaluation: ${snapshot.profileCount} profiles, ` +
    `${snapshot.repositoryCount} repositories, ` +
    `evaluated at ${snapshot.evaluationDate.slice(0, 10)}`
  );
}

/**
 * describes how many repositories a recommendation affects
 * @param {Object} entry baseline recommendation entry
 * @returns {string} repository count with its unit
 */
function countRepositories(entry) {
  return `${entry.repositoryCount} ${entry.repositoryCount === 1 ? "repo" : "repos"}`;
}

/**
 * averages the overall score across profiles
 * @param {Array<Object>} profiles snapshot profile entries
 * @returns {number} mean overall score
 */
function meanOverall(profiles) {
  if (profiles.length === 0) return 0;
  return Math.round(profiles.reduce((total, profile) => total + profile.overall, 0) / profiles.length);
}

/**
 * formats a numeric move with its signed delta
 * @param {number} before earlier value
 * @param {number} after later value
 * @returns {string} formatted move
 */
function formatMove(before, after) {
  const delta = after - before;
  return `${before} -> ${after} (${delta > 0 ? "+" : ""}${delta})`;
}

/**
 * shortens action text so diff lines stay scannable
 * @param {string} action recommended action
 * @returns {string} action text within the printed width
 */
function elide(action) {
  return action.length <= ACTION_WIDTH ? action : `${action.slice(0, ACTION_WIDTH - 1).trimEnd()}...`;
}

/**
 * formats a path relative to the repository root
 * @param {string} target absolute path
 * @returns {string} repository-relative path
 */
function relative(target) {
  return path.relative(path.join(__dirname, ".."), target).split(path.sep).join("/");
}

/**
 * reads the committed baseline
 * @returns {Object} baseline snapshot
 */
function readBaseline() {
  let contents;
  try {
    contents = fs.readFileSync(BASELINE_PATH, "utf8");
  } catch {
    throw new Error(
      `No baseline at ${relative(BASELINE_PATH)}. Create one with: npm run eval -- --update`
    );
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${relative(BASELINE_PATH)} is not readable JSON: ${error.message}`);
  }
}

/**
 * writes the baseline and reports what it recorded
 * @param {Object} snapshot fresh snapshot
 * @returns {Array<string>} report lines
 */
function writeBaseline(snapshot) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  return [
    describeRun(snapshot),
    `Recorded ${relative(BASELINE_PATH)}. Review the diff before committing it.`,
  ];
}

/**
 * runs the evaluation report
 * @param {Array<string>} argv command line arguments
 * @returns {Array<string>} report lines
 */
function run(argv) {
  const flags = new Set(argv);
  for (const flag of flags) {
    if (!["--update", "--full"].includes(flag)) {
      throw new Error(`Unknown option "${flag}". Supported options: --full, --update`);
    }
  }

  const snapshot = buildSnapshot();
  if (flags.has("--update")) return writeBaseline(snapshot);
  if (flags.has("--full")) return renderFull(snapshot);
  return renderDiff(readBaseline(), snapshot);
}

if (require.main === module) {
  try {
    console.log(run(process.argv.slice(2)).join("\n"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { BASELINE_PATH, buildSnapshot, diffSnapshot, renderDiff, run };
