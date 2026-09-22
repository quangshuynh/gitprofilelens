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
  assert.equal(await page.locator(".result-brand img").evaluate((image) => image.naturalWidth > 0), true);
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
  assert.equal(await page.locator(".tabs").getAttribute("role"), "tablist");
  assert.equal(await page.locator("#audit-tab").getAttribute("aria-controls"), "audit-panel");
  assert.equal(await page.locator("#audit-panel").getAttribute("aria-labelledby"), "audit-tab");
  assert.equal(await page.locator("#audit-tab").getAttribute("tabindex"), "0");
  assert.equal(await page.locator("#overview-tab").getAttribute("tabindex"), "-1");
  await page.getByText("README checklist").first().waitFor();
  assert.match(await page.locator(".readme-checklist").first().innerText(), /✓ Overview/);
  assert.match(await page.locator(".readme-checklist").first().innerText(), /– Contribution guide/);

  await page.locator("#audit-tab").press("ArrowRight");
  assert.equal(await page.locator("#repositories-tab").getAttribute("aria-selected"), "true");
  await page.locator("#repositories-tab").press("End");
  assert.equal(await page.locator("#markdown-tab").getAttribute("aria-selected"), "true");

  await browser.close();
});

test("username search transitions through a dedicated loading screen", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await mockGithubRequests(page, [repository, secondRepository], { profileDelay: 250 });
  await page.goto(baseUrl);
  assert.equal(await page.locator(".hero").isVisible(), true);
  await page.locator(".hero-logo").waitFor({ state: "visible" });
  assert.equal(await page.locator(".hero-logo").evaluate((image) => image.naturalWidth > 0), true);
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
  assert.match(await page.locator("#output").inputValue(), /forked repository: No/);
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

test("fork indicators appear on repository audit and explorer cards without labeling originals", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const fork = { ...repository, name: "upstream-fork", full_name: "example/upstream-fork", html_url: "https://github.com/example/upstream-fork", fork: true };
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await mockGithubRequests(page, [fork, secondRepository], { pinnedRepositories: [fork.name] });
    await page.goto(`${baseUrl}/?user=example`);
    await page.locator("#result-section").waitFor({ state: "visible" });

    await page.getByRole("tab", { name: "Audit" }).click();
    const forkAudit = page.locator(".audit-card", { has: page.getByRole("link", { name: fork.name }) });
    const originalAudit = page.locator(".audit-card", { has: page.getByRole("link", { name: secondRepository.name }) });
    assert.equal(await forkAudit.locator(".fork-badge").innerText(), "FORK");
    assert.match(await forkAudit.locator(".fact-row").innerText(), /Fork: Yes/);
    assert.equal(await originalAudit.locator(".fork-badge").count(), 0);

    // Candidacy is shown in public mode too, not only in the private audit, and a
    // fork is never presented as a strong candidate on its inherited presentation.
    assert.equal(await page.locator(".audit-card").count(), await page.locator(".candidate-panel").count());
    assert.doesNotMatch(await forkAudit.locator(".candidate-badge").innerText(), /Strong candidate/i);
    assert.match(await forkAudit.locator(".candidate-explanation").innerText(), /identifies this repository as a fork/i);
    assert.equal(await originalAudit.locator(".candidate-panel").count(), 1);
    assert.doesNotMatch(await originalAudit.locator(".candidate-explanation").innerText(), /fork/i);
    // The score guide describes presentation only; candidacy is judged per card.
    assert.match(await page.locator("#rating-guide").innerText(), /Portfolio candidacy is judged separately/i);

    await page.getByRole("tab", { name: "Repositories" }).click();
    const forkCard = page.locator(".repository-card", { has: page.getByRole("link", { name: fork.name }) });
    const originalCard = page.locator(".repository-card", { has: page.getByRole("link", { name: secondRepository.name }) });
    assert.match(await forkCard.locator(".repository-flags").innerText(), /Fork/);
    assert.doesNotMatch(await originalCard.locator(".repository-flags").innerText(), /Fork/);

    await page.getByRole("tab", { name: "Markdown export" }).click();
    const fullMarkdown = await page.locator("#output").inputValue();
    assert.match(fullMarkdown, /name: upstream-fork[\s\S]*forked repository: Yes/);
    assert.match(fullMarkdown, /name: api-toolkit[\s\S]*forked repository: No/);
  } finally {
    await browser.close();
  }
});

test("profile pins retain their GitHub order in repositories and Markdown", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page, [repository, secondRepository], {
    pinnedRepositories: [secondRepository.name, repository.name],
  });
  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });

  await page.getByRole("tab", { name: "Repositories" }).click();
  assert.deepEqual(
    await page.locator("#repository-list .repository-card-heading a").allTextContents(),
    [secondRepository.name, repository.name]
  );

  await page.getByRole("tab", { name: "Markdown export" }).click();
  const markdown = await page.locator("#output").inputValue();
  assert.ok(markdown.indexOf(`- ${secondRepository.name}`) < markdown.indexOf(`- ${repository.name}`));
  await browser.close();
});

test("renders external contributions separately and handles the empty state", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    await mockGithubRequests(page, [repository, secondRepository], {
      contributions: [
        {
          owner: "hymical", name: "forms", full_name: "hymical/forms",
          url: "https://github.com/hymical/forms", description: "Forms library",
          primary_language: "Python", stars: 3, forks: 1,
          contribution: { pull_requests: 4, merged_pull_requests: 4 },
        },
        {
          owner: "octo", name: "tools", full_name: "octo/tools",
          url: "https://github.com/octo/tools", description: null,
          primary_language: null, stars: 0, forks: 0,
          contribution: { pull_requests: 2, merged_pull_requests: 1 },
        },
      ],
    });
    await page.goto(`${baseUrl}/?user=example`);
    await page.locator("#result-section").waitFor({ state: "visible" });
    await page.getByRole("tab", { name: "Repositories" }).click();
    assert.deepEqual(await page.locator("#contribution-list .repository-card-heading a").allTextContents(), ["hymical/forms", "octo/tools"]);
    assert.match(await page.locator("#contribution-list").innerText(), /4 merged PRs/);
    assert.equal(await page.locator("#repository-list .repository-card").count(), 2);
    assert.doesNotMatch(await page.locator("#repository-list").innerText(), /hymical\/forms/);
    assert.doesNotMatch(await page.locator("#output").inputValue(), /hymical\/forms/);

    const emptyPage = await browser.newPage({ viewport: { width: 900, height: 800 } });
    await mockGithubRequests(emptyPage, [repository], { contributions: [] });
    await emptyPage.goto(`${baseUrl}/?user=example`);
    await emptyPage.locator("#result-section").waitFor({ state: "visible" });
    await emptyPage.getByRole("tab", { name: "Repositories" }).click();
    assert.match(await emptyPage.locator("#contribution-list").innerText(), /No public external repositories/i);
  } finally {
    await browser.close();
  }
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

test("signed-in users can sign out from the homepage", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    let logoutRequests = 0;
    await page.route("**/api/auth/session", (route) => route.fulfill({
      json: {
        authenticated: true,
        user: { login: "example", avatar_url: "https://avatars.example/example.png" },
      },
    }));
    await page.route("**/api/auth/logout", (route) => {
      logoutRequests += 1;
      route.fulfill({ json: { authenticated: false } });
    });
    await page.goto(baseUrl);
    await page.locator("#home-signed-in-auth").waitFor({ state: "visible" });
    assert.equal(await page.locator("#home-logout-button").isVisible(), true);
    await page.locator("#home-logout-button").click();
    await page.locator("#home-signed-out-auth").waitFor({ state: "visible" });
    assert.equal(logoutRequests, 1);
    assert.match(await page.locator("#status").innerText(), /signed out/i);
  } finally {
    await browser.close();
  }
});

