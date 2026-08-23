/**
 * Persona: a working developer who actively curates a public profile.
 *
 * Presentation conditions being modeled:
 * - Every repository has a specific, sentence-cased description.
 * - Pinned repositories are the three strongest projects.
 * - READMEs cover overview, setup, and usage; the strongest also show examples.
 * - Licenses and topics are present on anything intended for reuse.
 * - Nothing has gone stale: every repository was pushed within the last year.
 *
 * Deliberate imperfections, so this persona is a useful regression sentinel
 * rather than a saturated 100:
 * - `envelope` is a TypeScript CLI with no homepage, which discoverability
 *   penalizes as a web project missing a demo link.
 * - `dotfiles` is personal configuration with no license and a stub README.
 * - Two unpinned repositories score highly, which produces a pin suggestion.
 *
 * This models presentation and discoverability only. Nothing here asserts that
 * this account belongs to a better developer than any other persona.
 */

const {
  buildProfile,
  comprehensiveReadme,
  shortReadme,
  solidReadme,
} = require("./builders.js");

module.exports = buildProfile({
  id: "polished-professional",
  summary:
    "Curated public profile: specific descriptions, structured READMEs, licenses, topics, and recent activity. Scores high without reaching 100 because of one unlicensed personal repository and one library with no demo link.",
  repositories: [
    {
      name: "ledger-sync",
      note: "Flagship project: complete presentation metadata and a comprehensive README.",
      description: "Two-way sync engine that reconciles Stripe payouts against a Postgres ledger",
      language: "TypeScript",
      topics: ["stripe", "postgres", "fintech", "reconciliation"],
      license: "MIT",
      homepage: "https://ledger-sync.example.dev",
      stars: 210,
      forks: 18,
      openIssues: 4,
      createdAt: "2024-02-11",
      pushedAt: "2026-07-28",
      pinned: true,
      readme: comprehensiveReadme(),
    },
    {
      name: "schema-drift",
      note: "Second pinned project, presented to the same standard as the flagship.",
      description: "Detects breaking database schema changes in pull requests before they merge",
      language: "TypeScript",
      topics: ["postgres", "database", "migrations", "continuous-integration"],
      license: "Apache-2.0",
      homepage: "https://schema-drift.example.dev",
      stars: 96,
      forks: 7,
      openIssues: 2,
      createdAt: "2024-09-03",
      pushedAt: "2026-06-14",
      pinned: true,
      readme: comprehensiveReadme({ size: 3100 }),
    },
    {
      name: "queue-lens",
      note: "Third pin with a solid but example-free README, so README scores are not uniform.",
      description: "Observability dashboard for background job queues with per-worker latency traces",
      language: "TypeScript",
      topics: ["observability", "queues", "dashboard"],
      license: "MIT",
      homepage: "https://queue-lens.example.dev",
      stars: 41,
      forks: 3,
      createdAt: "2025-03-19",
      pushedAt: "2026-05-02",
      pinned: true,
      readme: solidReadme(),
    },
    {
      name: "envelope",
      note: "Strong unpinned repository, and a TypeScript CLI with no homepage: the web-demo heuristic penalizes it anyway.",
      description: "Command-line tool for encrypting environment files with age keys",
      language: "TypeScript",
      topics: ["cli", "encryption", "devops"],
      license: "MIT",
      stars: 33,
      createdAt: "2025-06-22",
      pushedAt: "2026-04-11",
      readme: solidReadme({ size: 1650 }),
    },
    {
      name: "receipt-ocr",
      note: "Strong unpinned repository in a second language, keeping language concentration realistic.",
      description: "Extracts line items from scanned receipts using Tesseract and a layout classifier",
      language: "Python",
      topics: ["ocr", "tesseract", "document-processing"],
      license: "MIT",
      stars: 58,
      forks: 6,
      createdAt: "2025-01-08",
      pushedAt: "2026-02-20",
      readme: solidReadme(),
    },
    {
      name: "dotfiles",
      note: "Personal configuration: well described but unlicensed with a stub README, which is the persona's weakest repository.",
      description: "Personal shell, editor, and terminal configuration managed with GNU Stow",
      language: "Shell",
      topics: ["dotfiles", "shell", "stow"],
      createdAt: "2023-11-30",
      pushedAt: "2026-08-01",
      readme: shortReadme(),
    },
  ],
});
