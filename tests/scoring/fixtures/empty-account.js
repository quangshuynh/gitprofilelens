/**
 * Edge case: an account with no public repositories.
 *
 * Reached whenever someone audits a brand-new account, an account whose work is
 * entirely private, or an organization-style account that owns nothing directly.
 * The metadata endpoint responds normally; it simply has nothing to report.
 *
 * Current behavior, recorded rather than changed: every category scores 0 and
 * the overall score is 0, so an account with nothing to present is reported
 * identically to an account that presents its work badly. The browser shows a
 * dedicated status message for this state, but the score card and share text
 * still read 0 out of 100. Flagged as a scoring question.
 */

const { buildProfile } = require("./builders.js");

module.exports = buildProfile({
  id: "empty-account",
  summary:
    "No public repositories at all. Scoring must stay defined and silent: zero scores, no findings, and no recommendations, because there is nothing to give advice about.",
  repositories: [],
});