test("private audit mode isolates authorized repositories from public outputs", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  let browserPublicRepositoryRequests = 0;
  page.on("request", (request) => {
    if (/api\.github\.com\/users\/example\/repos/.test(request.url())) browserPublicRepositoryRequests += 1;
  });
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
        { ...repository, name: "secret-project", full_name: "example/secret-project", html_url: "https://github.com/example/secret-project", private: true, visibility: "private", fork: true },
        { ...secondRepository, name: "authorized-public-project", full_name: "example/authorized-public-project", html_url: "https://github.com/example/authorized-public-project", private: false, visibility: "public" },
      ],
      public_repositories: [repository, secondRepository],
      readmes: {
        "secret-project": { present: null, size: null, unavailable_reason: "github_5xx" },
        "authorized-public-project": readme,
      },
      metadata: { complete: false, unavailable_readmes: 1, issues: { github_5xx: 1 } },
    },
  }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto(baseUrl);
  await page.locator("#home-signed-in-auth").waitFor({ state: "visible" });
  assert.equal(await page.locator("#home-auth-login").innerText(), "@example");
  assert.equal(await page.locator("#home-private-audit-button svg").count(), 1);
  await page.evaluate(() => {
    window.__privateShareCalls = 0;
    window.__privateCardCalls = 0;
    window.__privateProfileScoreCalls = 0;
    window.__copiedPrivateMarkdown = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedPrivateMarkdown = text; } },
    });
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
  });
  await page.locator("#home-private-audit-button").click();
  await page.locator("#audit-title").filter({ hasText: "Private Repository Audit" }).waitFor();
  await page.locator("#signed-in-auth").waitFor({ state: "visible" });
  assert.equal(await page.locator("#auth-login").innerText(), "@example");
  assert.equal(browserPublicRepositoryRequests, 0);
  assert.match(await page.locator("#status").innerText(), /1 README was unavailable and scored neutrally as unverified/i);
  assert.equal(
    await page.evaluate(() => appState.audits.find((audit) => audit.repository.name === "secret-project").categoryScores.readme),
    60
  );

  assert.equal(await page.locator("#audit-title").innerText(), "Private Repository Audit");
  assert.deepEqual(
    new Set(await page.locator(".privacy-badge").allInnerTexts()),
    new Set(["PRIVATE", "PUBLIC"])
  );
  assert.equal(await page.locator(".candidate-panel").count(), 2);
  const forkCandidate = page.locator(".audit-card").filter({ hasText: "secret-project" }).locator(".candidate-panel");
  // A fork never reaches Strong candidate, and the card says why rather than
  // implying the signed-in user did none of the work.
  assert.doesNotMatch(await forkCandidate.locator(".candidate-badge").innerText(), /Strong candidate/i);
  assert.match(await forkCandidate.locator(".candidate-explanation").innerText(), /identifies this repository as a fork/i);
  assert.match(await forkCandidate.locator(".candidate-explanation").innerText(), /cannot determine how much of the implementation/i);
  // Its README came back unavailable, which must read as unknown, not as missing.
  assert.equal(await forkCandidate.locator(".candidate-qualifier").innerText(), "Some metadata unavailable");
  assert.doesNotMatch(await forkCandidate.locator(".candidate-explanation").innerText(), /no README|missing README/i);
  assert.equal(await page.locator(".fork-badge").count(), 1);
  assert.equal(await page.locator("#share-button").isHidden(), true);
  assert.equal(await page.locator("#score-card-button").isHidden(), true);
  assert.equal(await page.locator('[data-tab="overview"]').isHidden(), true);
  assert.equal(await page.locator('[data-tab="markdown"]').isVisible(), true);
  assert.equal(new URL(page.url()).searchParams.has("user"), false);
  assert.doesNotMatch(page.url(), /secret-project/);

  await page.getByRole("tab", { name: "Markdown export" }).click();
  assert.equal(await page.locator("#private-export-options").isVisible(), true);
  assert.equal(await page.locator("#public-export-options").isHidden(), true);
  const privateMarkdown = await page.locator("#output").inputValue();
  assert.match(privateMarkdown, /authorized private repositories in report: 1/);
  assert.match(privateMarkdown, /name: secret-project/);
  assert.match(privateMarkdown, /visibility: Private/);
  assert.match(privateMarkdown, /forked repository: Yes/);
  assert.doesNotMatch(privateMarkdown, /authorized-public-project|portfolio-lens/);

  await page.getByLabel("Public repositories only").check();
  const publicMarkdown = await page.locator("#output").inputValue();
  assert.match(publicMarkdown, /public repositories in report: 2/);
  assert.match(publicMarkdown, /name: portfolio-lens/);
  assert.doesNotMatch(publicMarkdown, /secret-project/);

  await page.getByLabel("Public and private repositories").check();
  const combinedMarkdown = await page.locator("#output").inputValue();
  assert.match(combinedMarkdown, /combined public and authorized private repositories in report: 3/);
  assert.match(combinedMarkdown, /name: portfolio-lens/);
  assert.match(combinedMarkdown, /name: secret-project/);
  assert.match(combinedMarkdown, /visibility: Public/);
  assert.match(combinedMarkdown, /visibility: Private/);

  await page.getByRole("button", { name: "Copy" }).click();
  assert.equal(await page.evaluate(() => window.__copiedPrivateMarkdown), combinedMarkdown);
  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .md" }).click();
  assert.equal((await markdownDownloadPromise).suggestedFilename(), "example-combined-repositories.md");

  await page.evaluate(() => {
    document.querySelector("#share-button").click();
    document.querySelector("#score-card-button").click();
  });
  assert.deepEqual(await page.evaluate(() => ({
    share: window.__privateShareCalls,
    card: window.__privateCardCalls,
    profileScore: window.__privateProfileScoreCalls,
  })), { share: 0, card: 0, profileScore: 0 });

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator(".hero").waitFor({ state: "visible" });
  assert.equal(await page.locator("#signed-out-auth").evaluate((element) => element.hidden), false);
  assert.equal(await page.locator("#result-section").isHidden(), true);
  assert.equal(await page.locator("#output").inputValue(), "");
  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

test("authorized audit resolves pins from the public profile", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await mockGithubRequests(page, [repository, secondRepository], {
    pinnedRepositories: ["authorized-public-project", "portfolio-lens"],
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      authenticated: true,
      user: { login: "example", avatar_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%2358a6ff'/%3E%3C/svg%3E" },
    },
  }));
  await page.route("**/api/private-repositories", (route) => route.fulfill({
    json: {
      installation: true,
      repositories: [
        { ...repository, name: "secret-project", full_name: "example/secret-project", html_url: "https://github.com/example/secret-project", private: true, visibility: "private" },
        { ...secondRepository, name: "authorized-public-project", full_name: "example/authorized-public-project", html_url: "https://github.com/example/authorized-public-project", private: false, visibility: "public" },
      ],
      public_repositories: [repository, secondRepository],
      readmes: { "secret-project": readme, "authorized-public-project": readme },
    },
  }));
  await page.goto(baseUrl);
  await page.locator("#home-signed-in-auth").waitFor({ state: "visible" });
  await page.locator("#home-private-audit-button").click();
  await page.locator("#audit-title").filter({ hasText: "Private Repository Audit" }).waitFor();

  // The authorized set is joined against the real pin list rather than an empty one,
  // so a pinned public repository is not mistaken for a verified-unpinned repository.
  assert.deepEqual(
    await page.evaluate(() => appState.supplemental.pinnedRepositories),
    ["authorized-public-project", "portfolio-lens"]
  );
  assert.deepEqual(
    await page.evaluate(() => appState.repositories.map((item) => ({
      name: item.name,
      pinned: item.pinned,
      pinnedPosition: item.pinnedPosition,
    }))),
    [
      { name: "secret-project", pinned: false, pinnedPosition: null },
      { name: "authorized-public-project", pinned: true, pinnedPosition: 0 },
    ]
  );

  // READMEs must still come from the authorized endpoint; the public metadata cannot see them.
  assert.deepEqual(
    await page.evaluate(() => Object.keys(appState.supplemental.readmes).sort()),
    ["authorized-public-project", "secret-project"]
  );
  assert.equal(
    await page.evaluate(() => appState.repositories.every((item) => item.readme.present === true)),
    true
  );
  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

