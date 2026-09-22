#!/usr/bin/env node
/**
 * Structural performance diagnostics for the browser application.
 *
 * Every number here is a *count*, not a duration: requests issued, DOM nodes
 * created, elements rebuilt, storage writes performed. Counts are deterministic,
 * so a change in one is always a change in behavior, whereas a millisecond
 * measurement on a developer machine mostly reports what else the machine was
 * doing. Wall-clock timings are printed for orientation and are explicitly
 * labelled as informational.
 *
 * It drives the real page against mocked GitHub responses through the same static
 * server the browser tests use, so it measures the shipped application rather than
 * a model of it.
 *
 * A non-zero exit means the diagnostic could not run, never that a measurement
 * regressed. `tests/browser.test.js` owns the assertions.
 *
 *   npm run eval:performance                 the live-shaped and large scenarios
 *   npm run eval:performance -- --scenario large
 */

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.error("playwright-core is not installed; run npm install first.");
  process.exit(1);
}

const CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

/** A transparent 1-pixel avatar, so no scenario depends on a network image. */
const AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3C/svg%3E";

/** README analysis good enough that no scenario is dominated by findings. */
const README = {
  present: true,
  size: 2200,
  sections: { overview: true, installation: true, usage: true, examples: true, contributing: false },
  hasCodeBlock: true,
  hasImage: true,
  headingCount: 6,
};

/** The scenarios measured, smallest first. */
const SCENARIOS = [
  { id: "live", label: "Live-shaped profile", repositories: 33, followers: 131, following: 60 },
  { id: "large", label: "Large profile near the retrieval caps", repositories: 150, followers: 1200, following: 1200 },
];

/**
 * serves the project's own files, exactly as the browser tests do
 * @param {Object} request node http request
 * @param {Object} response node http response
 * @returns {void} no return value
 */
function serveProjectFile(request, response) {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filename = path.resolve(projectRoot, relativePath);
  if (!filename.startsWith(`${projectRoot}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filename, (error, content) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
    response.setHeader("Content-Type", types[path.extname(filename)] || "application/octet-stream");
    response.end(content);
  });
}

/**
 * builds one synthetic repository
 * @param {string} name repository name
 * @param {number} index position, used to vary language and homepage
 * @returns {Object} raw github repository
 */
function buildRepository(name, index) {
  return {
    name,
    full_name: `example/${name}`,
    description: "A deterministic layout engine with a documented plugin interface",
    html_url: `https://github.com/example/${name}`,
    homepage: index % 3 === 0 ? "https://example.com" : null,
    language: ["JavaScript", "Python", "Rust", "Go", "TypeScript"][index % 5],
    topics: ["alpha", "beta", `topic-${index % 7}`],
    license: { spdx_id: "MIT" },
    stargazers_count: index,
    forks_count: 0,
    open_issues_count: 0,
    archived: false,
    fork: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    pushed_at: "2026-08-01T00:00:00Z",
  };
}

/**
 * installs every route one scenario needs
 * @param {Object} page playwright page
 * @param {Object} scenario scenario descriptor
 * @returns {Promise<void>} no return value
 */
async function mockScenario(page, scenario) {
  const names = Array.from({ length: scenario.repositories }, (unused, index) => `repo-${index}`);
  const repositories = names.map(buildRepository);

  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.route("https://api.github.com/users/example", (route) =>
    route.fulfill({ json: { login: "example", name: "Example", avatar_url: AVATAR, html_url: "https://github.com/example" } }));
  await page.route("https://api.github.com/users/example/repos**", (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page"));
    route.fulfill({ json: repositories.slice((pageNumber - 1) * 100, pageNumber * 100) });
  });
  await page.route("**/api/pinned-repositories**", (route) =>
    route.fulfill({
      json: {
        repositories: names.slice(0, 6),
        readmes: Object.fromEntries(names.map((name) => [name, README])),
      },
    }));
  await page.route("**/api/report**", (route) => route.fulfill({ json: { contributed_repositories: [] } }));

  const relationship = (route, total, prefix) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page"));
    const start = (pageNumber - 1) * 100;
    route.fulfill({
      json: Array.from({ length: Math.max(0, Math.min(100, total - start)) }, (unused, index) => ({
        login: `${prefix}-${start + index}`,
        html_url: `https://github.com/${prefix}-${start + index}`,
        id: start + index,
      })),
    });
  };
  await page.route("https://api.github.com/users/*/followers**", (route) =>
    relationship(route, scenario.followers, "follower"));
  await page.route("https://api.github.com/users/*/following**", (route) =>
    relationship(route, scenario.following, "following"));
}

