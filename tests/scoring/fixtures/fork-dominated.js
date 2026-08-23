/**
 * Persona: an account whose public page is mostly forks of other projects.
 *
 * Presentation conditions being modeled:
 * - Seven forks that inherit their upstream description, topics, license, and
 *   README, so they present well without the account having authored any of it.
 * - Two original repositories that are thin: no description worth reading, no
 *   topics, no license, and little or no README.
 * - Two forks pinned to the profile.
 * - Forks left at varying staleness, from months to three years.
 *
 * Behaviors this persona is expected to expose:
 * - Repository categories are averaged across forks and original work alike, so
 *   inherited upstream presentation lifts the profile score.
 * - Portfolio focus grants a curation bonus of two points per archived or forked
 *   repository, so forking raises focus rather than lowering it.
 * - Pin suggestions consider forks to be strong pin candidates.
 *
 * This persona exists to make those interactions visible and regression-tested,
 * not to assert that forking is a presentation problem. Whether the current
 * behavior is correct is a scoring question, deliberately left unchanged here.
 */

const {
  buildProfile,
  comprehensiveReadme,
  missingReadme,
  shortReadme,
  solidReadme,
} = require("./builders.js");

module.exports = buildProfile({
  id: "fork-dominated",
  summary:
    "Seven forks with inherited upstream presentation plus two thin original repositories. Category averages and the focus curation bonus both reward the forks, so the profile scores far closer to the polished persona than its original work alone would suggest.",
  repositories: [
    {
      name: "render-kit",
      note: "Pinned fork with complete upstream metadata and a recent push.",
      description: "Component rendering toolkit with a virtual DOM diffing core",
      language: "JavaScript",
      topics: ["javascript", "ui", "rendering"],
      license: "MIT",
      homepage: "https://render-kit.example.dev",
      fork: true,
      createdAt: "2026-01-06",
      pushedAt: "2026-03-14",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "state-atoms",
      note: "Second pinned fork, one year stale.",
      description: "Atomic state management library with derived selectors and devtools",
      language: "TypeScript",
      topics: ["state-management", "typescript", "react"],
      license: "MIT",
      homepage: "https://state-atoms.example.dev",
      fork: true,
      createdAt: "2025-05-11",
      pushedAt: "2025-06-30",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "pgmigrate",
      note: "Unpinned fork that scores highly enough to be suggested as a pin candidate.",
      description: "Zero-downtime PostgreSQL migration runner for production clusters",
      language: "Go",
      topics: ["postgres", "migrations", "devops"],
      license: "Apache-2.0",
      fork: true,
      createdAt: "2025-07-14",
      pushedAt: "2025-08-01",
      readme: comprehensiveReadme(),
    },
    {
      name: "docs-theme",
      note: "Fork of a web project with a demo link, so discoverability is unpenalized.",
      description: "Documentation site theme with search and versioned navigation",
      language: "CSS",
      topics: ["documentation", "theme", "static-site"],
      license: "MIT",
      homepage: "https://docs-theme.example.dev",
      fork: true,
      createdAt: "2025-12-02",
      pushedAt: "2026-01-20",
      readme: comprehensiveReadme(),
    },
    {
      name: "yaml-lint",
      note: "Fork left untouched for over two years, pulling maintenance down.",
      description: "Configurable YAML linter with editor and continuous integration support",
      language: "Python",
      topics: ["yaml", "linter", "tooling"],
      license: "MIT",
      fork: true,
      createdAt: "2024-01-30",
      pushedAt: "2024-02-10",
      readme: comprehensiveReadme(),
    },
    {
      name: "csv-stream",
      note: "Fork between one and two years stale, covering the middle maintenance band.",
      description: "Streaming CSV parser that handles malformed rows without buffering",
      language: "Go",
      topics: ["csv", "streaming", "parser"],
      license: "BSD-3-Clause",
      fork: true,
      createdAt: "2024-08-19",
      pushedAt: "2024-09-12",
      readme: solidReadme(),
    },
    {
      name: "tinyhttp",
      note: "Fork abandoned for more than three years, covering the lowest maintenance band.",
      description: "Minimal HTTP server with a routing layer and zero dependencies",
      language: "Rust",
      topics: ["http", "server", "rust"],
      license: "MIT",
      fork: true,
      createdAt: "2022-12-18",
      pushedAt: "2023-01-05",
      readme: solidReadme(),
    },
    {
      name: "scripts",
      note: "Original work, but with nothing to describe or discover it by.",
      language: "Python",
      createdAt: "2025-04-09",
      pushedAt: "2026-08-05",
      readme: missingReadme(),
    },
    {
      name: "notes-app",
      note: "Original work with a vague description, no metadata, and a stub README.",
      description: "A web app",
      language: "JavaScript",
      createdAt: "2026-05-27",
      pushedAt: "2026-07-22",
      readme: shortReadme(),
    },
  ],
});
