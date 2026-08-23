/**
 * The scoring evaluation corpus.
 *
 * Each entry is a synthetic account modeling a recognizable set of GitHub
 * presentation and discoverability conditions. The corpus exists so that scoring
 * changes can be inspected across representative profiles instead of only
 * against isolated unit assertions.
 *
 * Personas describe presentation conditions, never developer ability, skill, or
 * employability. Add a persona only when it exercises scoring behavior no
 * existing persona reaches.
 */

const archiveHeavy = require("./archive-heavy.js");
const beginnerAccount = require("./beginner-account.js");
const emptyAccount = require("./empty-account.js");
const flagshipDominated = require("./flagship-dominated.js");
const forkDominated = require("./fork-dominated.js");
const ossMaintainer = require("./oss-maintainer.js");
const polishedProfessional = require("./polished-professional.js");
const privateAuditScope = require("./private-audit-scope.js");
const prolificAccount = require("./prolific-account.js");
const strongWorkWeakPresentation = require("./strong-work-weak-presentation.js");
const studentCoursework = require("./student-coursework.js");
const unusualMetadata = require("./unusual-metadata.js");
const unverifiedMetadata = require("./unverified-metadata.js");

/**
 * Personas: representative accounts, strongest presentation first.
 */
const PERSONAS = [
  ossMaintainer,
  polishedProfessional,
  forkDominated,
  archiveHeavy,
  prolificAccount,
  studentCoursework,
  strongWorkWeakPresentation,
  flagshipDominated,
  beginnerAccount,
];

/**
 * Edge cases: data shapes and audit modes rather than kinds of account.
 */
const EDGE_CASES = [
  unusualMetadata,
  privateAuditScope,
  unverifiedMetadata,
  emptyAccount,
];

/** Every corpus profile. */
const CORPUS = [...PERSONAS, ...EDGE_CASES];

/**
 * finds a corpus profile by id
 * @param {string} id persona identifier
 * @returns {Object} corpus profile
 */
function getProfile(id) {
  const profile = CORPUS.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown corpus profile "${id}".`);
  return profile;
}

module.exports = { CORPUS, EDGE_CASES, PERSONAS, getProfile };
