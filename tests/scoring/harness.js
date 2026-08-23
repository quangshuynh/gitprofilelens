/**
 * Scoring evaluation harness.
 *
 * Runs a corpus profile through the same pipeline the browser uses
 * (transform -> score repository -> score profile -> recommend) with a frozen
 * evaluation date, so corpus outcomes never drift with wall-clock time.
 *
 * `script.js` calls `scoreRepository` without a date, which means production
 * maintenance scores move as time passes. The corpus deliberately pins the date
 * instead of reproducing that behavior.
 */

const { createHash } = require("node:crypto");
const {
  generateRecommendations,
  scoreProfile,
  scoreRepository,
  transformRepository,
} = require("../../audit.js");

/** Frozen "today" for every corpus run. */
const EVALUATION_DATE = new Date("2026-08-21T00:00:00Z");

/**
 * scores a corpus profile end to end
 * @param {Object} profile corpus profile built by buildProfile
 * @param {Date} now evaluation date
 * @returns {Object} repositories, repository audits, profile scores, and recommendations
 */
function auditProfile(profile, now = EVALUATION_DATE) {
  const repositories = profile.repositories.map((repository) =>
    transformRepository(repository, profile.supplemental)
  );
  const audits = repositories.map((repository) => scoreRepository(repository, now));

  return {
    id: profile.id,
    username: profile.username,
    repositories,
    audits,
    profile: scoreProfile(audits),
    recommendations: generateRecommendations(audits),
  };
}

/**
 * derives a stable, readable identifier for a recommendation
 *
 * `audit.js` groups findings by category and action text but exposes no
 * identifier, so the corpus derives one. The digest covers the full action text,
 * which matches how production decides that two findings are the same
 * recommendation, and keeps otherwise identical prefixes distinct.
 *
 * @param {Object} recommendation portfolio recommendation
 * @returns {string} stable recommendation key
 */
function recommendationKey(recommendation) {
  const category = slugify(recommendation.category);
  const prefix = slugify(recommendation.action.split(/\s+/).slice(0, 4).join(" "));
  const digest = createHash("sha1")
    .update(`${recommendation.category}|${recommendation.action}`)
    .digest("hex")
    .slice(0, 4);
  return `${category}:${prefix}-${digest}`;
}

/**
 * lists recommendation keys in their ranked order
 * @param {Object} result audit result from auditProfile
 * @returns {Array<string>} ranked recommendation keys
 */
function recommendationKeys(result) {
  return result.recommendations.map(recommendationKey);
}

/**
 * maps repository names to their overall repository score
 * @param {Object} result audit result from auditProfile
 * @returns {Object} repository name to score
 */
function repositoryScores(result) {
  return Object.fromEntries(result.audits.map((audit) => [audit.repository.name, audit.score]));
}

/**
 * converts text into a lowercase hyphenated slug
 * @param {string} value text to convert
 * @returns {string} slug
 */
function slugify(value) {
  return value.toLowerCase().replace(/[^a-z\d]+/g, "-").replace(/^-|-$/g, "");
}

module.exports = {
  EVALUATION_DATE,
  auditProfile,
  recommendationKey,
  recommendationKeys,
  repositoryScores,
};