test("Network is a profile tab that lazy loads once and is reused", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.__copiedNetwork = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedNetwork = text; } },
    });
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await mockGithubRequests(page);
  const githubApi = await mockNetworkRequests(page, {
    example: {
      // Mixed casing on both sides proves logins are compared case-insensitively.
      followers: [[account("ada-lovelace"), account("Grace-Hopper"), account("linus-t")]],
      following: [[
        account("ADA-LOVELACE"),
        account("grace-hopper"),
        account("katherine-j"),
        account("margaret-h"),
      ]],
    },
  });

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });

  // An ordinary audit must not spend the unauthenticated budget on the network.
  assert.equal(githubApi.relationshipCalls.length, 0);
  assert.equal(await page.locator("#network-tab").isVisible(), true);
  assert.equal(await page.locator("#network-tab").getAttribute("aria-controls"), "network-panel");
  assert.equal(await page.locator("#network-panel").getAttribute("aria-labelledby"), "network-tab");
  assert.equal(await page.locator("#network-panel").isHidden(), true);

  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });
  assert.ok(githubApi.relationshipCalls.length > 0);

  assert.equal(await page.locator("#network-follower-count").innerText(), "3");
  assert.equal(await page.locator("#network-following-count").innerText(), "4");
  assert.equal(await page.locator("#network-unreciprocated-count").innerText(), "2");

  assert.deepEqual(await page.locator("#network-follower-list li").allInnerTexts(), [
    "ada-lovelace", "Grace-Hopper", "linus-t",
  ]);
  assert.deepEqual(await page.locator("#network-following-list li").allInnerTexts(), [
    "ADA-LOVELACE", "grace-hopper", "katherine-j", "margaret-h",
  ]);
  assert.deepEqual(await page.locator("#network-unreciprocated-list li").allInnerTexts(), [
    "katherine-j", "margaret-h",
  ]);
  assert.equal(
    await page.locator("#network-unreciprocated-list a").first().getAttribute("href"),
    "https://github.com/katherine-j"
  );

  const markdown = await page.locator("#network-output").inputValue();
  assert.match(markdown, /^\*\*Followers:\*\* 3 {2}$/m);
  assert.match(markdown, /^\*\*Following:\*\* 4 {2}$/m);
  assert.match(markdown, /^\*\*Following who don't follow back:\*\* 2$/m);
  assert.match(
    markdown,
    /## Following who don't follow back\n\n1\. \[katherine-j\]\(https:\/\/github\.com\/katherine-j\)\n2\. \[margaret-h\]/
  );

  await page.getByRole("button", { name: "Copy Markdown" }).click();
  assert.equal(await page.evaluate(() => window.__copiedNetwork), markdown);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .md" }).click();
  assert.equal((await downloadPromise).suggestedFilename(), "example-followers-following.md");

  // Switching away and back reuses the cached result rather than refetching.
  const callsAfterFirstLoad = githubApi.relationshipCalls.length;
  await page.getByRole("tab", { name: "Audit" }).click();
  await page.locator("#audit-panel").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });

  assert.equal(githubApi.relationshipCalls.length, callsAfterFirstLoad);
  assert.equal(await page.locator("#network-follower-count").innerText(), "3");
  assert.equal(await page.locator("#network-unreciprocated-count").innerText(), "2");
  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

test("auditing a new profile invalidates the previous network", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  await mockGithubRequests(page, [repository], { login: "second" });
  const githubApi = await mockNetworkRequests(page, {
    example: { followers: [[account("alpha-follower")]], following: [[account("alpha-following")]] },
    second: { followers: [[account("beta-follower")]], following: [[account("beta-following")]] },
  });

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });
  assert.deepEqual(await page.locator("#network-follower-list li").allInnerTexts(), ["alpha-follower"]);

  // Leave the Network tab so the new audit cannot immediately reload it, making the
  // invalidation itself observable rather than the reload that would follow it.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.evaluate(() => loadProfile("second"));
  await page.locator("#profile-link").filter({ hasText: "@second" }).waitFor();

  // The previous profile's network must be gone, not merely hidden behind a tab.
  assert.equal(await page.evaluate(() => networkState.username), null);
  assert.equal(await page.evaluate(() => networkState.status), "idle");
  assert.equal(await page.evaluate(() => networkState.markdown), "");
  assert.equal(await page.evaluate(() => networkState.notFollowingBack), null);
  assert.equal(await page.locator("#network-follower-list li").count(), 0);
  assert.equal(await page.locator("#network-output").inputValue(), "");

  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });
  assert.deepEqual(await page.locator("#network-follower-list li").allInnerTexts(), ["beta-follower"]);
  assert.deepEqual(await page.locator("#network-following-list li").allInnerTexts(), ["beta-following"]);
  assert.doesNotMatch(await page.locator("#network-output").inputValue(), /alpha-/);
  assert.ok(githubApi.relationshipCalls.some((url) => url.includes("/users/second/")));
  } finally {
    await browser.close();
  }
});

test("a late network response from a previous profile cannot populate the new one", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  await mockGithubRequests(page, [repository], { login: "second" });
  await mockNetworkRequests(page, {
    example: {
      relationshipDelay: 900,
      followers: [[account("stale-follower")]],
      following: [[account("stale-following")]],
    },
    second: { followers: [[account("fresh-follower")]], following: [[account("fresh-following")]] },
  });

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "Network" }).click();
  await page.waitForFunction(() => networkState.status === "loading");

  // Audit a different profile while the first network request is still in flight.
  await page.evaluate(() => loadProfile("second"));
  await page.locator("#profile-link").filter({ hasText: "@second" }).waitFor();
  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });
  assert.deepEqual(await page.locator("#network-follower-list li").allInnerTexts(), ["fresh-follower"]);

  await page.waitForTimeout(1200);

  assert.equal(await page.evaluate(() => networkState.username), "second");
  assert.deepEqual(await page.locator("#network-follower-list li").allInnerTexts(), ["fresh-follower"]);
  assert.equal(await page.locator("#network-unreciprocated-list li").count(), 1);
  const markdown = await page.locator("#network-output").inputValue();
  assert.match(markdown, /fresh-follower/);
  assert.doesNotMatch(markdown, /stale-/);
  } finally {
    await browser.close();
  }
});

