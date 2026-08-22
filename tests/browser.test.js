const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright-core");

const projectRoot = path.resolve(__dirname, "..");
const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chromePath = chromeCandidates.find(fs.existsSync);
const repository = {
  name: "portfolio-lens",
  full_name: "example/portfolio-lens",
  description: "Developer portfolio analyzer with actionable repository guidance",
  html_url: "https://github.com/example/portfolio-lens",
  homepage: "https://example.com",
  language: "JavaScript",
  topics: ["github", "portfolio", "analysis"],
  license: { spdx_id: "MIT" },
  stargazers_count: 5,
  forks_count: 1,
  open_issues_count: 0,
  archived: false,
  fork: false,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  pushed_at: "2026-08-01T00:00:00Z",
};
const secondRepository = {
  ...repository,
  name: "api-toolkit",
  full_name: "example/api-toolkit",
  description: null,
  html_url: "https://github.com/example/api-toolkit",
  language: "Python",
  topics: ["api"],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  pushed_at: "2026-07-01T00:00:00Z",
};
const readme = {
  present: true,
  size: 2200,
  sections: { overview: true, installation: true, usage: true, examples: true, contributing: false },
  hasCodeBlock: true,
  hasImage: true,
  headingCount: 6,
};

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(serveProjectFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("profile flow renders verified README details and switches tabs", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });
  assert.equal(await page.locator(".hero").isHidden(), true);
  assert.equal(await page.locator("#result-page").isVisible(), true);
  const resultLogin = page.locator("#result-page").getByRole("link", { name: "Sign in with GitHub" });
  assert.equal(await resultLogin.isVisible(), true);
  assert.equal(await resultLogin.locator("svg").count(), 1);

  assert.match(await page.locator("#status").innerText(), /including 1 profile pins/i);
  assert.match(await page.locator("#profile-insight").innerText(), /Example's portfolio snapshot: 2 public projects/i);
  await page.getByRole("button", { name: /explain the readme quality score/i }).click();
  assert.match(await page.locator("#score-explanation-readme").innerText(), /rounded average of 2 repository README scores/i);
  assert.match(await page.locator("#score-explanation-readme").innerText(), /Every analyzed repository passed/i);
  await page.getByRole("button", { name: /explain the portfolio focus score/i }).click();
  assert.match(await page.locator("#score-explanation-focus").innerText(), /55-point baseline/i);
  await page.getByRole("tab", { name: "Audit" }).click();
  await page.getByText("README checklist").first().waitFor();
  assert.match(await page.locator(".readme-checklist").first().innerText(), /✓ Overview/);
  assert.match(await page.locator(".readme-checklist").first().innerText(), /– Contribution guide/);

  await browser.close();
});

test("username search transitions through a dedicated loading screen", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await mockGithubRequests(page, [repository, secondRepository], { profileDelay: 250 });
  await page.goto(baseUrl);
  assert.equal(await page.locator(".hero").isVisible(), true);
  assert.equal(await page.locator("#result-page").isHidden(), true);
  const homeLogin = page.locator(".hero").getByRole("link", { name: "Sign in with GitHub" });
  assert.equal(await homeLogin.isVisible(), true);
  assert.equal(await homeLogin.locator("svg").count(), 1);

  await page.locator("#username").fill("example");
  await page.getByRole("button", { name: "Analyze profile" }).click();
  await page.locator("#loading-screen").waitFor({ state: "visible" });
  assert.equal(await page.locator("#loading-username").innerText(), "@example");
  assert.equal(await page.locator(".hero").isHidden(), true);
  assert.equal(await page.locator("#result-page").isHidden(), true);

  await page.locator("#result-page").waitFor({ state: "visible" });
  assert.equal(await page.locator("#loading-screen").isHidden(), true);
  assert.equal(await page.locator(".hero").isHidden(), true);
  await browser.close();
});

test("mobile layout has no horizontal page overflow", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockGithubRequests(page);

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));

  assert.ok(dimensions.content <= dimensions.viewport, `page width ${dimensions.content}px exceeds ${dimensions.viewport}px viewport`);
  assert.equal(await page.locator("#generate-button").isHidden(), true);
  assert.equal(await page.locator("#result-page").getByRole("link", { name: "Sign in with GitHub" }).isVisible(), true);
  assert.equal(await page.locator("#share-button").isVisible(), true);

  await browser.close();
});

