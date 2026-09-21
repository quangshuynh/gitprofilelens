#!/usr/bin/env node
/**
 * Corpus-wide pinned repository optimizer evaluation.
 *
 * Runs every profile in the scoring evaluation corpus through the real audit
 * pipeline and then through the pinned optimizer, so a change to set selection
 * can be reviewed as "here is the portfolio set each of 13 profiles is now told
 * to feature" rather than only as a list of passing assertions.
 *
 * This report is deliberately kept apart from `npm run eval`. That report
 * records scoring outcomes, and the optimizer is not a scoring outcome: it reads
 * finished audits and changes none of them. Mixing the two would make a
 * selection change look like a scoring regression, and would invite recording a
 * new scoring baseline to settle a recommendation question.
 *
 * Like the scoring report, this is a developer command and not a CI gate. A
 * non-zero exit means the report could not run, never that recommendations
 * changed.
 *
 *   npm run eval:pins              diff the corpus against pinned-baseline.json
 *   npm run eval:pins -- --full    print current recommendations without diffing
 *   npm run eval:pins -- --update  rewrite the baseline from current outcomes
 */

const fs = require("node:fs");
const path = require("node:path");
const { CORPUS } = require("../tests/scoring/fixtures/index.js");
const { EVALUATION_DATE, auditProfile } = require("../tests/scoring/harness.js");
const { optimizePinnedSet } = require("../pinned-optimizer.js");

const BASELINE_PATH = path.join(__dirname, "pinned-baseline.json");

/** Compact labels for the per-profile table. */
const LABEL_ABBREVIATIONS = { strong: "S", polish: "P", deemphasize: "D" };

/**
 * runs the whole corpus through the optimizer and captures what it recommended
 * @returns {Object} corpus snapshot
 */
function buildSnapshot() {
  const profiles = {};

  for (const profile of CORPUS) {
    const audits = auditProfile(profile).audits;
    profiles[profile.id] = describeProfile(optimizePinnedSet(audits));
  }

  return {
    evaluationDate: EVALUATION_DATE.toISOString(),
    profileCount: CORPUS.length,
    limit: optimizePinnedSet([]).limit,
    profiles,
  };
}

/**
 * captures one profile's recommendation in a diffable shape
 *
 * Everything the interval asked to be inspectable across the corpus is recorded
 * here: how many repositories were eligible, what was recommended, under which
 * candidacy labels, how that compares with the current pins, and which
 * repositories with cautionary evidence made it in.
 *
 * @param {Object} result optimizer result
 * @returns {Object} baseline profile entry
 */
function describeProfile(result) {
  const recommended = result.recommended;
  const pinned = new Set(result.currentPinned);

  return {
    auditedCount: result.auditedCount,
    eligibleCount: result.eligibleCount,
    recommendedCount: recommended.length,
    recommended: recommended.map((entry) => entry.name),
    labels: recommended.map((entry) => LABEL_ABBREVIATIONS[entry.label]).join(""),
    currentPinsKnown: result.currentPinsKnown,
    currentPinned: result.currentPinned,
    currentPinnedOverlap: recommended.filter((entry) => pinned.has(entry.name)).length,
    alreadyOptimal: result.alreadyOptimal,
    forksSelected: recommended.filter((entry) => entry.originality === "fork").map((entry) => entry.name),
    unknownOriginalitySelected: recommended
      .filter((entry) => entry.originality === "unknown").map((entry) => entry.name),
    archivedSelected: recommended.filter((entry) => entry.archived).map((entry) => entry.name),
    polishSelected: recommended.filter((entry) => entry.label === "polish").map((entry) => entry.name),
    deemphasizeSelected: recommended.filter((entry) => entry.label === "deemphasize").map((entry) => entry.name),
    privateCandidates: result.privateCandidates.map((entry) => entry.name),
    diversity: {
      languages: result.diversity.languages,
      unknownLanguage: result.diversity.unknownLanguage,
      addsLanguage: recommended.filter((entry) => entry.breadth.addsLanguage).map((entry) => entry.name),
      addsTopics: recommended.filter((entry) => entry.breadth.addsTopics).map((entry) => entry.name),
      sharedTopicPairs: result.diversity.sharedTopicPairs,
      withHomepage: result.diversity.withHomepage,
    },
    excluded: Object.fromEntries(result.excluded.map((group) => [group.reason, group.repositories.length])),
    changes: result.changes.map((change) => ({
      action: change.action,
      repository: change.repository,
      replacement: change.replacement,
    })),
    shortfall: result.shortfall !== null,
  };
}

