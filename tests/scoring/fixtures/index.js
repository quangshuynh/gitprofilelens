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

const beginnerAccount = require("./beginner-account.js");
const forkDominated = require("./fork-dominated.js");
const polishedProfessional = require("./polished-professional.js");
const studentCoursework = require("./student-coursework.js");

/** Corpus profiles in a stable order, strongest presentation first. */
const CORPUS = [
  polishedProfessional,
  forkDominated,
  studentCoursework,
  beginnerAccount,
];

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

module.exports = { CORPUS, getProfile };
