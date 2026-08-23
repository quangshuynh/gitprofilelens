/**
 * Persona: someone in their first months of writing code publicly.
 *
 * Presentation conditions being modeled:
 * - Default names taken from tutorials (`hello-world`) rather than chosen names.
 * - Descriptions absent or too short to explain anything.
 * - No topics and no licenses anywhere.
 * - READMEs missing or reduced to a title line.
 * - Nothing pinned, even though pin data is available.
 *
 * Everything here is recent and actively pushed, so maintenance is the one
 * category that scores well. That is intentional: it keeps the persona from
 * failing every category at once and proves the categories move independently.
 *
 * This models presentation and discoverability only. A missing README is a
 * discoverability condition, not a statement about the author's ability.
 */

const { buildProfile, missingReadme, shortReadme } = require("./builders.js");

module.exports = buildProfile({
  id: "beginner-account",
  summary:
    "New account with tutorial-shaped repositories: generic names, missing or thin descriptions, no topics or licenses, and missing READMEs. Only maintenance scores well because everything was pushed recently.",
  repositories: [
    {
      name: "hello-world",
      note: "Generic name pattern plus a missing description and README: the persona's weakest repository.",
      language: "JavaScript",
      createdAt: "2026-06-02",
      pushedAt: "2026-08-10",
      readme: missingReadme(),
    },
    {
      name: "My_First_Website",
      note: "Underscored, mixed-case name with a short lowercase description and a stub README.",
      description: "my portfolio website",
      language: "HTML",
      createdAt: "2026-06-18",
      pushedAt: "2026-07-30",
      readme: shortReadme({ size: 210 }),
    },
    {
      name: "calculator",
      note: "Clear name, but no description, topics, license, or README to explain it.",
      language: "Python",
      createdAt: "2026-07-01",
      pushedAt: "2026-07-05",
      readme: missingReadme(),
    },
  ],
});