test("an incomplete retrieval withholds the derived set and the export", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  await mockNetworkRequests(page, {
    example: {
      followers: [accountList("follower", 100), { failWith: 500 }],
      following: [[account("katherine-j")]],
    },
  });

  await page.goto(`${baseUrl}/?user=example&view=network`);
  await page.locator("#network-results").waitFor({ state: "visible" });

  assert.match(await page.locator("#network-follower-count").innerText(), /100 retrieved \(incomplete\)/);
  assert.equal(await page.locator("#network-unreciprocated-count").innerText(), "Unavailable");
  assert.equal(await page.locator("#network-unreciprocated-section").isHidden(), true);
  assert.match(await page.locator("#network-notice").innerText(), /Followers could not be fully retrieved/);
  assert.equal(await page.locator("#network-export").isHidden(), true);
  assert.equal(await page.locator("#network-output").inputValue(), "");
  assert.equal(await page.evaluate(() => networkState.markdown), "");
  assert.equal(await page.evaluate(() => networkState.notFollowingBack), null);

  // katherine-j is followed but absent from the partial followers list; the page
  // must not claim she does not follow back.
  assert.equal(await page.locator("#network-unreciprocated-list li").count(), 0);
  } finally {
    await browser.close();
  }
});

test("an empty derived set is reported as zero rather than unavailable", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  await mockNetworkRequests(page, {
    example: {
      followers: [[account("ada-lovelace"), account("extra-follower")]],
      following: [[account("Ada-Lovelace")]],
    },
  });

  await page.goto(`${baseUrl}/?user=example&view=network`);
  await page.locator("#network-results").waitFor({ state: "visible" });

  assert.equal(await page.locator("#network-unreciprocated-count").innerText(), "0");
  assert.equal(await page.locator("#network-unreciprocated-section").isHidden(), false);
  assert.match(
    await page.locator("#network-unreciprocated-empty").innerText(),
    /Everyone you follow also follows you/
  );
  assert.match(
    await page.locator("#network-output").inputValue(),
    /## Following who don't follow back\n\nNone\./
  );
  } finally {
    await browser.close();
  }
});

test("a network failure is retryable without refetching on every tab switch", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  const githubApi = await mockNetworkRequests(page, {
    example: { followers: [{ failWith: 403 }], following: [[account("katherine-j")]] },
  });

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-status.error").waitFor();

  // A per-page failure is reported as an incomplete list, so the status names the
  // outcome and the notice carries GitHub's own reason.
  const status = await page.locator("#network-status").innerText();
  const notice = await page.locator("#network-notice").innerText();
  assert.match(status, /could not be completely retrieved/i);
  assert.match(notice, /rate limit was reached/i);
  assert.doesNotMatch(notice, /not found/i);
  assert.doesNotMatch(status, /not found/i);
  assert.equal(await page.locator("#network-retry-button").isVisible(), true);
  assert.equal(await page.locator("#network-export").isHidden(), true);
  assert.equal(await page.locator("#network-unreciprocated-count").innerText(), "Unavailable");

  // A failed attempt must not silently re-request on every tab switch, because the
  // usual cause is the rate limit and retrying would spend the remaining budget.
  const callsAfterFailure = githubApi.relationshipCalls.length;
  await page.getByRole("tab", { name: "Audit" }).click();
  await page.getByRole("tab", { name: "Network" }).click();
  assert.equal(githubApi.relationshipCalls.length, callsAfterFailure);

  const requestIdBeforeRetry = await page.evaluate(() => networkState.requestId);
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForFunction(
    (previous) => networkState.requestId > previous,
    requestIdBeforeRetry
  );
  await page.locator("#network-status.error").waitFor();
  assert.ok(githubApi.relationshipCalls.length > callsAfterFailure);
  } finally {
    await browser.close();
  }
});

test("six result tabs stay keyboard navigable and fit a mobile viewport", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockGithubRequests(page);
  await mockNetworkRequests(page, {
    example: {
      followers: [[account("ada-lovelace")]],
      following: [[account("ada-lovelace"), account("katherine-j")]],
    },
  });

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });

  // Roving tabindex and arrow keys must still work with a sixth tab present.
  assert.deepEqual(
    await page.locator(".tabs .tab").evaluateAll((tabs) => tabs.map((tab) => tab.dataset.tab)),
    ["overview", "audit", "repositories", "network", "pinned", "markdown"]
  );

  await page.locator("#repositories-tab").click();
  assert.equal(await page.locator("#repositories-tab").getAttribute("tabindex"), "0");
  await page.locator("#repositories-tab").press("ArrowRight");
  assert.equal(await page.locator("#network-tab").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#network-tab").getAttribute("tabindex"), "0");
  assert.equal(await page.locator("#repositories-tab").getAttribute("tabindex"), "-1");
  assert.equal(await page.locator("#network-panel").isVisible(), true);

  await page.locator("#network-tab").press("ArrowRight");
  assert.equal(await page.locator("#pinned-tab").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#pinned-panel").isVisible(), true);
  await page.locator("#pinned-tab").press("ArrowRight");
  assert.equal(await page.locator("#markdown-tab").getAttribute("aria-selected"), "true");
  await page.locator("#markdown-tab").press("ArrowLeft");
  assert.equal(await page.locator("#pinned-tab").getAttribute("aria-selected"), "true");
  await page.locator("#pinned-tab").press("Home");
  assert.equal(await page.locator("#overview-tab").getAttribute("aria-selected"), "true");
  await page.locator("#overview-tab").press("End");
  assert.equal(await page.locator("#markdown-tab").getAttribute("aria-selected"), "true");

  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    tabsScrollable: document.querySelector(".tabs").scrollWidth > document.querySelector(".tabs").clientWidth,
  }));
  assert.ok(
    dimensions.content <= dimensions.viewport,
    `page width ${dimensions.content}px exceeds ${dimensions.viewport}px viewport`
  );
  assert.equal(await page.locator("#network-copy-button").isVisible(), true);
  assert.equal(await page.locator("#network-download-button").isVisible(), true);
  } finally {
    await browser.close();
  }
});

