#!/usr/bin/env node
/**
 * captures the README screenshots from the real running interface
 *
 * The page, styles, and scripts are the ones in this repository, served exactly
 * as a static host would serve them. Only the network boundary is replaced: every
 * GitHub request and every GitProfileLens API request is answered from the
 * fictional demonstration profile below, so a screenshot never shows a real
 * person's account, a token, or a private repository.
 *
 * Usage:
 *   npm run screenshots                      # writes docs/images/screenshots/*.png
 *   node scripts/capture-screenshots.js --out <dir> [--only home,overview]
 *
 * Requires a local Chrome or Chromium (set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to
 * point at one explicitly). Fonts load from Google Fonts when the machine is
 * online; offline captures fall back to system fonts.
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright-core");

const projectRoot = path.resolve(__dirname, "..");
const DEMO_LOGIN = "riley-demo";
const AVATAR_ORIGIN = "https://avatars.demo.invalid";

const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1024, height: 768 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

/* --------------------------------------------------------------------------
 * Fictional demonstration data
 * ------------------------------------------------------------------------ */

const profile = {
  login: DEMO_LOGIN,
  name: "Riley Demo",
  type: "User",
  avatar_url: `${AVATAR_ORIGIN}/${DEMO_LOGIN}.svg`,
  html_url: `https://github.com/${DEMO_LOGIN}`,
  public_repos: 8,
  followers: 14,
  following: 18,
};

function demoRepository(name, fields) {
  return {
    name,
    full_name: `${DEMO_LOGIN}/${name}`,
    html_url: `https://github.com/${DEMO_LOGIN}/${name}`,
    description: null,
    homepage: null,
    language: null,
    topics: [],
    license: null,
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    archived: false,
    fork: false,
    private: false,
    created_at: "2025-02-01T00:00:00Z",
    updated_at: "2026-10-20T00:00:00Z",
    pushed_at: "2026-10-20T00:00:00Z",
    ...fields,
  };
}

const repositories = [
  demoRepository("pixel-forge", {
    description: "Browser-based sprite editor with layers, onion skinning, and PNG export",
    homepage: "https://pixel-forge.demo.invalid",
    language: "TypeScript",
    topics: ["sprite-editor", "canvas", "pixel-art"],
    license: { spdx_id: "MIT" },
    stargazers_count: 128,
    forks_count: 14,
    created_at: "2025-06-01T00:00:00Z",
  }),
  demoRepository("tidy-ledger", {
    description: "Personal finance tracker that categorizes bank CSV exports",
    language: "Python",
    topics: ["finance", "csv", "cli"],
    license: { spdx_id: "Apache-2.0" },
    stargazers_count: 42,
    forks_count: 3,
    created_at: "2025-03-11T00:00:00Z",
  }),
  demoRepository("path-tracer", {
    description: "Physically based path tracer with BVH acceleration, written in Rust",
    language: "Rust",
    topics: ["graphics", "raytracing"],
    license: { spdx_id: "MIT" },
    stargazers_count: 67,
    forks_count: 5,
    created_at: "2024-11-02T00:00:00Z",
  }),
  demoRepository("portfolio-site", {
    description: "Personal site and blog built with Astro",
    homepage: "https://riley.demo.invalid",
    language: "Astro",
    topics: ["portfolio"],
    stargazers_count: 4,
    created_at: "2025-01-20T00:00:00Z",
  }),
  demoRepository("weather-cli", {
    description: "CLI for hourly forecasts",
    language: "Go",
    stargazers_count: 9,
    created_at: "2023-09-01T00:00:00Z",
    updated_at: "2024-02-01T00:00:00Z",
    pushed_at: "2024-02-01T00:00:00Z",
  }),
  demoRepository("ml-notebooks", {
    description: "notebooks",
    language: "Jupyter Notebook",
    archived: true,
    created_at: "2023-01-15T00:00:00Z",
    updated_at: "2023-06-01T00:00:00Z",
    pushed_at: "2023-06-01T00:00:00Z",
  }),
  demoRepository("dotfiles", {
    language: "Shell",
    created_at: "2022-08-01T00:00:00Z",
  }),
  demoRepository("awesome-shaders", {
    description: "A curated list of shader tutorials and tools",
    fork: true,
    topics: ["shaders", "awesome-list"],
    license: { spdx_id: "CC0-1.0" },
    created_at: "2024-04-01T00:00:00Z",
  }),
];

function readme(fields) {
  return {
    present: true,
    size: 2400,
    sections: { overview: true, installation: true, usage: true, examples: true, contributing: false },
    hasCodeBlock: true,
    hasImage: true,
    headingCount: 7,
    ...fields,
  };
}