test("Markdown export respects compact, pinned-only, and manual selection options", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });

  await page.getByRole("tab", { name: "Markdown export" }).click();
  assert.match(await page.locator("#output").inputValue(), /portfolio-lens/);
  assert.match(await page.locator("#output").inputValue(), /api-toolkit/);
  assert.doesNotMatch(await page.locator("#output").inputValue(), /README is missing|actionable findings/i);
  await page.getByLabel("Full repository details").uncheck();
  assert.doesNotMatch(await page.locator("#output").inputValue(), /primary language:/i);
  await page.getByLabel("Pinned repositories only").check();
  assert.match(await page.locator("#output").inputValue(), /portfolio-lens/);
  assert.doesNotMatch(await page.locator("#output").inputValue(), /api-toolkit/);

  await page.getByLabel("Pinned repositories only").uncheck();
  await page.getByRole("tab", { name: "Repositories" }).click();
  await page.getByLabel("Include api-toolkit in selected exports").uncheck();
  await page.getByRole("tab", { name: "Markdown export" }).click();
  await page.getByLabel("Selected repositories only").check();
  assert.match(await page.locator("#output").inputValue(), /portfolio-lens/);
  assert.doesNotMatch(await page.locator("#output").inputValue(), /api-toolkit/);
  await browser.close();
});

test("empty and nonexistent profiles show useful states", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const emptyPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await mockGithubRequests(emptyPage, []);
  await emptyPage.goto(`${baseUrl}/?user=example`);
  await emptyPage.locator("#result-section").waitFor({ state: "visible" });
  assert.match(await emptyPage.locator("#status").innerText(), /no public repositories/i);
  assert.equal(await emptyPage.locator("#overall-score").innerText(), "0");

  const missingPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await missingPage.route("https://api.github.com/users/missing", (route) => route.fulfill({ status: 404, json: { message: "Not Found" } }));
  await missingPage.goto(`${baseUrl}/?user=missing`);
  await missingPage.locator("#status.error").waitFor();
  assert.match(await missingPage.locator("#status").innerText(), /user not found/i);
  assert.equal(await missingPage.locator("#result-section").isHidden(), true);
  await browser.close();
});

test("sharing uses the dynamic score and opens anonymously from its URL", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const senderContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await senderContext.addInitScript(() => {
    window.__sharedResult = null;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => { window.__sharedResult = data; },
    });
  });
  const sender = await senderContext.newPage();
  const browserErrors = [];
  sender.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  sender.on("pageerror", (error) => browserErrors.push(error.message));
  await mockGithubRequests(sender);
  await sender.goto(`${baseUrl}/?user=example`);
  await sender.locator("#result-section").waitFor({ state: "visible" });
  const score = await sender.locator("#overall-score").innerText();
  await sender.getByRole("button", { name: "Share result" }).click();
  const payload = await sender.evaluate(() => window.__sharedResult);
  assert.match(payload.text, new RegExp(`I got an? ${score}/100`));
  assert.match(payload.text, /user=example/);
  assert.doesNotMatch(payload.text, /token|authorization|github_pat/i);

  const shareUrl = payload.text.match(/https:\/\/\S+$/)[0];
  const recipientContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const recipient = await recipientContext.newPage();
  await mockGithubRequests(recipient);
  await recipient.goto(`${baseUrl}/${new URL(shareUrl).search}`);
  await recipient.locator("#result-section").waitFor({ state: "visible" });
  assert.equal(await recipient.locator("#username").inputValue(), "example");
  assert.equal(await recipient.locator("#overall-score").innerText(), score);

  const downloadPromise = sender.waitForEvent("download");
  await sender.getByRole("button", { name: "Download score card" }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "example-gitprofilelens-score.png");

  const fallbackContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await fallbackContext.addInitScript(() => {
    window.__copiedResult = null;
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedResult = text; } },
    });
  });
  const fallbackPage = await fallbackContext.newPage();
  await mockGithubRequests(fallbackPage);
  await fallbackPage.goto(`${baseUrl}/?user=example`);
  await fallbackPage.locator("#result-section").waitFor({ state: "visible" });
  await fallbackPage.getByRole("button", { name: "Share result" }).click();
  assert.match(await fallbackPage.evaluate(() => window.__copiedResult), /user=example/);
  assert.equal(await fallbackPage.locator("#share-button").innerText(), "Copied!");
  await fallbackPage.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("clipboard unavailable"); } },
    });
  });
  await fallbackPage.locator("#share-button").click();
  assert.match(await fallbackPage.locator("#status.error").innerText(), /could not share automatically/i);
  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