test("opening Network leaves the repository audit and its exports untouched", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await mockGithubRequests(page);
  await mockNetworkRequests(page, {
    example: { followers: [[account("ada-lovelace")]], following: [[account("katherine-j")]] },
  });

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "Markdown export" }).click();

  const readAuditState = () => page.evaluate(() => ({
    score: document.querySelector("#overall-score").textContent,
    repositories: appState.repositories.map((item) => item.name),
    audits: appState.audits.map((item) => ({ name: item.name, score: item.score })),
    candidacy: appState.audits.map((item) => item.candidate?.label ?? null),
    mode: appState.mode,
    markdown: document.querySelector("#output").value,
  }));
  const before = await readAuditState();

  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });
  assert.match(await page.locator("#network-output").inputValue(), /ada-lovelace/);

  await page.getByRole("tab", { name: "Markdown export" }).click();
  await page.locator("#markdown-panel").waitFor({ state: "visible" });
  const after = await readAuditState();

  assert.deepEqual(after, before);
  assert.equal(await page.evaluate(() => "network" in appState), false);
  assert.match(after.markdown, /portfolio-lens/);
  assert.doesNotMatch(after.markdown, /ada-lovelace|GitHub Network|follow back/i);

  // The two Markdown artifacts stay separate documents in separate tabs.
  assert.match(await page.locator("#network-output").inputValue(), /^# GitHub Network/);
  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

test("large network lists are disclosed 25 at a time", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  await mockNetworkRequests(page, {
    example: {
      followers: [accountList("follower", 100)],
      // 62 following accounts, none of which follow back, gives an uneven final page.
      following: [accountList("following", 62)],
    },
  });

  await page.goto(`${baseUrl}/?user=example&view=network`);
  await page.locator("#network-results").waitFor({ state: "visible" });

  // Only the visible slice reaches the DOM; the rest is held in memory, not hidden.
  assert.equal(await page.locator("#network-follower-list li").count(), 25);
  assert.equal(await page.locator("#network-following-list li").count(), 25);
  assert.equal(await page.locator("#network-unreciprocated-list li").count(), 25);
  assert.equal(await page.locator("#network-followers-status").innerText(), "Showing 25 of 100");
  assert.equal(await page.locator("#network-following-status").innerText(), "Showing 25 of 62");
  assert.equal(await page.locator("#network-unreciprocated-status").innerText(), "Showing 25 of 62");
  assert.equal(await page.locator("#network-follower-list").innerText().then((t) => t.includes("follower-26")), false);

  // The count cards keep reporting the complete totals.
  assert.equal(await page.locator("#network-follower-count").innerText(), "100");
  assert.equal(await page.locator("#network-following-count").innerText(), "62");
  assert.equal(await page.locator("#network-unreciprocated-count").innerText(), "62");

  assert.equal(await page.locator("#network-followers-collapse").isHidden(), true);
  assert.equal(await page.locator("#network-followers-more").isVisible(), true);
  assert.equal(await page.locator("#network-followers-all").isVisible(), true);

  // 25 -> 50 -> 75 -> 100, without duplicates.
  await page.getByRole("button", { name: "Show 25 more Followers" }).click();
  assert.equal(await page.locator("#network-follower-list li").count(), 50);
  assert.equal(await page.locator("#network-followers-status").innerText(), "Showing 50 of 100");
  assert.equal(await page.locator("#network-followers-collapse").isVisible(), true);

  await page.getByRole("button", { name: "Show 25 more Followers" }).click();
  await page.getByRole("button", { name: "Show 25 more Followers" }).click();
  const followerLogins = await page.locator("#network-follower-list li").allInnerTexts();
  assert.equal(followerLogins.length, 100);
  assert.equal(new Set(followerLogins).size, 100);
  assert.equal(followerLogins[0], "follower-1");
  assert.equal(followerLogins[99], "follower-100");
  assert.equal(await page.locator("#network-followers-status").innerText(), "Showing all 100");
  assert.equal(await page.locator("#network-followers-more").isHidden(), true);
  assert.equal(await page.locator("#network-followers-all").isHidden(), true);

  // Expanding Followers must not disturb the other sections.
  assert.equal(await page.locator("#network-following-list li").count(), 25);
  assert.equal(await page.locator("#network-unreciprocated-list li").count(), 25);

  // An uneven final page never overshoots the real total.
  await page.getByRole("button", { name: "Show 25 more Following users" }).click();
  assert.equal(await page.locator("#network-following-status").innerText(), "Showing 50 of 62");
  await page.getByRole("button", { name: "Show 25 more Following users" }).click();
  assert.equal(await page.locator("#network-following-list li").count(), 62);
  assert.equal(await page.locator("#network-following-status").innerText(), "Showing all 62");

  // Show all and Collapse work on the derived section too.
  await page.getByRole("button", { name: "Show all users who don't follow back" }).click();
  assert.equal(await page.locator("#network-unreciprocated-list li").count(), 62);
  assert.equal(await page.locator("#network-unreciprocated-status").innerText(), "Showing all 62");

  await page.getByRole("button", { name: "Collapse users who don't follow back" }).click();
  assert.equal(await page.locator("#network-unreciprocated-list li").count(), 25);
  assert.equal(await page.locator("#network-unreciprocated-status").innerText(), "Showing 25 of 62");
  assert.equal(await page.locator("#network-unreciprocated-collapse").isHidden(), true);
  assert.deepEqual(
    (await page.locator("#network-unreciprocated-list li").allInnerTexts()).slice(0, 2),
    ["following-1", "following-2"]
  );
  } finally {
    await browser.close();
  }
});

test("disclosure never changes the exported Markdown", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.__copiedNetwork = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedNetwork = text; } },
    });
  });
  const page = await context.newPage();
  await mockGithubRequests(page);
  await mockNetworkRequests(page, {
    example: { followers: [accountList("follower", 100)], following: [accountList("following", 100)] },
  });

  await page.goto(`${baseUrl}/?user=example&view=network`);
  await page.locator("#network-results").waitFor({ state: "visible" });

  assert.equal(await page.locator("#network-follower-list li").count(), 25);
  const collapsedMarkdown = await page.locator("#network-output").inputValue();

  // The UI shows 25; the export must still describe all 100 on each side.
  assert.match(collapsedMarkdown, /^\*\*Followers:\*\* 100 {2}$/m);
  assert.match(collapsedMarkdown, /^\*\*Following:\*\* 100 {2}$/m);
  assert.match(collapsedMarkdown, /^\*\*Following who don't follow back:\*\* 100$/m);
  assert.match(collapsedMarkdown, /^26\. \[follower-26\]\(https:\/\/github\.com\/follower-26\)$/m);
  assert.match(collapsedMarkdown, /^100\. \[follower-100\]\(https:\/\/github\.com\/follower-100\)$/m);
  assert.match(collapsedMarkdown, /^100\. \[following-100\]\(https:\/\/github\.com\/following-100\)$/m);
  assert.equal((collapsedMarkdown.match(/^\d+\. \[follower-/gm) || []).length, 100);
  assert.equal((collapsedMarkdown.match(/^\d+\. \[following-/gm) || []).length, 200);

  await page.getByRole("button", { name: "Copy Markdown" }).click();
  assert.equal(await page.evaluate(() => window.__copiedNetwork), collapsedMarkdown);

  // Expanding and collapsing is presentation only; the export is byte-identical.
  await page.getByRole("button", { name: "Expand all network lists" }).click();
  assert.equal(await page.locator("#network-follower-list li").count(), 100);
  assert.equal(await page.locator("#network-output").inputValue(), collapsedMarkdown);

  await page.getByRole("button", { name: "Collapse all network lists" }).click();
  assert.equal(await page.locator("#network-follower-list li").count(), 25);
  assert.equal(await page.locator("#network-following-list li").count(), 25);
  assert.equal(await page.locator("#network-unreciprocated-list li").count(), 25);
  assert.equal(await page.locator("#network-output").inputValue(), collapsedMarkdown);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .md" }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "example-followers-following.md");

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString("utf8"), collapsedMarkdown);
  } finally {
    await browser.close();
  }
});

test("short and empty network lists show no disclosure controls", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  await mockNetworkRequests(page, {
    example: {
      followers: [accountList("follower", 12)],
      // Every followed account also follows, so the derived list is empty.
      following: [[account("follower-1"), account("follower-2")]],
    },
  });

  await page.goto(`${baseUrl}/?user=example&view=network`);
  await page.locator("#network-results").waitFor({ state: "visible" });

  assert.equal(await page.locator("#network-follower-list li").count(), 12);
  assert.equal(await page.locator("#network-followers-status").innerText(), "12 users");
  assert.doesNotMatch(await page.locator("#network-followers-status").innerText(), /Showing 25 of/);
  assert.equal(await page.locator("#network-followers-controls").isHidden(), true);
  assert.equal(await page.locator("#network-followers-more").isHidden(), true);
  assert.equal(await page.locator("#network-followers-all").isHidden(), true);
  assert.equal(await page.locator("#network-followers-collapse").isHidden(), true);

  assert.equal(await page.locator("#network-following-status").innerText(), "2 users");
  assert.equal(await page.locator("#network-following-controls").isHidden(), true);

  // Zero is known data: the empty state stays, with no controls attached to it.
  assert.equal(await page.locator("#network-unreciprocated-count").innerText(), "0");
  assert.match(
    await page.locator("#network-unreciprocated-empty").innerText(),
    /Everyone you follow also follows you/
  );
  assert.equal(await page.locator("#network-unreciprocated-list li").count(), 0);
  assert.equal(await page.locator("#network-unreciprocated-status").isHidden(), true);
  assert.equal(await page.locator("#network-unreciprocated-controls").isHidden(), true);

  // No section is long enough to need the shared controls.
  assert.equal(await page.locator("#network-disclosure-controls").isHidden(), true);
  } finally {
    await browser.close();
  }
});

