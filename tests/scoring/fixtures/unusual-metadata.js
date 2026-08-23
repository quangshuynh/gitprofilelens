/**
 * Edge case: repository metadata shapes that GitHub really returns but that no
 * ordinary persona produces.
 *
 * The account is coherent: someone partway through tidying a profile, who has
 * just created an empty repository, keeps one project under a company license
 * GitHub cannot identify, and still owns an old repository whose name was never
 * shortened.
 *
 * Behaviors this profile is expected to protect:
 * - A repository with no commits reports `pushed_at: null`, and maintenance must
 *   fall back to `updated_at` rather than treating the missing date as 1970.
 * - A repository name over 50 characters is flagged as hard to scan.
 * - Empty topic arrays and absent licenses are normalized without throwing.
 *
 * Behavior recorded rather than changed: GitHub returns `spdx_id: "NOASSERTION"`
 * for a license file it cannot identify. Discoverability only checks whether a
 * license is present, so an unidentifiable license passes the check even though
 * a visitor still cannot tell what the terms are. Flagged as a scoring question.
 */

const {
  buildProfile,
  comprehensiveReadme,
  missingReadme,
  solidReadme,
  sparseReadme,
} = require("./builders.js");

module.exports = buildProfile({
  id: "unusual-metadata",
  summary:
    "Repository metadata shapes that only GitHub produces: a repository with no commits and a null push date, an unidentifiable license reported as NOASSERTION, and a name past the fifty-character limit.",
  repositories: [
    {
      name: "tessellate",
      note: "Ordinary well-presented repository, so the unusual cases are measured against a normal baseline.",
      description: "Generates seamless geometric tilings from a small set of edge-matching rules",
      language: "Rust",
      topics: ["geometry", "generative", "graphics"],
      license: "MIT",
      stars: 96,
      createdAt: "2024-10-08",
      pushedAt: "2026-07-14",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "pattern-studio",
      note: "License file GitHub cannot identify, reported as NOASSERTION and currently accepted as a license.",
      description: "Desktop editor for designing and exporting repeating surface patterns",
      language: "TypeScript",
      topics: ["design", "patterns", "desktop"],
      license: { spdx_id: "NOASSERTION" },
      homepage: "https://pattern-studio.example.dev",
      stars: 34,
      createdAt: "2025-01-30",
      pushedAt: "2026-05-26",
      pinned: true,
      readme: solidReadme(),
    },
    {
      name: "tiling-algorithms-reference-implementations-and-notes",
      note: "Name past fifty characters, which is flagged as hard to scan, remember, and type.",
      description: "Reference implementations of substitution and cut-and-project tiling algorithms",
      language: "Rust",
      topics: ["algorithms", "tiling", "reference"],
      license: "MIT",
      createdAt: "2023-06-11",
      pushedAt: "2026-01-09",
      readme: sparseReadme(),
    },
    {
      name: "tessellate-web",
      note: "Created but never pushed to, so GitHub reports a null push date and an updated date from creation.",
      language: "TypeScript",
      createdAt: "2026-08-19",
      pushedAt: null,
      readme: missingReadme(),
    },
  ],
});
