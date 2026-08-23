/**
 * Persona: 112 repositories from someone who writes tools constantly.
 *
 * Presentation conditions being modeled:
 * - Six curated projects with complete metadata, three of them pinned.
 * - A long tail of 106 small command-line tools, each with a real description
 *   and a usable README, but with no topics and no license anywhere.
 * - Pushes spread evenly backwards over roughly five years, so every
 *   maintenance band is represented.
 *
 * Behaviors this persona is expected to expose:
 * - Recommendation ranking uses `severityWeight * 100 + affectedRepositories`,
 *   so a medium-severity issue affecting more than a hundred repositories
 *   outranks a high-severity one. No smaller persona can reach that boundary.
 * - The public GraphQL metadata query returns only the first 100 repositories,
 *   so the tail has no README metadata and scores a neutral 60 with an
 *   unverifiable `info` finding that must never reach recommendations.
 *
 * The long tail is generated rather than written out, because 106 hand-written
 * near-identical repositories would be less readable, not more. The generator
 * below is the fixture: every tool is `<subject>-<action>` with a description
 * built from the same two vocabularies.
 */

const {
  buildProfile,
  comprehensiveReadme,
  missingReadme,
  solidReadme,
} = require("./builders.js");

/** Number of small tools in the long tail. */
const SMALL_TOOL_COUNT = 106;

/** The public GraphQL metadata query returns README data for 100 repositories. */
const README_METADATA_LIMIT = 100;

/** Newest long-tail push, eleven days before the evaluation date. */
const NEWEST_TAIL_PUSH = Date.UTC(2026, 7, 10);

/** Roughly one small tool every two and a half weeks. */
const TAIL_PUSH_INTERVAL_DAYS = 18;

const DAY_IN_MILLISECONDS = 86400000;

const SUBJECTS = [
  ["json", "JSON documents"],
  ["csv", "CSV exports"],
  ["yaml", "YAML configuration files"],
  ["http", "HTTP request logs"],
  ["dns", "DNS zone files"],
  ["tcp", "TCP connection traces"],
  ["regex", "regular expressions"],
  ["cron", "cron schedules"],
  ["uuid", "identifier collections"],
  ["emoji", "emoji shortcode tables"],
  ["markdown", "Markdown documents"],
  ["ical", "calendar feeds"],
  ["sqlite", "SQLite databases"],
  ["redis", "Redis keyspaces"],
  ["s3", "object storage buckets"],
];

const ACTIONS = [
  ["diff", "Prints a readable structural diff between two sets of"],
  ["lint", "Checks formatting and common mistakes in"],
  ["dump", "Dumps a human-readable summary of"],
  ["bench", "Benchmarks read and write throughput for"],
  ["proxy", "Records and replays traffic for"],
  ["watch", "Watches for changes and reruns commands against"],
  ["fmt", "Formats and normalizes"],
  ["stat", "Reports size, shape, and cardinality statistics for"],
  ["gen", "Generates realistic sample"],
  ["sync", "Synchronizes two collections of"],
];

/** Language mix of the long tail, weighted towards a clear primary language. */
const LANGUAGES = ["Python", "Python", "Go", "Python", "JavaScript", "Python", "Shell", "Go", "Python", "Rust"];

/**
 * formats a long-tail push date
 * @param {number} index position in the long tail
 * @returns {string} iso date
 */
function tailPushDate(index) {
  return new Date(NEWEST_TAIL_PUSH - index * TAIL_PUSH_INTERVAL_DAYS * DAY_IN_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
}

/**
 * builds one small command-line tool in the long tail
 * @param {number} index position in the long tail
 * @returns {Object} repository fixture
 */
function buildSmallTool(index) {
  const [subject, noun] = SUBJECTS[index % SUBJECTS.length];
  const [action, phrase] = ACTIONS[Math.floor(index / SUBJECTS.length) % ACTIONS.length];

  return {
    name: `${subject}-${action}`,
    note: "Long-tail tool: described and documented, but with no topics or license.",
    description: `${phrase} ${noun}`,
    language: LANGUAGES[index % LANGUAGES.length],
    pushedAt: tailPushDate(index),
    // A handful were pushed before their author started writing READMEs.
    readme: index % 37 === 0 ? missingReadme() : solidReadme(),
  };
}

const FEATURED = [
  {
    name: "flowmeter",
    note: "Curated flagship with complete metadata.",
    description: "Measures and visualizes throughput of streaming data pipelines in real time",
    language: "Python",
    topics: ["streaming", "metrics", "observability"],
    license: "MIT",
    homepage: "https://flowmeter.example.dev",
    stars: 640,
    forks: 47,
    createdAt: "2023-04-18",
    pushedAt: "2026-08-16",
    pinned: true,
    readme: comprehensiveReadme(),
  },
  {
    name: "paperclip",
    note: "Second pin, curated to the same standard.",
    description: "Clipboard manager that syncs snippets across machines over SSH",
    language: "Go",
    topics: ["clipboard", "cli", "synchronization"],
    license: "MIT",
    homepage: "https://paperclip.example.dev",
    stars: 288,
    createdAt: "2024-01-09",
    pushedAt: "2026-07-29",
    pinned: true,
    readme: comprehensiveReadme(),
  },
  {
    name: "tabula",
    note: "Third pin.",
    description: "Renders aligned text tables from streaming input without buffering",
    language: "Rust",
    topics: ["cli", "formatting", "rust"],
    license: "MIT",
    stars: 155,
    createdAt: "2024-08-23",
    pushedAt: "2026-07-06",
    pinned: true,
    readme: solidReadme(),
  },
  {
    name: "hookshot",
    note: "Curated but unpinned, so pin advice has candidates outside the long tail.",
    description: "Webhook receiver that replays and filters deliveries during development",
    language: "Go",
    topics: ["webhooks", "developer-tools", "testing"],
    license: "Apache-2.0",
    stars: 96,
    createdAt: "2025-02-11",
    pushedAt: "2026-06-13",
    readme: comprehensiveReadme(),
  },
  {
    name: "dotpath",
    note: "Curated but unpinned.",
    description: "Reads and writes nested configuration values using dotted path expressions",
    language: "Python",
    topics: ["configuration", "cli", "python"],
    license: "MIT",
    stars: 62,
    createdAt: "2025-06-04",
    pushedAt: "2026-05-27",
    readme: solidReadme(),
  },
  {
    name: "chronograph",
    note: "Curated but unpinned.",
    description: "Times shell commands and reports percentile latency across repeated runs",
    language: "Rust",
    topics: ["benchmarking", "cli", "performance"],
    license: "MIT",
    stars: 44,
    createdAt: "2025-10-15",
    pushedAt: "2026-04-08",
    readme: solidReadme(),
  },
];

const ALL_REPOSITORIES = [
  ...FEATURED,
  ...Array.from({ length: SMALL_TOOL_COUNT }, (unused, index) => buildSmallTool(index)),
];

module.exports = buildProfile({
  id: "prolific-account",
  summary:
    "112 repositories: six curated projects and a long tail of small tools that are described and documented but carry no topics or licenses. Crosses the hundred-repository boundary where widespread medium-severity advice outranks high-severity advice, and where the README metadata query stops returning data.",
  repositories: ALL_REPOSITORIES.map((repository, index) => {
    if (index < README_METADATA_LIMIT) return repository;
    // Beyond the metadata limit README status is unknown, not absent.
    const { readme, ...withoutReadme } = repository;
    return {
      ...withoutReadme,
      note: "Beyond the hundred-repository metadata limit, so its README status cannot be verified.",
    };
  }),
});