/**
 * counts how many times each request url was issued
 * @param {Array<string>} urls requested urls
 * @returns {Array<Array>} url and count, for urls requested more than once
 */
function repeatedRequests(urls) {
  const counts = new Map();
  for (const url of urls) counts.set(url, (counts.get(url) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1);
}

/**
 * keeps only the requests that reach GitHub or GitProfileLens functions
 * @param {Array<string>} urls requested urls
 * @returns {Array<string>} data requests
 */
function dataRequests(urls) {
  return urls.filter((url) => url.includes("api.github.com") || url.includes("/api/"));
}

/**
 * installs a counter that reports how many list items the page creates
 *
 * Counting creations rather than the final total is what distinguishes appending
 * 25 pills from rebuilding 1,200 of them, which is exactly the difference a
 * disclosure change should make and the one a node count alone would hide.
 *
 * @param {Object} page playwright page
 * @returns {Promise<void>} no return value
 */
async function instrumentElementCreation(page) {
  await page.addInitScript(() => {
    window.__created = { li: 0, total: 0 };
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function countedCreateElement(tagName, ...rest) {
      window.__created.total += 1;
      if (String(tagName).toLowerCase() === "li") window.__created.li += 1;
      return create.call(this, tagName, ...rest);
    };
  });
}

/**
 * reads and resets the element-creation counters
 * @param {Object} page playwright page
 * @returns {Promise<Object>} counts since the last read
 */
async function takeCreated(page) {
  return page.evaluate(() => {
    const snapshot = { ...window.__created };
    window.__created.li = 0;
    window.__created.total = 0;
    return snapshot;
  });
}

/**
 * The derived computations worth counting, and where they live.
 *
 * Each is deterministic in the audit it reads, so computing one twice for the
 * same audit produces the same answer twice. Counting them is how "is this work
 * repeated?" becomes a number rather than an impression.
 */
const DERIVED_COMPUTATIONS = [
  ["GitHubAudit", "scoreProfile"],
  ["GitHubAudit", "generateRecommendations"],
  ["GitProfilePinnedOptimizer", "optimizePinnedSet"],
  ["GitProfileNetwork", "buildMarkdown"],
  ["GitProfileNetwork", "deriveNotFollowingBack"],
  ["GitProfileNetworkHistory", "orderAccounts"],
];

/**
 * counts calls to each derived computation without changing what it returns
 * @param {Object} page playwright page
 * @returns {Promise<void>} no return value
 */
async function instrumentDerivedComputations(page) {
  await page.addInitScript((names) => {
    window.__derived = {};
    // The modules are defined by scripts loaded after this one, so wrapping waits
    // until the document has them rather than racing the parser.
    window.addEventListener("DOMContentLoaded", () => {
      for (const [moduleName, functionName] of names) {
        const target = window[moduleName];
        if (!target || typeof target[functionName] !== "function") continue;
        const key = `${moduleName}.${functionName}`;
        window.__derived[key] = 0;
        const original = target[functionName];
        target[functionName] = function countedDerivedCall(...args) {
          window.__derived[key] += 1;
          return original.apply(this, args);
        };
      }
    }, { once: true });
  }, DERIVED_COMPUTATIONS);
}

/**
 * reads and resets the derived-computation counters
 * @param {Object} page playwright page
 * @returns {Promise<Object>} counts since the last read
 */
async function takeDerived(page) {
  return page.evaluate(() => {
    const snapshot = { ...window.__derived };
    for (const key of Object.keys(window.__derived)) window.__derived[key] = 0;
    return snapshot;
  });
}

/**
 * runs one scenario and returns every measurement it produced
 * @param {Object} scenario scenario descriptor
 * @param {string} chromePath chrome executable path
 * @returns {Promise<Object>} measurements
 */
async function measureScenario(scenario, chromePath) {
  const server = http.createServer(serveProjectFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const requests = [];
    const errors = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("pageerror", (error) => errors.push(error.message));
    await instrumentElementCreation(page);
    await instrumentDerivedComputations(page);
    await mockScenario(page, scenario);

    const startedAt = Date.now();
    await page.goto(`${baseUrl}/?user=example`);
    await page.locator("#result-section").waitFor({ state: "visible" });
    const auditMilliseconds = Date.now() - startedAt;
    const auditRequests = dataRequests(requests).map((url) => url.replace(baseUrl, ""));
    const auditCreated = await takeCreated(page);
    const auditDerived = await takeDerived(page);
    const auditNodes = await page.evaluate(() => document.querySelectorAll("*").length);
    // Where the audit's DOM actually goes, so "defer this panel" can be argued
    // from a number rather than from an intuition about which panel is expensive.
    const panelNodes = await page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll(".tab-panel")]
        .map((panel) => [panel.id, panel.querySelectorAll("*").length])));

    const networkStartedAt = Date.now();
    await page.getByRole("tab", { name: "Network" }).click();
    await page.locator("#network-results").waitFor({ state: "visible" });
    const networkMilliseconds = Date.now() - networkStartedAt;
    const networkRequests = dataRequests(requests).length - auditRequests.length;
    const networkCreated = await takeCreated(page);
    const networkDerived = await takeDerived(page);
    const networkNodes = await page.evaluate(() => document.querySelectorAll("*").length);

    // Seven tab switches, ending back on Network. Nothing here should fetch.
    const beforeChurn = dataRequests(requests).length;
    for (const tab of ["Overview", "Audit", "Repositories", "Network", "Pinned", "Markdown", "Network"]) {
      await page.getByRole("tab", { name: tab }).click();
    }
    await page.waitForTimeout(300);
    const churnRequests = dataRequests(requests).length - beforeChurn;
    const churnCreated = await takeCreated(page);
    const churnDerived = await takeDerived(page);

    await page.getByRole("button", { name: "Show 25 more Followers" }).click();
    const showMoreCreated = await takeCreated(page);

    const expandStartedAt = Date.now();
    await page.getByRole("button", { name: "Show all Followers" }).click();
    const showAllCreated = await takeCreated(page);
    const expandMilliseconds = Date.now() - expandStartedAt;
    const expandedNodes = await page.evaluate(() => document.querySelectorAll("*").length);

    await page.getByRole("button", { name: "Collapse Followers" }).click();
    const collapseCreated = await takeCreated(page);

    const storageWrites = await page.evaluate(() => {
      // Count writes performed by one further disclosure change and one tab
      // return, neither of which observes anything new.
      let writes = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function countedSetItem(...args) {
        writes += 1;
        return original.apply(this, args);
      };
      document.querySelector("#network-followers-all").click();
      document.querySelector("#network-followers-collapse").click();
      Storage.prototype.setItem = original;
      return writes;
    });

    const historyBytes = await page.evaluate(() =>
      (window.localStorage.getItem("gitprofilelens.network-history.v1") ?? "").length);

    // A second audit of a different profile, to see what the first one leaves behind.
    await page.route("https://api.github.com/users/other", (route) =>
      route.fulfill({ json: { login: "other", name: "Other", avatar_url: AVATAR, html_url: "https://github.com/other" } }));
    await page.route("https://api.github.com/users/other/repos**", (route) => route.fulfill({ json: [] }));
    await page.evaluate(() => {
      document.querySelector("#username").value = "other";
      document.querySelector("#github-form").dispatchEvent(new Event("submit", { cancelable: true }));
    });
    await page.locator("#status").filter({ hasText: /no public repositories/i }).waitFor();
    const afterSecondNodes = await page.evaluate(() => document.querySelectorAll("*").length);

    return {
      scenario,
      auditRequests,
      auditMilliseconds,
      auditCreated,
      auditDerived,
      auditNodes,
      panelNodes,
      networkRequests,
      networkMilliseconds,
      networkCreated,
      networkDerived,
      networkNodes,
      churnRequests,
      churnCreated,
      churnDerived,
      showMoreCreated,
      showAllCreated,
      expandMilliseconds,
      collapseCreated,
      expandedNodes,
      storageWrites,
      historyBytes,
      afterSecondNodes,
      repeated: repeatedRequests(dataRequests(requests).map((url) => url.replace(baseUrl, ""))),
      errors,
    };
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Manager sizes swept synthetically, from one page to the retrieval cap. */
const MANAGER_SIZES = [25, 250, 1000, 10000];

