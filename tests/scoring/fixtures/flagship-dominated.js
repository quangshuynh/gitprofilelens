/**
 * Persona: one project took off, and nothing else was ever tidied up.
 *
 * Presentation conditions being modeled:
 * - A single flawlessly presented, heavily starred flagship, pinned alone.
 * - Seven neglected side projects: absent or placeholder descriptions, no
 *   topics or licenses, missing READMEs, and pushes stretching back six years.
 *
 * Behaviors this persona is expected to expose:
 * - Profile categories are the unweighted mean of every repository, so one
 *   perfect repository barely lifts a profile full of unpresented ones. Neither
 *   stars nor pin status add weight.
 * - No pin advice is produced at all: the pinned repository is strong, so there
 *   is nothing to unpin, and nothing unpinned is strong enough to suggest.
 * - Placeholder descriptions ("Demo") are penalized harder than short ones.
 */

const {
  buildProfile,
  comprehensiveReadme,
  missingReadme,
  shortReadme,
  sparseReadme,
} = require("./builders.js");

module.exports = buildProfile({
  id: "flagship-dominated",
  summary:
    "One perfectly presented flagship among seven neglected side projects. Demonstrates that averaging gives the flagship no extra weight for its stars or its pin, so the profile score tracks the neglected majority.",
  repositories: [
    {
      name: "promptkit",
      note: "The flagship: complete presentation metadata and the account's only maintained project.",
      description: "Composable prompt templating and evaluation toolkit for language model applications",
      language: "Python",
      topics: ["prompt-engineering", "llm", "evaluation", "python"],
      license: "MIT",
      homepage: "https://promptkit.example.dev",
      stars: 8400,
      forks: 592,
      openIssues: 114,
      createdAt: "2024-06-11",
      pushedAt: "2026-08-18",
      pinned: true,
      readme: comprehensiveReadme({ size: 7200, headingCount: 12 }),
    },
    {
      name: "blog",
      note: "No description, topics, license, or README, untouched for four years.",
      language: "JavaScript",
      createdAt: "2021-11-02",
      pushedAt: "2022-01-15",
      readme: missingReadme(),
    },
    {
      name: "chatbot-demo",
      note: "Placeholder description, which scores lower than a short but real one.",
      description: "Demo",
      language: "Python",
      createdAt: "2022-09-19",
      pushedAt: "2022-11-03",
      readme: missingReadme(),
    },
    {
      name: "todo-app",
      note: "Generic description and no metadata, six years without a push.",
      description: "A web app",
      language: "JavaScript",
      createdAt: "2020-08-04",
      pushedAt: "2020-09-11",
      readme: missingReadme(),
    },
    {
      name: "old-portfolio",
      note: "Retired but never archived, so it is scored as neglected rather than finished.",
      description: "Old portfolio site",
      language: "HTML",
      createdAt: "2020-12-28",
      pushedAt: "2021-02-14",
      readme: shortReadme(),
    },
    {
      name: "resume",
      note: "Short description and no supporting metadata.",
      description: "My resume",
      language: "HTML",
      createdAt: "2021-05-16",
      pushedAt: "2021-06-02",
      readme: missingReadme(),
    },
    {
      name: "scraper",
      note: "No description, but a README that at least introduces the project.",
      language: "Python",
      createdAt: "2023-03-05",
      pushedAt: "2023-04-20",
      readme: sparseReadme(),
    },
    {
      name: "notes",
      note: "No description, no language, no README: nothing to present at all.",
      createdAt: "2024-06-22",
      pushedAt: "2024-07-08",
      readme: missingReadme(),
    },
  ],
});