test("private audit mode isolates authorized repositories from public outputs", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await mockGithubRequests(page);
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      authenticated: true,
      user: { login: "example", avatar_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%2358a6ff'/%3E%3C/svg%3E" },
    },
  }));
  await page.route("**/api/private-repositories", (route) => route.fulfill({
    headers: { "Cache-Control": "private, no-store, max-age=0" },
    json: {
      installation: true,
      configure_url: "https://github.com/apps/gitprofilelens/installations/new",
      repositories: [
        { ...repository, name: "secret-project", full_name: "example/secret-project", html_url: "https://github.com/example/secret-project", private: true, visibility: "private" },
        { ...secondRepository, name: "authorized-public-project", full_name: "example/authorized-public-project", html_url: "https://github.com/example/authorized-public-project", private: false, visibility: "public" },
      ],
      readmes: { "secret-project": readme, "authorized-public-project": readme },
    },
  }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto(baseUrl);
  await page.locator("#home-signed-in-auth").waitFor({ state: "visible" });
  assert.equal(await page.locator("#home-auth-login").innerText(), "@example");
  assert.equal(await page.locator("#home-private-audit-button svg").count(), 1);
  const publicMarkdown = "";

  await page.evaluate(() => {
    window.__privateShareCalls = 0;
    window.__privateCardCalls = 0;
    window.__privateProfileScoreCalls = 0;
    window.__privateMarkdownCalls = 0;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => { window.__privateShareCalls += 1; },
    });
    const original = GitProfileShare.buildScoreCardData;
    GitProfileShare.buildScoreCardData = (...args) => {
      window.__privateCardCalls += 1;
      return original(...args);
    };
    const originalProfileScore = GitHubAudit.scoreProfile;
    GitHubAudit.scoreProfile = (...args) => {
      window.__privateProfileScoreCalls += 1;
      return originalProfileScore(...args);
    };
    const originalMarkdown = createMarkdown;
    window.createMarkdown = (...args) => {
      window.__privateMarkdownCalls += 1;
      return originalMarkdown(...args);
    };
  });
  await page.locator("#home-private-audit-button").click();
  await page.locator("#audit-title").filter({ hasText: "Private Repository Audit" }).waitFor();
  await page.locator("#signed-in-auth").waitFor({ state: "visible" });
  assert.equal(await page.locator("#auth-login").innerText(), "@example");

  assert.equal(await page.locator("#audit-title").innerText(), "Private Repository Audit");
  assert.deepEqual(
    new Set(await page.locator(".privacy-badge").allInnerTexts()),
    new Set(["PRIVATE", "PUBLIC"])
  );
  assert.equal(await page.locator(".candidate-label").count(), 2);
  for (const label of await page.locator(".candidate-label").allInnerTexts()) {
    assert.match(label, /portfolio candidate|worth polishing|needs presentation work/i);
  }
  assert.equal(await page.locator("#share-button").isHidden(), true);
  assert.equal(await page.locator("#score-card-button").isHidden(), true);
  assert.equal(await page.locator('[data-tab="overview"]').isHidden(), true);
  assert.equal(await page.locator('[data-tab="markdown"]').isHidden(), true);
  assert.equal(await page.locator("#markdown-panel").isHidden(), true);
  assert.equal(await page.locator("#output").inputValue(), publicMarkdown);
  assert.equal(new URL(page.url()).searchParams.has("user"), false);
  assert.doesNotMatch(page.url(), /secret-project/);

  await page.evaluate(() => {
    document.querySelector("#share-button").click();
    document.querySelector("#score-card-button").click();
    document.querySelector("#copy-button").click();
    document.querySelector("#download-button").click();
  });
  assert.deepEqual(await page.evaluate(() => ({
    share: window.__privateShareCalls,
    card: window.__privateCardCalls,
    profileScore: window.__privateProfileScoreCalls,
    markdown: window.__privateMarkdownCalls,
  })), { share: 0, card: 0, profileScore: 0, markdown: 0 });
  assert.equal(await page.locator("#output").inputValue(), publicMarkdown);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator(".hero").waitFor({ state: "visible" });
  assert.equal(await page.locator("#signed-out-auth").evaluate((element) => element.hidden), false);
  assert.equal(await page.locator("#result-section").isHidden(), true);
  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

async function mockGithubRequests(page, repositories = [repository, secondRepository], options = {}) {
  const avatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%2358a6ff'/%3E%3C/svg%3E";
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } })
  );
  await page.route("https://api.github.com/users/example", async (route) => {
    if (options.profileDelay) {
      await new Promise((resolve) => setTimeout(resolve, options.profileDelay));
    }
    await route.fulfill({ json: { login: "example", name: "Example User", avatar_url: avatar, html_url: "https://github.com/example" } });
  });
  await page.route("https://api.github.com/users/example/repos**", (route) =>
    route.fulfill({ json: repositories })
  );
  await page.route("**/api/pinned-repositories?username=example", (route) =>
    route.fulfill({
      json: {
        repositories: repositories.length ? [repository.name] : [],
        readmes: Object.fromEntries(repositories.map((item) => [item.name, readme])),
      },
    })
  );
}

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