/**
 * compares a fresh snapshot against the committed baseline
 * @param {Object} baseline previously recorded snapshot
 * @param {Object} current fresh snapshot
 * @returns {Array<Object>} one entry per profile whose recommendation moved
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
 * compares one profile's recommendation against its baseline entry
 * @param {string} id corpus profile identifier
 * @param {Object|undefined} before baseline entry
 * @param {Object|undefined} after current entry
 * @returns {Object|null} profile diff, or null when nothing moved
 */
function diffProfile(id, before, after) {
  if (!before) return { id, status: "added", after };
  if (!after) return { id, status: "removed", before };
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return { id, status: "changed", before, after, fields: diffFields(before, after) };
}

/**
 * lists the fields that moved between two profile entries
 * @param {Object} before baseline entry
 * @param {Object} after current entry
 * @returns {Array<Object>} changed fields
 */
function diffFields(before, after) {
  return Object.keys(after)
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, before: format(before[field]), after: format(after[field]) }));
}

/**
 * formats a recorded value for a diff line
 * @param {*} value recorded value
 * @returns {string} readable value
 */
function format(value) {
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * renders the diff between the baseline and the current recommendations
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
      "Maintenance evidence below reflects that, not a selection change.",
      ""
    );
  }

  if (diffs.length === 0) {
    lines.push("No corpus recommendation changed.");
    return lines;
  }

  for (const diff of diffs) {
    if (diff.status === "added") {
      lines.push(`${diff.id}  ADDED  recommends ${format(diff.after.recommended)}`, "");
      continue;
    }
    if (diff.status === "removed") {
      lines.push(`${diff.id}  REMOVED  recommended ${format(diff.before.recommended)}`, "");
      continue;
    }
    lines.push(diff.id);
    for (const field of diff.fields) {
      lines.push(`  ${field.field.padEnd(24)}${field.before} -> ${field.after}`);
    }
    lines.push("");
  }

  lines.push(
    `${diffs.length} of ${current.profileCount} profiles changed. ` +
    "Inspect every line above before recording it with: npm run eval:pins -- --update"
  );
  return lines;
}

/**
 * renders the current recommendations with no baseline comparison
 * @param {Object} snapshot fresh snapshot
 * @returns {Array<string>} report lines
 */
function renderFull(snapshot) {
  const nameWidth = Math.max(...Object.keys(snapshot.profiles).map((id) => id.length));
  const lines = [
    describeRun(snapshot),
    "",
    "profile".padEnd(nameWidth) + "  audited  eligible  picked  labels  pinned  overlap",
  ];

  for (const [id, profile] of Object.entries(snapshot.profiles)) {
    lines.push(
      id.padEnd(nameWidth) +
      String(profile.auditedCount).padStart(9) +
      String(profile.eligibleCount).padStart(10) +
      String(profile.recommendedCount).padStart(8) +
      (profile.labels || "-").padStart(8) +
      (profile.currentPinsKnown ? String(profile.currentPinned.length) : "?").padStart(8) +
      String(profile.currentPinnedOverlap).padStart(9)
    );
  }

  lines.push("");
  for (const [id, profile] of Object.entries(snapshot.profiles)) {
    lines.push(`${id}:`);
    lines.push(`  recommended     ${format(profile.recommended)}`);
    lines.push(`  current pins    ${profile.currentPinsKnown ? format(profile.currentPinned) : "unknown"}`);
    lines.push(`  languages       ${format(profile.diversity.languages)}`);
    lines.push(`  adds language   ${format(profile.diversity.addsLanguage)}`);
    lines.push(`  adds topics     ${format(profile.diversity.addsTopics)}`);
    if (profile.forksSelected.length > 0) lines.push(`  forks           ${format(profile.forksSelected)}`);
    if (profile.unknownOriginalitySelected.length > 0) {
      lines.push(`  fork unknown    ${format(profile.unknownOriginalitySelected)}`);
    }
    if (profile.archivedSelected.length > 0) lines.push(`  archived        ${format(profile.archivedSelected)}`);
    if (profile.polishSelected.length > 0) lines.push(`  worth polishing ${format(profile.polishSelected)}`);
    if (profile.deemphasizeSelected.length > 0) {
      lines.push(`  DE-EMPHASIZE    ${format(profile.deemphasizeSelected)}`);
    }
    if (profile.privateCandidates.length > 0) lines.push(`  private work    ${format(profile.privateCandidates)}`);
    if (profile.alreadyOptimal) lines.push("  already optimal");
    if (profile.shortfall) lines.push(`  below the ${snapshot.limit}-repository maximum, by design`);
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
    `Pinned optimizer evaluation: ${snapshot.profileCount} profiles, ` +
    `up to ${snapshot.limit} recommendations each, ` +
    `evaluated at ${snapshot.evaluationDate.slice(0, 10)}`
  );
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
      `No baseline at ${relative(BASELINE_PATH)}. Create one with: npm run eval:pins -- --update`
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
 * runs the optimizer evaluation report
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
