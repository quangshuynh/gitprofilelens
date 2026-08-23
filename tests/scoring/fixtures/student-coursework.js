/**
 * Persona: a student whose public account is mostly coursework.
 *
 * Presentation conditions being modeled:
 * - Repository names that announce a course, lab, or assignment.
 * - Descriptions that exist but stay short or generic.
 * - A couple of personal projects mixed in with the coursework.
 * - Forks of large open-source projects kept from class or contribution attempts.
 * - Uneven README and license coverage.
 * - Pins chosen early and never revisited, so one weak project stays pinned.
 *
 * Behaviors this persona is expected to expose:
 * - The clutter-name heuristic ("homework", "lab", "practice", "course").
 * - The weak-pinned-repository recommendation, driven by `weather-app`.
 * - Forks counting toward the portfolio-focus curation bonus while still being
 *   scored, and ranked, as if they were the account's own work.
 *
 * This models presentation and discoverability only. Coursework is not treated
 * as lesser work; it is treated as work whose naming and description make the
 * profile harder to read.
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
  id: "student-coursework",
  summary:
    "Coursework-dominated account: course-numbered names, thin descriptions, patchy READMEs and licenses, two forks, and an early pin that no longer represents the account's best work.",
  repositories: [
    {
      name: "cs101-homework-3",
      note: "Assignment repository with no description, topics, license, or README.",
      language: "Java",
      createdAt: "2025-10-04",
      pushedAt: "2025-12-10",
      readme: missingReadme(),
    },
    {
      name: "cs261-lab-4",
      note: "Lab repository whose description is too short to explain anything.",
      description: "Lab 4",
      language: "Java",
      createdAt: "2026-01-20",
      pushedAt: "2026-02-02",
      readme: missingReadme(),
    },
    {
      name: "data-structures-practice",
      note: "Well described, but the clutter-name heuristic flags 'practice'.",
      description: "Practice implementations of linked lists, trees, and hash tables for CS 261",
      language: "Java",
      topics: ["java", "data-structures"],
      createdAt: "2026-01-22",
      pushedAt: "2026-03-15",
      readme: sparseReadme(),
    },
    {
      name: "algorithms-course-notes",
      note: "Notes repository with no primary language, so it is excluded from language concentration.",
      description: "Course notes and worked examples from an undergraduate algorithms course",
      createdAt: "2025-09-12",
      pushedAt: "2026-04-28",
      readme: solidReadme(),
    },
    {
      name: "personal-portfolio",
      note: "Personal project, pinned first, with a demo link but no license.",
      description: "Personal portfolio site built with plain HTML and CSS",
      language: "HTML",
      topics: ["portfolio", "html"],
      homepage: "https://student-coursework.example.dev",
      createdAt: "2026-02-14",
      pushedAt: "2026-06-01",
      pinned: true,
      readme: sparseReadme(),
    },
    {
      name: "weather-app",
      note: "Pinned but weak: vague description, no topics, no license, no demo, stub README. Drives the weak-pin recommendation.",
      description: "Web app",
      language: "JavaScript",
      createdAt: "2026-03-30",
      pushedAt: "2026-05-20",
      pinned: true,
      readme: shortReadme(),
    },
    {
      name: "ml-teaching-notebooks",
      note: "Fork kept from a class exercise. Upstream presentation is strong, so it scores well as if it were original work.",
      description: "Teaching notebooks and exercises for an introductory machine learning course",
      language: "Python",
      topics: ["machine-learning", "notebooks", "education"],
      license: "MIT",
      fork: true,
      createdAt: "2024-02-18",
      pushedAt: "2024-03-02",
      updatedAt: "2025-02-18",
      readme: comprehensiveReadme(),
    },
    {
      name: "webapp-starter",
      note: "Abandoned fork from a contribution attempt: strong upstream presentation, three years without a push.",
      description: "Reference web application used to demonstrate dependency injection and testing layers",
      language: "Java",
      topics: ["java", "spring", "reference-application"],
      license: "Apache-2.0",
      fork: true,
      createdAt: "2023-05-01",
      pushedAt: "2023-05-10",
      readme: comprehensiveReadme(),
    },
  ],
});