test("disclosure survives tab switches and resets for a new profile", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page);
  await mockGithubRequests(page, [repository], { login: "second" });
  const githubApi = await mockNetworkRequests(page, {
    example: { followers: [accountList("follower", 80)], following: [accountList("following", 80)] },
    second: { followers: [accountList("beta", 80)], following: [accountList("beta-following", 80)] },
  });

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Show 25 more Following users" }).click();
  assert.equal(await page.locator("#network-following-list li").count(), 50);
  assert.equal(await page.locator("#network-follower-list li").count(), 25);

  // Leaving and returning must not silently collapse what the reader expanded.
  const callsBefore = githubApi.relationshipCalls.length;
  await page.getByRole("tab", { name: "Audit" }).click();
  await page.locator("#audit-panel").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });

  assert.equal(githubApi.relationshipCalls.length, callsBefore);
  assert.equal(await page.locator("#network-following-list li").count(), 50);
  assert.equal(await page.locator("#network-following-status").innerText(), "Showing 50 of 80");
  assert.equal(await page.locator("#network-follower-list li").count(), 25);

  await page.getByRole("button", { name: "Show all Following users" }).click();
  assert.equal(await page.locator("#network-following-list li").count(), 80);

  // A different profile starts collapsed again rather than inheriting the state.
  await page.evaluate(() => loadProfile("second"));
  await page.locator("#profile-link").filter({ hasText: "@second" }).waitFor();
  await page.getByRole("tab", { name: "Network" }).click();
  await page.locator("#network-results").waitFor({ state: "visible" });

  assert.deepEqual(await page.evaluate(() => networkState.visibleCounts), {
    followers: 25,
    following: 25,
    unreciprocated: 25,
  });
  assert.equal(await page.locator("#network-following-list li").count(), 25);
  assert.equal(await page.locator("#network-following-status").innerText(), "Showing 25 of 80");
  assert.equal(await page.locator("#network-follower-list li").count(), 25);
  assert.match(await page.locator("#network-follower-list").innerText(), /beta-1/);
  assert.doesNotMatch(await page.locator("#network-follower-list").innerText(), /follower-/);
  } finally {
    await browser.close();
  }
});

test("disclosure controls are keyboard operable and wrap on mobile", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockGithubRequests(page);
  await mockNetworkRequests(page, {
    example: { followers: [accountList("follower", 90)], following: [accountList("following", 90)] },
  });

  await page.goto(`${baseUrl}/?user=example&view=network`);
  await page.locator("#network-results").waitFor({ state: "visible" });

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.content <= dimensions.viewport,
    `page width ${dimensions.content}px exceeds ${dimensions.viewport}px viewport`
  );

  // Every control is a real button reachable and operable from the keyboard.
  const moreButton = page.locator("#network-followers-more");
  assert.equal(await moreButton.evaluate((node) => node.tagName), "BUTTON");
  await moreButton.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#network-follower-list li").count(), 50);
  assert.equal(await page.evaluate(() => document.activeElement.id), "network-followers-more");

  await page.locator("#network-followers-all").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#network-follower-list li").count(), 90);

  // Show all hides itself, so focus lands on the control that replaced it rather
  // than falling back to the document body.
  assert.equal(await page.evaluate(() => document.activeElement.id), "network-followers-collapse");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#network-follower-list li").count(), 25);
  assert.equal(await page.evaluate(() => document.activeElement.id), "network-followers-more");
  } finally {
    await browser.close();
  }
});


test("network lists keep the API order and claim no follow chronology", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await mockGithubRequests(page);

  // A deliberately unsorted order. Anything that re-sorted the list, alphabetically
  // or by the id the fixture carries, would visibly disturb this sequence.
  const shuffled = [30, 4, 21, 8, 15, 1, 27, 12, 19, 6, 25, 10, 17, 3, 23, 14, 29, 7, 20, 11,
                    26, 2, 18, 13, 28, 5, 22, 9, 24, 16].map((n) => account(`user-${n}`));
  await mockNetworkRequests(page, {
    example: { followers: [[]], following: [shuffled] },
  });

  await page.goto(`${baseUrl}/?user=example&view=network`);
  await page.locator("#network-results").waitFor({ state: "visible" });

  const expected = shuffled.map((entry) => entry.login);

  // Ordering is applied to the complete list before the first 25 are sliced off,
  // so the initial page is the first 25 of the API order, not a re-sorted subset.
  assert.deepEqual(await page.locator("#network-following-list li").allInnerTexts(), expected.slice(0, 25));

  // Nobody follows back, so the derived list must inherit the Following order.
  assert.deepEqual(
    await page.locator("#network-unreciprocated-list li").allInnerTexts(),
    expected.slice(0, 25)
  );

  await page.getByRole("button", { name: "Show 25 more Following users" }).click();
  assert.deepEqual(await page.locator("#network-following-list li").allInnerTexts(), expected);

  await page.getByRole("button", { name: "Collapse Following users" }).click();
  assert.deepEqual(await page.locator("#network-following-list li").allInnerTexts(), expected.slice(0, 25));

  await page.getByRole("button", { name: "Show all Following users" }).click();
  assert.deepEqual(await page.locator("#network-following-list li").allInnerTexts(), expected);

  // Leaving and returning to the tab reuses the loaded network rather than
  // refetching it, so the order cannot change underneath the reader.
  await page.locator("#overview-tab").click();
  await page.locator("#network-tab").click();
  await page.locator("#network-results").waitFor({ state: "visible" });
  assert.deepEqual(await page.locator("#network-following-list li").allInnerTexts(), expected);

  // The interface states the ordering neutrally.
  const note = await page.locator("#network-ordering-note").innerText();
  assert.match(note, /order the GitHub API returned them/);

  // No chronology claim anywhere in the panel or the export, once the note that
  // explicitly denies one is set aside.
  const panelText = (await page.locator("#network-panel").innerText()).split(note).join("");
  const markdown = await page.locator("#network-output").inputValue();
  const exportText = markdown.split(note.trim()).join("");
  for (const surface of [panelText, exportText]) {
    assert.doesNotMatch(surface, /newest\s+(follow|first)/i);
    assert.doesNotMatch(surface, /oldest\s+(follow|first|last)/i);
    assert.doesNotMatch(surface, /most\s+recent(ly)?\s+follow/i);
    assert.doesNotMatch(surface, /chronological/i);
    assert.doesNotMatch(surface, /\bfollowed[\s_]?at\b/i);
  }

  // The export lists the same accounts in the same order as the interface.
  const exported = markdown
    .split("## Following\n")[1]
    .split("## Following who")[0]
    .match(/\[([^\]]+)\]/g)
    .map((match) => match.slice(1, -1));
  assert.deepEqual(exported, expected);

  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

/**
 * Repository fixtures for the pinned optimizer view.
 *
 * The set is built so that one profile exercises every advisory action at once:
 * a pinned Strong candidate to keep, an unpinned Strong candidate to add, a
 * pinned De-emphasize repository to replace, and an archived original and a fork
 * that must both rank below confirmed active original work.
 */
