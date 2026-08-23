/**
 * Assertion helpers for the scoring evaluation corpus.
 *
 * The corpus asserts bands, orderings, and recommendation identity rather than
 * whole-object snapshots, so that a deliberate scoring change does not have to
 * rewrite every expectation. When an assertion does fail, these helpers report
 * the profile's actual scores and ranked recommendations, so the failure states
 * what changed instead of only that something did.
 */

const assert = require("node:assert/strict");

/**
 * asserts that a score falls inside an inclusive band
 * @param {string} label description of the score under test
 * @param {number} actual observed score
 * @param {number} minimum lowest acceptable score
 * @param {number} maximum highest acceptable score
 * @returns {void} no return value
 */
function assertScoreInRange(label, actual, minimum, maximum) {
  assert.ok(
    actual >= minimum && actual <= maximum,
    `${label}: expected a score between ${minimum} and ${maximum}, received ${actual}`
  );
}

/**
 * asserts that labeled scores decrease strictly from first to last
 * @param {string} label description of the ordering under test
 * @param {Array<Array>} entries label and score pairs in their expected order
 * @returns {void} no return value
 */
function assertScoresDescend(label, entries) {
  const ordering = entries.map(([name, score]) => `${name}=${score}`).join(" > ");
  for (let index = 1; index < entries.length; index += 1) {
    assert.ok(
      entries[index - 1][1] > entries[index][1],
      `${label}: expected ${entries[index - 1][0]} to score above ${entries[index][0]}, received ${ordering}`
    );
  }
}

/**
 * formats a profile's ranked recommendations for assertion failure messages
 * @param {Object} result audit result from auditProfile
 * @returns {string} readable recommendation listing
 */
function describeAdvice(result) {
  if (result.recommendations.length === 0) return `${result.id} produced no recommendations`;
  const lines = result.recommendations.map((recommendation, index) =>
    `  ${index + 1}. [${recommendation.severity}] ${recommendation.category}: ` +
    `${recommendation.action} (${recommendation.repositories.join(", ")})`
  );
  return `${result.id} recommendations:\n${lines.join("\n")}`;
}

/**
 * finds a ranked recommendation by category and action text
 * @param {Object} result audit result from auditProfile
 * @param {string} category recommendation category
 * @param {RegExp} actionPattern pattern matching the recommended action
 * @returns {Object|undefined} matching recommendation
 */
function findAdvice(result, category, actionPattern) {
  return result.recommendations.find(
    (recommendation) => recommendation.category === category && actionPattern.test(recommendation.action)
  );
}

/**
 * asserts that a profile receives a recommendation, optionally with expected details
 * @param {Object} result audit result from auditProfile
 * @param {string} category recommendation category
 * @param {RegExp} actionPattern pattern matching the recommended action
 * @param {{severity: string, repositories: Array<string>, rank: number}} expected optional expected details
 * @returns {Object} the matching recommendation
 */
function assertAdvice(result, category, actionPattern, expected = {}) {
  const recommendation = findAdvice(result, category, actionPattern);
  assert.ok(
    recommendation,
    `${result.id}: expected a ${category} recommendation matching ${actionPattern}.\n${describeAdvice(result)}`
  );

  if (expected.severity !== undefined) {
    assert.equal(
      recommendation.severity,
      expected.severity,
      `${result.id}: ${category} recommendation changed severity.\n${describeAdvice(result)}`
    );
  }
  if (expected.repositories !== undefined) {
    assert.deepEqual(
      recommendation.repositories,
      expected.repositories,
      `${result.id}: ${category} recommendation changed which repositories it affects.\n${describeAdvice(result)}`
    );
  }
  if (expected.rank !== undefined) {
    assert.equal(
      result.recommendations.indexOf(recommendation) + 1,
      expected.rank,
      `${result.id}: ${category} recommendation changed rank.\n${describeAdvice(result)}`
    );
  }

  return recommendation;
}

/**
 * asserts that a profile does not receive a recommendation
 * @param {Object} result audit result from auditProfile
 * @param {string} category recommendation category
 * @param {RegExp} actionPattern pattern matching the recommended action
 * @param {string} because explanation of why the recommendation would be wrong
 * @returns {void} no return value
 */
function assertNoAdvice(result, category, actionPattern, because) {
  assert.equal(
    findAdvice(result, category, actionPattern),
    undefined,
    `${result.id}: received an unexpected ${category} recommendation. ${because}\n${describeAdvice(result)}`
  );
}

module.exports = {
  assertAdvice,
  assertNoAdvice,
  assertScoreInRange,
  assertScoresDescend,
  describeAdvice,
  findAdvice,
};
