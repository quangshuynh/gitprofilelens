/**
 * Persona: a long career kept tidy by archiving instead of deleting.
 *
 * Presentation conditions being modeled:
 * - Four active, well-presented TypeScript projects, three of them pinned.
 * - Six archived repositories spanning 2018 to 2022, retired deliberately.
 * - Archived presentation varies, because it reflects the standards of the year
 *   each project was retired rather than today's.
 *
 * Behaviors this persona is expected to expose:
 * - Archived repositories score a flat 85 for maintenance no matter how old,
 *   because archiving states that a project is finished rather than neglected.
 * - Archived repositories are excluded from language concentration but count
 *   toward the portfolio-focus curation bonus, which is the intended reading of
 *   archiving as a curation act.
 * - Archived repositories are never suggested as pin candidates.
 * - Archived repositories still generate high-severity advice about their
 *   descriptions and READMEs, which is flagged rather than changed here.
 */

const {
  buildProfile,
  comprehensiveReadme,
  missingReadme,
  shortReadme,
  solidReadme,
  sparseReadme,
} = require("./builders.js");

module.exports = buildProfile({
  id: "archive-heavy",
  summary:
    "Four active TypeScript projects plus six deliberately archived predecessors. Archiving holds maintenance at 85 regardless of age and drives the highest portfolio-focus score in the corpus, while archived repositories still attract advice about work their owner has retired.",
  repositories: [
    {
      name: "stream-router",
      note: "Current flagship: complete metadata and a comprehensive README.",
      description: "Routes and replays event streams between Kafka topics with backpressure control",
      language: "TypeScript",
      topics: ["kafka", "streaming", "event-driven"],
      license: "MIT",
      homepage: "https://stream-router.example.dev",
      stars: 340,
      forks: 22,
      createdAt: "2024-05-06",
      pushedAt: "2026-07-10",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "config-lint",
      note: "Active project with a solid but example-free README.",
      description: "Validates deployment configuration against schema and policy rules before rollout",
      language: "TypeScript",
      topics: ["configuration", "linter", "policy"],
      license: "MIT",
      homepage: "https://config-lint.example.dev",
      stars: 118,
      createdAt: "2025-01-19",
      pushedAt: "2026-06-02",
      pinned: true,
      readme: solidReadme(),
    },
    {
      name: "edge-cache",
      note: "Third pin, keeping active language concentration at a single language.",
      description: "Cache layer that serves stale responses while revalidating at the edge",
      language: "TypeScript",
      topics: ["caching", "edge", "performance"],
      license: "Apache-2.0",
      homepage: "https://edge-cache.example.dev",
      stars: 76,
      createdAt: "2025-08-27",
      pushedAt: "2026-05-18",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "bench-suite",
      note: "Strong unpinned repository, so pin advice has an active candidate to prefer over any archive.",
      description: "Reproducible benchmark harness that compares release builds across commits",
      language: "TypeScript",
      topics: ["benchmarking", "performance", "tooling"],
      license: "MIT",
      createdAt: "2025-11-04",
      pushedAt: "2026-04-01",
      readme: solidReadme(),
    },
    {
      name: "legacy-api-gateway",
      note: "Archived in good order: full metadata and a comprehensive README, retired five years ago.",
      description: "API gateway with request signing, rate limiting, and per-tenant routing rules",
      language: "Go",
      topics: ["api-gateway", "go", "rate-limiting"],
      license: "Apache-2.0",
      archived: true,
      stars: 210,
      createdAt: "2019-01-15",
      pushedAt: "2021-03-04",
      readme: comprehensiveReadme(),
    },
    {
      name: "deprecated-cli",
      note: "Description opens with a status label, which the description rules ask users to move into archive settings.",
      description: "(deprecated) Command-line client for the version one public API",
      language: "Go",
      topics: ["cli", "deprecated"],
      license: "MIT",
      archived: true,
      createdAt: "2020-04-11",
      pushedAt: "2022-02-08",
      readme: solidReadme(),
    },
    {
      name: "old-dashboard",
      note: "Archived web project: the missing-demo rule is skipped for archives, but missing topics and license are not.",
      description: "Dashboard",
      language: "JavaScript",
      archived: true,
      createdAt: "2019-03-22",
      pushedAt: "2020-06-15",
      readme: sparseReadme(),
    },
    {
      name: "prototype-scheduler",
      note: "Archived prototype with a real description but thin supporting metadata.",
      description: "Prototype scheduler exploring fair-share allocation across tenant workloads",
      language: "Python",
      topics: ["scheduling", "prototype"],
      archived: true,
      createdAt: "2019-06-30",
      pushedAt: "2019-11-20",
      readme: shortReadme(),
    },
    {
      name: "experiments-2019",
      note: "Archived scratch repository: short description, no metadata, stub README.",
      description: "Assorted experiments",
      language: "Python",
      archived: true,
      createdAt: "2019-01-08",
      pushedAt: "2019-08-12",
      readme: shortReadme(),
    },
    {
      name: "first-startup-backend",
      note: "Archived eight years ago with no description or README. Still generates high-severity advice about work its owner has retired.",
      language: "Ruby",
      archived: true,
      createdAt: "2017-09-14",
      pushedAt: "2018-05-30",
      readme: missingReadme(),
    },
  ],
});