const optimizerRepositories = [
  repository,
  {
    ...repository,
    name: "rust-engine",
    full_name: "example/rust-engine",
    html_url: "https://github.com/example/rust-engine",
    description: "Deterministic layout engine with a documented plugin interface",
    language: "Rust",
    topics: ["rust", "layout-engine"],
    homepage: null,
  },
  {
    ...repository,
    name: "retired-service",
    full_name: "example/retired-service",
    html_url: "https://github.com/example/retired-service",
    description: "Retired ingestion service kept for reference and historical context",
    language: "Python",
    topics: ["python", "ingestion"],
    homepage: null,
    archived: true,
  },
  {
    ...repository,
    name: "upstream-tool",
    full_name: "example/upstream-tool",
    html_url: "https://github.com/example/upstream-tool",
    description: "Command line tool for inspecting build graphs across large monorepos",
    language: "Go",
    topics: ["go", "build-tools"],
    homepage: null,
    fork: true,
  },
  {
    ...repository,
    name: "legacy-notes",
    full_name: "example/legacy-notes",
    html_url: "https://github.com/example/legacy-notes",
    description: null,
    language: "HTML",
    topics: [],
    license: null,
    homepage: null,
  },
];

test("pinned optimizer renders the recommended set, the current pins, and the difference", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  let repositoryRequests = 0;
  page.on("request", (request) => {
    if (/api\.github\.com|\/api\/pinned-repositories/.test(request.url())) repositoryRequests += 1;
  });

  await mockGithubRequests(page, optimizerRepositories, {
    pinnedRepositories: ["portfolio-lens", "legacy-notes"],
    readmes: { "legacy-notes": { present: false, size: null } },
  });

  await page.goto(`${baseUrl}/?user=example`);
  await page.locator("#result-section").waitFor({ state: "visible" });
  const requestsBeforeOptimizer = repositoryRequests;

  // Scores captured before the tab is opened, so the optimizer can be shown not to
  // move any of them.
  const scoresBefore = await page.evaluate(() =>
    Object.fromEntries(appState.audits.map((audit) => [audit.repository.name, audit.score])));

  await page.getByRole("tab", { name: "Pinned optimizer" }).click();
  await page.locator("#pinned-panel").waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).searchParams.get("view"), "pinned");

  // Opening the optimizer costs no additional GitHub request.
  assert.equal(repositoryRequests, requestsBeforeOptimizer);
  assert.deepEqual(await page.evaluate(() =>
    Object.fromEntries(appState.audits.map((audit) => [audit.repository.name, audit.score]))), scoresBefore);

  assert.match(await page.locator("#pinned-summary").innerText(), /4 of up to 6 slots recommended, from 4 eligible repositories/);

  const recommended = page.locator("#pinned-recommended-list .pinned-card");
  assert.deepEqual(
    await recommended.locator(".pinned-card-name").allInnerTexts(),
    ["1\nportfolio-lens", "2\nrust-engine", "3\nretired-service", "4\nupstream-tool"]
  );
  assert.deepEqual(
    await recommended.locator(".candidate-badge").allInnerTexts(),
    ["Strong candidate", "Strong candidate", "Worth polishing", "Worth polishing"]
  );
  assert.match(await recommended.first().locator(".pinned-score").innerText(), /Presentation score: \d+/);

  // Rationale is visible without expanding anything.
  const rustReasons = await recommended.nth(1).locator(".pinned-reasons").innerText();
  assert.match(rustReasons, /Classified Strong candidate/);
  assert.match(rustReasons, /Adds Rust, which no other recommended repository represents/);

  const archivedReasons = await recommended.nth(2).locator(".pinned-reasons").innerText();
  assert.match(archivedReasons, /It is archived, so it is recommended below comparable active repositories/);

  const forkReasons = await recommended.nth(3).locator(".pinned-reasons").innerText();
  assert.match(forkReasons, /GitHub identifies this repository as a fork/);
  assert.match(forkReasons, /cannot determine how much of the implementation belongs to the profile owner/);
  assert.doesNotMatch(forkReasons, /did no work|no original work/i);

  // Current pinned set, marked against the recommendation.
  assert.match(await page.locator("#pinned-current-note").innerText(), /GitHub reports 2 pinned repositories/);
  assert.deepEqual(
    await page.locator("#pinned-current-list .pinned-current-item").allInnerTexts(),
    ["✓\nportfolio-lens\nIn the recommended set", "✕\nlegacy-notes\nNot in the recommended set"]
  );

  // Suggested changes.
  const changes = page.locator("#pinned-changes-list .pinned-change");
  assert.deepEqual(await changes.locator(".pinned-action").allInnerTexts(),
    ["Keep", "Consider replacing", "Consider adding", "Consider adding"]);
  const replacement = changes.nth(1);
  assert.equal(await replacement.locator("strong").innerText(), "legacy-notes");
  const replacementText = await replacement.locator("p").innerText();
  assert.match(replacementText, /Consider replacing legacy-notes with rust-engine/);
  assert.match(replacementText, /rust-engine is classified Strong candidate and adds Rust/);
  assert.match(replacementText, /while legacy-notes did not meet the recommendation criteria/);
  assert.doesNotMatch(replacementText, /\bis better\b|\bbad\b|remove immediately/i);

  // Repositories that were never considered, and why.
  assert.equal(await page.locator("#pinned-excluded-section").isVisible(), true);
  assert.match(await page.locator("#pinned-excluded-list").innerText(), /Classified De-emphasize/);
  assert.match(await page.locator("#pinned-excluded-list").innerText(), /legacy-notes/);
  assert.equal(await page.locator("#pinned-private-section").isHidden(), true);

  // Methodology lists only the signals the optimizer actually uses.
  const methodology = page.locator("#pinned-panel .methodology");
  assert.equal(await methodology.locator("summary").innerText(), "How recommendations are chosen");
  await methodology.locator("summary").click();
  const methodologyText = await methodology.innerText();
  assert.match(methodologyText, /portfolio candidacy first/);
  assert.match(methodologyText, /confirmed original work ahead of unreported fork status/);
  assert.match(methodologyText, /active work ahead of archived work/);
  assert.match(methodologyText, /only set-level signals it uses are primary language and topic overlap/);
  assert.match(methodologyText, /never evidence that a repository deserves to be recommended/);

  // Navigation to the repository's own audit card.
  await recommended.nth(1).getByRole("button", { name: "View repository audit" }).click();
  assert.equal(await page.locator("#audit-panel").isVisible(), true);
  assert.equal(await page.locator("#audit-tab").getAttribute("aria-selected"), "true");
  const highlighted = page.locator(".audit-card.is-highlighted");
  assert.equal(await highlighted.count(), 1);
  assert.match(await highlighted.innerText(), /rust-engine/);

  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

test("pinned optimizer recommends fewer than six and says why", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockGithubRequests(page, [repository, optimizerRepositories[4]], {
    pinnedRepositories: ["portfolio-lens"],
    readmes: { "legacy-notes": { present: false, size: null } },
  });

  await page.goto(`${baseUrl}/?user=example&view=pinned`);
  await page.locator("#pinned-panel").waitFor({ state: "visible" });

  assert.equal(await page.locator("#pinned-recommended-list .pinned-card").count(), 1);
  const shortfall = page.locator("#pinned-shortfall");
  assert.equal(await shortfall.isVisible(), true);
  assert.match(await shortfall.innerText(), /found one repository that currently meets the recommendation criteria/);
  assert.match(await shortfall.innerText(), /does not recommend filling the remaining slots with weaker candidates/);

  // Pins already match, so nothing is manufactured.
  assert.equal(await page.locator("#pinned-changes-list .pinned-change").count(), 0);
  assert.match(await page.locator("#pinned-changes-note").innerText(),
    /already match the optimizer's recommended set/);
  } finally {
    await browser.close();
  }
});