/**
 * measures the unfollow manager at sizes the retrieval itself cannot easily reach
 *
 * Driven synthetically rather than through GitHub so that the thing being
 * measured is the manager and nothing else. Retrieving ten thousand accounts for
 * real would spend the measurement on a hundred paginated responses and on an
 * observation history large enough that the storage quota, not the rendering,
 * would decide the numbers.
 *
 * What matters here is that every figure stays flat as the list grows. A manager
 * that renders a bounded page costs the same to open whether it holds twenty-five
 * accounts or ten thousand, and reconciling one confirmed unfollow is one pass
 * over the list rather than one pass per account already removed.
 *
 * @param {string} chromePath chrome executable
 * @returns {Promise<Array<Object>>} one measurement per size
 */
async function measureSyntheticManager(chromePath) {
  const server = http.createServer(serveProjectFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await instrumentElementCreation(page);
    await mockScenario(page, SCENARIOS[0]);
    // The manager is offered only to a session that owns the audited profile and
    // carries the follow-management permission, so the measurement signs in.
    await page.route("**/api/auth/session", (route) => route.fulfill({
      json: {
        authenticated: true,
        user: { login: "example", avatar_url: AVATAR },
        can_manage_follows: true,
      },
    }));
    await page.goto(`${baseUrl}/?user=example&view=network`);
    await page.locator("#network-results").waitFor({ state: "visible" });
    await page.locator("#network-manage-unfollows").click();
    await page.locator("#network-manager").waitFor({ state: "visible" });

    const measurements = [];
    for (const size of MANAGER_SIZES) {
      await takeCreated(page);
      const timings = await page.evaluate((count) => {
        const accounts = Array.from({ length: count }, (unused, index) => ({
          login: `synthetic-${index}`,
          profileUrl: `https://github.com/synthetic-${index}`,
          avatarUrl: null,
        }));
        /**
         * re-renders the manager over a fresh list and times it
         * @param {Function} work change to apply before rendering
         * @returns {number} milliseconds the render took
         */
        const render = (work) => {
          work();
          const startedAt = performance.now();
          renderUnfollowManager();
          return performance.now() - startedAt;
        };

        const open = render(() => {
          managerState.accounts = accounts;
          managerState.accountsByLogin = new Map(
            accounts.map((entry) => [entry.login.toLowerCase(), entry])
          );
          managerState.outcomes = new Map();
          managerState.filter = "";
          managerState.visibleCount = 25;
          managerState.renderedAccounts = null;
          managerState.renderedCount = 0;
          managerState.rows = new Map();
        });
        const openRows = document.querySelectorAll(".manager-row").length;

        const more = render(() => { managerState.visibleCount += 25; });
        const all = render(() => { managerState.visibleCount = accounts.length; });
        const allRows = document.querySelectorAll(".manager-row").length;
        const allNodes = document.querySelectorAll("*").length;

        const collapse = render(() => { managerState.visibleCount = 25; });
        const filter = render(() => { managerState.filter = "synthetic-1"; });
        const filterRows = document.querySelectorAll(".manager-row").length;
        render(() => { managerState.filter = ""; });

        // One confirmed unfollow's reconciliation, measured on a network of this
        // size: remove the account, then re-derive the difference from it.
        const network = {
          user: { login: "example", reportedFollowers: 0, reportedFollowing: count },
          followers: { accounts: [], complete: true, error: null },
          following: { accounts, complete: true, error: null },
          complete: true,
        };
        const reconcileStartedAt = performance.now();
        const removal = GitProfileNetwork.withAccountRemoved(network, accounts[0].login);
        GitProfileNetwork.deriveNotFollowingBack(removal.network);
        const reconcile = performance.now() - reconcileStartedAt;

        return { open, openRows, more, all, allRows, allNodes, collapse, filter, filterRows, reconcile };
      }, size);

      measurements.push({ size, ...timings, created: await takeCreated(page) });
    }
    return measurements;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * prints a label and value pair aligned into a column
 * @param {string} name row label
 * @param {*} value row value
 * @returns {void} no return value
 */
function row(name, value) {
  const label = String(name);
  console.log(`  ${label.padEnd(42)}${label.length >= 42 ? "  " : ""}${value}`);
}

/**
 * prints one scenario's measurements
 * @param {Object} result measurements from one scenario
 * @returns {void} no return value
 */
function report(result) {
  const { scenario } = result;
  console.log(
    `\n== ${scenario.label}: ${scenario.repositories} repositories, ` +
    `${scenario.followers} followers, ${scenario.following} following ==`
  );

  console.log("\n  Requests");
  row("audit data requests", result.auditRequests.length);
  for (const url of result.auditRequests) console.log(`      ${url}`);
  row("network data requests", result.networkRequests);
  row("requests across 7 tab switches", result.churnRequests);
  row("urls requested more than once", result.repeated.length);
  for (const [url, count] of result.repeated) console.log(`      ${count}x ${url}`);

  console.log("\n  Elements created");
  row("during the audit", `${result.auditCreated.total} (${result.auditCreated.li} list items)`);
  row("opening Network", `${result.networkCreated.total} (${result.networkCreated.li} list items)`);
  row("across 7 tab switches", `${result.churnCreated.total} (${result.churnCreated.li} list items)`);
  row("Show 25 more", `${result.showMoreCreated.li} list items`);
  row("Show all followers", `${result.showAllCreated.li} list items`);
  row("Collapse followers", `${result.collapseCreated.li} list items`);

  console.log("\n  Derived computations (repeats of deterministic work)");
  for (const key of Object.keys(result.auditDerived)) {
    row(key, `audit ${result.auditDerived[key]}  network ${result.networkDerived[key]}  ` +
      `7 tab switches ${result.churnDerived[key]}`);
  }

  console.log("\n  DOM size");
  row("after the audit", result.auditNodes);
  for (const [id, count] of Object.entries(result.panelNodes)) row(`  ${id}`, count);
  row("after opening Network", result.networkNodes);
  row("with every follower shown", result.expandedNodes);
  row("after auditing a second profile", result.afterSecondNodes);

  console.log("\n  Storage");
  row("writes for two no-op disclosure changes", result.storageWrites);
  row("history snapshot size (bytes)", result.historyBytes);

  console.log("\n  Wall clock (informational only, machine dependent)");
  row("audit complete", `${result.auditMilliseconds}ms`);
  row("network complete", `${result.networkMilliseconds}ms`);
  row("show all followers", `${result.expandMilliseconds}ms`);

  if (result.errors.length > 0) {
    console.log("\n  Page errors");
    for (const error of result.errors) console.log(`      ${error}`);
  }
}

/**
 * prints the synthetic manager sweep
 * @param {Array<Object>} measurements one entry per manager size
 * @returns {void} no return value
 */
function reportSyntheticManager(measurements) {
  console.log("\n== Unfollow manager, synthetic ==\n");
  console.log("  accounts   rows open  nodes all  open ms  +25 ms  all ms  filter ms  reconcile ms");
  for (const entry of measurements) {
    console.log(
      `  ${String(entry.size).padEnd(11)}${String(entry.openRows).padEnd(11)}` +
      `${String(entry.allNodes).padEnd(11)}${entry.open.toFixed(1).padEnd(9)}` +
      `${entry.more.toFixed(1).padEnd(8)}${entry.all.toFixed(1).padEnd(8)}` +
      `${entry.filter.toFixed(1).padEnd(11)}${entry.reconcile.toFixed(1)}`
    );
  }
  console.log("\n  Opening the manager renders one page at every size. Rows rendered while");
  console.log("  expanded are the cost of Show all, which the reader asks for explicitly.");
}

/**
 * runs every requested scenario and prints its measurements
 * @returns {Promise<void>} no return value
 */
async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : null;
  const chromePath = CHROME_CANDIDATES.find(fs.existsSync);

  if (!chromePath) {
    console.error("No Chrome or Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.");
    process.exitCode = 1;
    return;
  }

  const scenarios = SCENARIOS.filter((scenario) => !only || scenario.id === only);
  if (scenarios.length === 0) {
    console.error(`No scenario named ${only}.`);
    process.exitCode = 1;
    return;
  }

  console.log("GitProfileLens performance diagnostics");
  console.log("Counts are deterministic; wall-clock figures are informational only.");

  for (const scenario of scenarios) {
    report(await measureScenario(scenario, chromePath));
  }

  if (!only) reportSyntheticManager(await measureSyntheticManager(chromePath));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