const readmes = {
  "pixel-forge": readme({ size: 5200, sections: { overview: true, installation: true, usage: true, examples: true, contributing: true } }),
  "tidy-ledger": readme({ hasImage: false }),
  "path-tracer": readme({ size: 3100, sections: { overview: true, installation: true, usage: true, examples: false, contributing: false } }),
  "portfolio-site": readme({ size: 900, hasCodeBlock: false, hasImage: false, headingCount: 2, sections: { overview: true, installation: false, usage: false, examples: false, contributing: false } }),
  "weather-cli": readme({ size: 600, hasImage: false, headingCount: 2, sections: { overview: true, installation: true, usage: false, examples: false, contributing: false } }),
  "ml-notebooks": { present: false, size: 0, sections: {}, hasCodeBlock: false, hasImage: false, headingCount: 0 },
  dotfiles: { present: false, size: 0, sections: {}, hasCodeBlock: false, hasImage: false, headingCount: 0 },
  "awesome-shaders": readme({ size: 8200, hasCodeBlock: false }),
};

const contributions = [
  {
    owner: "open-canvas", name: "brushkit", full_name: "open-canvas/brushkit",
    url: "https://github.com/open-canvas/brushkit", description: "Pressure-sensitive brush engine",
    primary_language: "TypeScript", stars: 830, forks: 61,
    contribution: { pull_requests: 5, merged_pull_requests: 4 },
  },
];

const FIRST_NAMES = [
  "ana", "ben", "cleo", "dev", "eli", "fern", "gus", "hana", "ivo", "jun", "kai", "lena",
  "milo", "nora", "otto", "pia", "quin", "rosa", "sol", "teo", "uma", "vik",
];
const demoAccounts = FIRST_NAMES.map((name) => `${name}-demo`);
// Eighteen followed, fourteen followers, ten of them mutual: eight followed
// accounts do not appear among the followers.
const following = demoAccounts.slice(0, 18);
const followers = [...demoAccounts.slice(0, 10), ...demoAccounts.slice(18, 22)];

function relationshipEntry(login) {
  return {
    login,
    html_url: `https://github.com/${login}`,
    avatar_url: `${AVATAR_ORIGIN}/${login}.svg`,
  };
}

/**
 * draws a deterministic monogram avatar so no real face or account appears
 * @param {string} login account login
 * @returns {string} svg document
 */
function avatarSvg(login) {
  let hash = 0;
  for (const character of login) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const initial = login.charAt(0).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
    `<rect width="120" height="120" fill="hsl(${hue} 32% 22%)"/>` +
    `<text x="60" y="76" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="48" ` +
    `font-weight="600" fill="hsl(${hue} 70% 82%)">${initial}</text></svg>`;
}

/* --------------------------------------------------------------------------
 * Network boundary
 * ------------------------------------------------------------------------ */

async function installDemoRoutes(page, session) {
  await page.route(`${AVATAR_ORIGIN}/**`, (route) => {
    const login = path.basename(new URL(route.request().url()).pathname, ".svg");
    route.fulfill({ contentType: "image/svg+xml", body: avatarSvg(login) });
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: session }));
  await page.route(`https://api.github.com/users/${DEMO_LOGIN}`, (route) => route.fulfill({ json: profile }));
  await page.route(`https://api.github.com/users/${DEMO_LOGIN}/repos**`, (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page") || 1);
    route.fulfill({ json: pageNumber === 1 ? repositories : [] });
  });
  await page.route(`**/api/pinned-repositories?username=${DEMO_LOGIN}`, (route) => route.fulfill({
    json: {
      repositories: ["path-tracer", "weather-cli", "awesome-shaders", "dotfiles"],
      readmes,
      account: { type: "User" },
    },
  }));
  await page.route(`**/api/report?user=${DEMO_LOGIN}`, (route) =>
    route.fulfill({ json: { contributed_repositories: contributions } }));
  for (const [relationship, logins] of [["followers", followers], ["following", following]]) {
    await page.route(`https://api.github.com/users/${DEMO_LOGIN}/${relationship}**`, (route) => {
      const pageNumber = Number(new URL(route.request().url()).searchParams.get("page") || 1);
      route.fulfill({ json: pageNumber === 1 ? logins.map(relationshipEntry) : [] });
    });
  }
}

const SIGNED_OUT = { authenticated: false };
const SIGNED_IN = {
  authenticated: true,
  user: { login: DEMO_LOGIN, avatar_url: `${AVATAR_ORIGIN}/${DEMO_LOGIN}.svg` },
  can_manage_follows: true,
};

/* --------------------------------------------------------------------------
 * Shots
 * ------------------------------------------------------------------------ */

