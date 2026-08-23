/**
 * Persona: the maintainer of a small open-source project family.
 *
 * Presentation conditions being modeled:
 * - A ten-year-old flagship that is still actively pushed.
 * - Satellite repositories that share the flagship's naming convention.
 * - All six pin slots used, because the maintainer curates the profile page.
 * - Community health files kept in a `.github` repository.
 * - A specification repository with no primary language.
 * - One archived predecessor from a previous major version.
 *
 * Behaviors this persona is expected to expose:
 * - Pin suggestions are suppressed once six repositories are pinned, even when
 *   strong unpinned work exists. `hexline-rfcs` is that unpinned work.
 * - A description longer than 160 characters is flagged as hard to scan, which
 *   no other persona covers.
 * - Age is not staleness: a repository created in 2016 and pushed this year
 *   scores full marks for maintenance.
 */

const {
  buildProfile,
  comprehensiveReadme,
  solidReadme,
} = require("./builders.js");

module.exports = buildProfile({
  id: "oss-maintainer",
  summary:
    "A maintained project family using all six pin slots, which suppresses pin suggestions despite strong unpinned work. Covers the over-long description rule and confirms that a decade-old repository pushed this year is not treated as stale.",
  repositories: [
    {
      name: "hexline",
      note: "Ten-year-old flagship, still active. Its description runs past 160 characters, which is flagged as hard to scan.",
      description:
        "Streaming line-oriented data processing library with a pluggable transform pipeline, backpressure-aware sinks, structured error reporting, and first-class support for resumable batch jobs",
      language: "TypeScript",
      topics: ["streaming", "data-processing", "pipeline", "typescript"],
      license: "Apache-2.0",
      homepage: "https://hexline.example.dev",
      stars: 4800,
      forks: 312,
      openIssues: 87,
      createdAt: "2016-04-02",
      pushedAt: "2026-08-15",
      pinned: true,
      readme: comprehensiveReadme({ size: 9400, headingCount: 14 }),
    },
    {
      name: "hexline-cli",
      note: "Companion CLI presented to the same standard as the flagship.",
      description: "Command-line runner for Hexline pipelines with watch mode and structured logs",
      language: "TypeScript",
      topics: ["cli", "streaming", "developer-tools"],
      license: "Apache-2.0",
      homepage: "https://hexline.example.dev/cli",
      stars: 610,
      forks: 41,
      openIssues: 12,
      createdAt: "2018-02-19",
      pushedAt: "2026-08-04",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "hexline-docs",
      note: "Documentation site, pinned so newcomers find it before the source repositories.",
      description: "Guides, API reference, and migration notes for the Hexline project family",
      language: "TypeScript",
      topics: ["documentation", "static-site"],
      license: "Apache-2.0",
      homepage: "https://hexline.example.dev/docs",
      stars: 94,
      createdAt: "2019-05-30",
      pushedAt: "2026-07-22",
      pinned: true,
      readme: solidReadme(),
    },
    {
      name: "hexline-plugin-sdk",
      note: "Extension surface with contribution guidance in its README.",
      description: "Typed plugin authoring kit with lifecycle hooks and a conformance test suite",
      language: "TypeScript",
      topics: ["plugins", "sdk", "typescript"],
      license: "Apache-2.0",
      homepage: "https://hexline.example.dev/plugins",
      stars: 205,
      forks: 33,
      openIssues: 8,
      createdAt: "2020-10-12",
      pushedAt: "2026-06-19",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "hexline-devtools",
      note: "Browser tooling, pinned fifth.",
      description: "Browser devtools panel for inspecting live Hexline pipeline stages and buffers",
      language: "TypeScript",
      topics: ["devtools", "debugging", "observability"],
      license: "Apache-2.0",
      homepage: "https://hexline.example.dev/devtools",
      stars: 132,
      createdAt: "2021-08-07",
      pushedAt: "2026-05-11",
      pinned: true,
      readme: solidReadme(),
    },
    {
      name: "hexline-examples",
      note: "Sixth and final pin, which fills the pin slots and suppresses further pin suggestions.",
      description: "Runnable example pipelines covering ingest, enrichment, and export scenarios",
      language: "TypeScript",
      topics: ["examples", "tutorials", "streaming"],
      license: "Apache-2.0",
      homepage: "https://hexline.example.dev/examples",
      stars: 71,
      createdAt: "2022-03-28",
      pushedAt: "2026-04-30",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "hexline-rfcs",
      note: "Strong unpinned work with no primary language. Would be suggested as a pin candidate if the six pin slots were not already full.",
      description: "Design proposals and accepted specifications for future Hexline releases",
      topics: ["rfc", "design", "governance"],
      stars: 88,
      openIssues: 19,
      createdAt: "2021-01-25",
      pushedAt: "2026-08-09",
      readme: solidReadme(),
    },
    {
      name: ".github",
      note: "Community health repository: well described but undiscoverable, since topics and a license make no sense for it.",
      description: "Issue templates, contribution guidelines, and community health files for Hexline",
      createdAt: "2020-06-14",
      pushedAt: "2026-03-17",
      readme: solidReadme(),
    },
    {
      name: "hexline-v1",
      note: "Archived predecessor, kept readable for users still on the old major version.",
      description: "Archived version one of Hexline, superseded by the current streaming pipeline API",
      language: "JavaScript",
      topics: ["streaming", "legacy"],
      license: "Apache-2.0",
      archived: true,
      stars: 1200,
      createdAt: "2016-04-02",
      pushedAt: "2021-09-08",
      readme: comprehensiveReadme(),
    },
  ],
});
