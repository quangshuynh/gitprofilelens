/**
 * Edge case: a normal account audited without the serverless metadata endpoint.
 *
 * This is the GitHub Pages deployment described in the project README, and it is
 * also what every visitor sees whenever `/api/pinned-repositories` fails. The
 * public REST data still arrives, so descriptions, topics, licenses, names, and
 * push dates all score normally, but README contents and pinned state are
 * unknown.
 *
 * Behaviors this profile is expected to protect:
 * - Unknown README status scores a neutral 60 and produces an `info` finding,
 *   never a "no root README" claim the tool cannot support.
 * - `info` findings are excluded from recommendations, so this profile receives
 *   no README advice of any kind.
 * - Unknown pin state suppresses every pin recommendation. Advising someone to
 *   pin or unpin work without knowing what is currently pinned would be wrong,
 *   and this is the only profile in the corpus that proves the suppression.
 *
 * The account itself is unremarkable on purpose: the interesting variable is the
 * deployment, not the person.
 */

const { buildProfile } = require("./builders.js");

module.exports = buildProfile({
  id: "unverified-metadata",
  summary:
    "A normally presented account audited where README and pin metadata are unavailable. Every README scores a neutral 60 with an unverifiable info finding, and all pin advice is suppressed because pinned state is unknown.",
  supplementalMetadata: false,
  repositories: [
    {
      name: "tidepool",
      note: "Well presented on the public REST data alone, so only README status is unknown.",
      description: "Tide and current forecasting service for coastal sailing routes",
      language: "Python",
      topics: ["forecasting", "marine", "api"],
      license: "MIT",
      homepage: "https://tidepool.example.dev",
      stars: 74,
      createdAt: "2024-03-08",
      pushedAt: "2026-07-19",
    },
    {
      name: "chartplot",
      note: "Web project with a demo link, so discoverability is unaffected by the missing metadata.",
      description: "Renders nautical charts and planned routes in the browser from GeoJSON",
      language: "TypeScript",
      topics: ["charts", "geojson", "visualization"],
      license: "MIT",
      homepage: "https://chartplot.example.dev",
      stars: 41,
      createdAt: "2024-11-14",
      pushedAt: "2026-06-05",
    },
    {
      name: "buoy-feed",
      note: "Missing license and topics still score normally without the metadata endpoint.",
      description: "Polls public weather buoy stations and republishes readings as a JSON feed",
      language: "Python",
      createdAt: "2025-05-21",
      pushedAt: "2026-04-02",
    },
    {
      name: "knot",
      note: "Short description, so description advice is unaffected by the missing metadata.",
      description: "Speed conversions",
      language: "Python",
      topics: ["units", "conversion"],
      license: "MIT",
      createdAt: "2025-09-30",
      pushedAt: "2026-02-11",
    },
    {
      name: "logbook",
      note: "Stale enough to earn maintenance advice, which does not depend on supplemental metadata.",
      description: "Command-line sailing logbook that exports voyages to GPX and Markdown",
      language: "Go",
      topics: ["cli", "logging", "gpx"],
      license: "Apache-2.0",
      createdAt: "2022-01-17",
      pushedAt: "2023-02-24",
    },
  ],
});