async function waitForResults(page) {
  await page.locator("#result-section").waitFor({ state: "visible" });
}

async function waitForNetwork(page) {
  await page.locator("#network-results").waitFor({ state: "visible" });
}

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(250);
}

const SHOTS = [
  {
    name: "home", viewport: "desktop", session: SIGNED_OUT, url: "/",
    ready: (page) => page.locator("#username").waitFor({ state: "visible" }),
  },
  {
    name: "home-signed-in", viewport: "desktop", session: SIGNED_IN, url: "/",
    ready: async (page) => {
      await page.locator("#home-signed-in-auth").waitFor({ state: "visible" });
      // The signed-in login fills the untouched username field.
      await page.waitForFunction((login) => document.querySelector("#username")?.value === login, DEMO_LOGIN);
    },
  },
  { name: "overview", viewport: "desktop", session: SIGNED_IN, url: `/?user=${DEMO_LOGIN}`, ready: waitForResults },
  { name: "audit", viewport: "desktop", session: SIGNED_IN, url: `/?user=${DEMO_LOGIN}&view=audit`, ready: waitForResults },
  {
    name: "repositories", viewport: "desktop", session: SIGNED_IN,
    url: `/?user=${DEMO_LOGIN}&view=repositories`, ready: waitForResults,
  },
  { name: "network", viewport: "desktop", session: SIGNED_IN, url: `/?user=${DEMO_LOGIN}&view=network`, ready: waitForNetwork },
  {
    name: "non-followers", viewport: "desktop", session: SIGNED_IN,
    url: `/?user=${DEMO_LOGIN}&view=network`,
    ready: async (page) => {
      await waitForNetwork(page);
      await page.locator("#network-unreciprocated-section").scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const section = document.querySelector("#network-unreciprocated-section");
        window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - 96 });
      });
    },
  },
  {
    name: "manage-unfollows", viewport: "desktop", session: SIGNED_IN,
    url: `/?user=${DEMO_LOGIN}&view=network`,
    ready: async (page) => {
      await waitForNetwork(page);
      await page.locator("#network-manage-unfollows").click();
      await page.locator("#network-manager").waitFor({ state: "visible" });
      await page.locator('.manager-row[data-login="kai-demo"] .manager-unfollow').click();
      await page.evaluate(() => window.scrollTo({ top: 0 }));
    },
  },
  { name: "tablet-overview", viewport: "tablet", session: SIGNED_IN, url: `/?user=${DEMO_LOGIN}`, ready: waitForResults },
  { name: "mobile-home", viewport: "mobile", session: SIGNED_OUT, url: "/", ready: (page) => page.locator("#username").waitFor() },
  { name: "mobile-network", viewport: "mobile", session: SIGNED_IN, url: `/?user=${DEMO_LOGIN}&view=network`, ready: waitForNetwork },
];

/* --------------------------------------------------------------------------
 * Runner
 * ------------------------------------------------------------------------ */

function serveProjectFile(request, response) {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filename = path.resolve(projectRoot, relativePath);
  if (!filename.startsWith(`${projectRoot}${path.sep}`) || relativePath.startsWith("api/")) {
    response.writeHead(404).end("Not found");
    return;
  }
  fs.readFile(filename, (error, content) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    const types = {
      ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
      ".png": "image/png", ".svg": "image/svg+xml",
    };
    response.setHeader("Content-Type", types[path.extname(filename)] || "application/octet-stream");
    response.end(content);
  });
}

function readArguments(argv) {
  const options = { out: path.join(projectRoot, "docs", "images", "screenshots"), only: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out") options.out = path.resolve(argv[++index]);
    else if (argv[index] === "--only") options.only = new Set(argv[++index].split(","));
  }
  return options;
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  if (!chromePath) throw new Error("No Chrome or Chromium executable found.");
  fs.mkdirSync(options.out, { recursive: true });

  const server = http.createServer(serveProjectFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });

  try {
    for (const shot of SHOTS) {
      if (options.only && !options.only.has(shot.name)) continue;
      const context = await browser.newContext({
        viewport: VIEWPORTS[shot.viewport],
        deviceScaleFactor: 1,
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await installDemoRoutes(page, shot.session);
      await page.goto(`${baseUrl}${shot.url}`);
      await shot.ready(page);
      await settle(page);
      const file = path.join(options.out, `${shot.name}.png`);
      await page.screenshot({ path: file });
      await context.close();
      console.log(`captured ${path.relative(projectRoot, file)}`);
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { installDemoRoutes, serveProjectFile, chromeCandidates, SIGNED_IN, SIGNED_OUT, DEMO_LOGIN };
