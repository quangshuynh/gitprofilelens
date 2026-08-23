/**
 * Persona: substantial, widely used projects with almost no presentation.
 *
 * Presentation conditions being modeled:
 * - Every repository is actively pushed and has real traction: thousands of
 *   stars and forks between them.
 * - Descriptions are absent, one word, or generic.
 * - Topics are missing everywhere and licenses are inconsistent.
 * - READMEs are missing or stubs.
 * - Nothing is pinned.
 *
 * This persona exists to prove a boundary the tool depends on: stars, forks,
 * and open issues are recorded but never scored. A repository that thousands of
 * people use still scores badly if a visitor cannot tell what it does. That is
 * the intended meaning of a presentation and discoverability score, and it is
 * why this persona must not outscore a smaller, well-presented profile.
 *
 * Nothing here implies the author is less capable than any other persona. The
 * opposite is the point: capability and presentation are measured separately,
 * and this tool only measures the second.
 */

const {
  buildProfile,
  missingReadme,
  shortReadme,
  sparseReadme,
} = require("./builders.js");

module.exports = buildProfile({
  id: "strong-work-weak-presentation",
  summary:
    "Actively maintained, heavily used projects with no descriptions, topics, or READMEs worth reading. Popularity metrics are ignored by scoring, so this profile lands below far smaller but better presented accounts.",
  repositories: [
    {
      name: "distributed-queue",
      note: "Most popular repository in the corpus, and still has no description or usable README.",
      language: "Go",
      license: "Apache-2.0",
      stars: 2100,
      forks: 187,
      openIssues: 43,
      createdAt: "2023-02-14",
      pushedAt: "2026-08-14",
      readme: shortReadme(),
    },
    {
      name: "pytorch-experiments",
      note: "No description, topics, license, or README: presentation floor despite steady use.",
      language: "Python",
      stars: 1400,
      forks: 96,
      openIssues: 21,
      createdAt: "2022-07-03",
      pushedAt: "2026-08-12",
      readme: missingReadme(),
    },
    {
      name: "fastcache",
      note: "One-word lowercase description: present, but explains nothing.",
      description: "cache",
      language: "Go",
      license: "MIT",
      stars: 890,
      forks: 54,
      openIssues: 12,
      createdAt: "2024-01-22",
      pushedAt: "2026-07-30",
      readme: shortReadme(),
    },
    {
      name: "tokenizer_rs",
      note: "Underscored name with a description too short to distinguish the project.",
      description: "Rust tokenizer",
      language: "Rust",
      topics: ["rust"],
      stars: 620,
      forks: 38,
      openIssues: 9,
      createdAt: "2024-09-09",
      pushedAt: "2026-06-25",
      readme: sparseReadme(),
    },
    {
      name: "vector-index",
      note: "Generic description that names a project type instead of a purpose.",
      description: "A tool",
      language: "C++",
      stars: 340,
      forks: 27,
      openIssues: 6,
      createdAt: "2025-03-17",
      pushedAt: "2026-08-02",
      readme: missingReadme(),
    },
  ],
});