test("pinned optimizer reports unverified pin metadata as unknown", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockGithubRequests(page);
  await page.route("**/api/pinned-repositories?username=example", (route) =>
    route.fulfill({ status: 503, json: { error: "The GitHub API token is not configured." } }));

  await page.goto(`${baseUrl}/?user=example&view=pinned`);
  await page.locator("#pinned-panel").waitFor({ state: "visible" });

  assert.match(await page.locator("#pinned-current-note").innerText(),
    /could not verify which repositories this profile pins/);
  assert.equal(await page.locator("#pinned-current-list li").count(), 0);
  assert.match(await page.locator("#pinned-changes-note").innerText(),
    /Pinned repository data was unavailable, so there is nothing to compare/);

  // The recommendation still stands, and every entry names what was unverified.
  assert.ok(await page.locator("#pinned-recommended-list .pinned-card").count() > 0);
  assert.match(await page.locator("#pinned-recommended-list").innerText(), /could not verify README status/);

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.content <= dimensions.viewport,
    `page width ${dimensions.content}px exceeds ${dimensions.viewport}px viewport`);
  } finally {
    await browser.close();
  }
});

test("authorized audit separates strong private work from the publicly pinnable set", { skip: !chromePath }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const privateRepository = {
    ...repository,
    name: "internal-platform",
    full_name: "example/internal-platform",
    html_url: "https://github.com/example/internal-platform",
    description: "Internal deployment platform with documented runbooks and topics",
    language: "Go",
    topics: ["go", "platform"],
    homepage: null,
    private: true,
    visibility: "private",
  };

  await mockGithubRequests(page, [repository], { pinnedRepositories: ["portfolio-lens"] });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      authenticated: true,
      user: { login: "example", avatar_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%2358a6ff'/%3E%3C/svg%3E" },
    },
  }));
  await page.route("**/api/private-repositories", (route) => route.fulfill({
    json: {
      installation: true,
      repositories: [privateRepository, repository],
      public_repositories: [repository],
      readmes: { "internal-platform": readme, "portfolio-lens": readme },
      metadata: { complete: true },
    },
  }));

  await page.goto(baseUrl);
  await page.locator("#home-signed-in-auth").waitFor({ state: "visible" });
  await page.locator("#home-private-audit-button").click();
  await page.locator("#audit-title").filter({ hasText: "Private Repository Audit" }).waitFor();

  await page.getByRole("tab", { name: "Pinned optimizer" }).click();
  await page.locator("#pinned-panel").waitFor({ state: "visible" });

  // The private repository is a Strong candidate, and is kept out of the set that
  // a public profile could actually pin.
  assert.equal(await page.evaluate(() =>
    appState.audits.find((audit) => audit.repository.name === "internal-platform").candidate.label), "strong");
  assert.deepEqual(
    await page.locator("#pinned-recommended-list .pinned-card .pinned-card-name").allInnerTexts(),
    ["1\nportfolio-lens"]
  );

  const privateSection = page.locator("#pinned-private-section");
  assert.equal(await privateSection.isVisible(), true);
  const privateText = await privateSection.innerText();
  assert.match(privateText, /internal-platform/);
  assert.match(privateText, /Strong candidate · not publicly pinnable/);
  assert.match(privateText, /A public GitHub profile cannot pin them/);
  assert.doesNotMatch(privateText, /make (it|them) public|publish (it|them)/i);

  assert.match(await page.locator("#pinned-excluded-list").innerText(),
    /Private, so it cannot be featured on a public GitHub profile/);

  // Private repository names never reach the shared audit URL.
  assert.doesNotMatch(page.url(), /internal-platform/);
  assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
});

/**
 * builds one raw github account entry
 * @param {string} login github login
 * @returns {Object} raw github account entry
 */
function account(login) {
  return { login, html_url: `https://github.com/${login}`, id: login.length };
}

/**
 * builds a page of raw github account entries
 * @param {string} prefix login prefix
 * @param {number} count number of accounts
 * @param {number} offset starting index
 * @returns {Array<Object>} raw github account entries
 */
function accountList(prefix, count, offset = 0) {
  return Array.from({ length: count }, (unused, index) => account(`${prefix}-${offset + index + 1}`));
}

/**
 * mocks the public follower and following endpoints used by the Network tab
 *
 * Registered after mockGithubRequests so it is consulted first; anything that is
 * not a followers or following request falls back to the audit mocks.
 *
 * @param {Object} page playwright page
 * @param {Object} accounts map of login to relationship pages
 * @returns {Promise<Object>} recorded relationship request urls
 */
async function mockNetworkRequests(page, accounts) {
  const relationshipCalls = [];

  await page.route("https://api.github.com/users/*/followers**", (route) =>
    respondWithRelationship(route, accounts, relationshipCalls)
  );
  await page.route("https://api.github.com/users/*/following**", (route) =>
    respondWithRelationship(route, accounts, relationshipCalls)
  );

  return { relationshipCalls };
}

/**
 * answers one paginated relationship request from prepared pages
 * @param {Object} route playwright route
 * @param {Object} accounts map of login to relationship pages
 * @param {Array<string>} relationshipCalls recorded request urls
 * @returns {Promise<void>} no return value
 */
async function respondWithRelationship(route, accounts, relationshipCalls) {
  const requestUrl = new URL(route.request().url());
  const [, , login, relationship] = requestUrl.pathname.split("/");
  const entry = accounts[login];

  if (!entry) {
    await route.fulfill({ status: 404, json: { message: "Not Found" } });
    return;
  }

  relationshipCalls.push(requestUrl.toString());
  if (entry.relationshipDelay) {
    await new Promise((resolve) => setTimeout(resolve, entry.relationshipDelay));
  }

  const pageNumber = Number(requestUrl.searchParams.get("page"));
  const pageEntry = (entry[relationship] || [[]])[pageNumber - 1];

  if (pageEntry === undefined) {
    await route.fulfill({ json: [] });
    return;
  }
  if (pageEntry.failWith) {
    await route.fulfill({
      status: pageEntry.failWith,
      headers: { "Content-Type": "application/json", "X-RateLimit-Reset": "1800000000" },
      body: JSON.stringify({ message: "boom" }),
    });
    return;
  }
  await route.fulfill({ json: pageEntry });
}

async function mockGithubRequests(page, repositories = [repository, secondRepository], options = {}) {
  const login = options.login || "example";
  const avatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%2358a6ff'/%3E%3C/svg%3E";
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } })
  );
  await page.route(`https://api.github.com/users/${login}`, async (route) => {
    if (options.profileDelay) {
      await new Promise((resolve) => setTimeout(resolve, options.profileDelay));
    }
    await route.fulfill({ json: { login, name: "Example User", avatar_url: avatar, html_url: `https://github.com/${login}` } });
  });
  await page.route(`https://api.github.com/users/${login}/repos**`, (route) =>
    route.fulfill({ json: repositories })
  );
  await page.route(`**/api/pinned-repositories?username=${login}`, (route) =>
    route.fulfill({
      json: {
        repositories: options.pinnedRepositories || (repositories.length ? [repository.name] : []),
        readmes: {
          ...Object.fromEntries(repositories.map((item) => [item.name, readme])),
          ...options.readmes,
        },
      },
    })
  );
  await page.route(`**/api/report?user=${login}`, (route) =>
    route.fulfill({ json: { contributed_repositories: options.contributions || [] } })
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
