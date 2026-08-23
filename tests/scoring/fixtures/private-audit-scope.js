/**
 * Edge case: the authenticated audit of authorized repositories.
 *
 * `loadPrivateRepositories` in script.js scores a different repository set from
 * the public audit: the repositories the signed-in user authorized through the
 * GitHub App, which mixes private repositories with public ones the installation
 * covers. It builds supplemental metadata as `{ pinnedRepositories: [], readmes }`
 * because pinned state is a property of the public profile page and is not
 * fetched in this mode.
 *
 * Behaviors this profile is expected to protect:
 * - Private repositories are scored by exactly the same rules as public ones.
 *   Privacy changes which repositories are in scope, never how they are judged.
 * - Private and public repositories coexist in one authenticated audit without
 *   the private ones leaking into any public scoring path.
 *
 * Behavior recorded rather than changed: because pinned state is forced to an
 * empty list, every repository reads as explicitly unpinned, so strong private
 * repositories are offered as pin candidates with advice about "the work you
 * want visitors to notice first". A private repository cannot be pinned to a
 * public profile. Flagged as a scoring question.
 */

const {
  buildProfile,
  comprehensiveReadme,
  missingReadme,
  solidReadme,
} = require("./builders.js");

module.exports = buildProfile({
  id: "private-audit-scope",
  summary:
    "An authenticated audit of four private and two public authorized repositories. Private work is scored by the same rules as public work, and the forced-empty pin list makes strong private repositories read as pin candidates.",
  repositories: [
    {
      name: "billing-core",
      note: "Private service presented to a high standard, which makes it a pin candidate despite being unpinnable.",
      description: "Subscription billing engine with proration, dunning, and revenue reporting",
      language: "TypeScript",
      topics: ["billing", "payments", "typescript"],
      license: "MIT",
      private: true,
      createdAt: "2024-07-15",
      pushedAt: "2026-08-12",
      readme: comprehensiveReadme(),
    },
    {
      name: "billing-admin",
      note: "Second well-presented private repository.",
      description: "Internal administration console for reviewing and correcting billing runs",
      language: "TypeScript",
      topics: ["admin", "billing", "internal"],
      license: "MIT",
      private: true,
      createdAt: "2024-09-02",
      pushedAt: "2026-07-24",
      readme: solidReadme(),
    },
    {
      name: "infra",
      note: "Private repository with no description or README, which scores exactly as a public one would.",
      language: "HCL",
      private: true,
      createdAt: "2023-11-06",
      pushedAt: "2026-06-30",
      readme: missingReadme(),
    },
    {
      name: "spike-pricing-model",
      note: "Private experiment, deliberately rough, matching how private work is often kept.",
      description: "Pricing model spike",
      language: "Python",
      private: true,
      createdAt: "2026-02-19",
      pushedAt: "2026-03-11",
      readme: missingReadme(),
    },
    {
      name: "openapi-tools",
      note: "Public repository inside the same installation, so both visibilities appear in one audit.",
      description: "Generates typed clients and fixtures from OpenAPI documents",
      language: "TypeScript",
      topics: ["openapi", "codegen", "typescript"],
      license: "Apache-2.0",
      homepage: "https://openapi-tools.example.dev",
      stars: 112,
      createdAt: "2024-02-27",
      pushedAt: "2026-08-01",
      readme: comprehensiveReadme(),
    },
    {
      name: "status-page",
      note: "Second public repository in the installation.",
      description: "Static status page that renders incident history from a JSON feed",
      language: "TypeScript",
      topics: ["status-page", "incidents"],
      license: "MIT",
      homepage: "https://status.example.dev",
      stars: 28,
      createdAt: "2025-04-13",
      pushedAt: "2026-05-09",
      readme: solidReadme(),
    },
  ],
});
