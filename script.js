const form = document.querySelector("#github-form");
const usernameInput = document.querySelector("#username");
const generateButton = document.querySelector("#generate-button");
const statusEl = document.querySelector("#status");
const hero = document.querySelector(".hero");
const loadingScreen = document.querySelector("#loading-screen");
const loadingUsername = document.querySelector("#loading-username");
const resultPage = document.querySelector("#result-page");
const resultSection = document.querySelector("#result-section");
const profileAvatar = document.querySelector("#profile-avatar");
const profileName = document.querySelector("#profile-name");
const profileLink = document.querySelector("#profile-link");
const profileInsight = document.querySelector("#profile-insight");
const shareButton = document.querySelector("#share-button");
const scoreCardButton = document.querySelector("#score-card-button");
const overallScore = document.querySelector("#overall-score");
const categoryScores = document.querySelector("#category-scores");
const recommendationList = document.querySelector("#recommendation-list");
const auditSummary = document.querySelector("#audit-summary");
const auditList = document.querySelector("#audit-list");
const repositorySummary = document.querySelector("#repository-summary");
const repositoryList = document.querySelector("#repository-list");
const output = document.querySelector("#output");
const exportSummary = document.querySelector("#export-summary");
const includeDetailsInput = document.querySelector("#include-details");
const pinnedOnlyInput = document.querySelector("#pinned-only");
const selectedOnlyInput = document.querySelector("#selected-only");
const publicExportOptions = document.querySelector("#public-export-options");
const privateExportOptions = document.querySelector("#private-export-options");
const privateExportNote = document.querySelector("#private-export-note");
const privateExportScopeInputs = document.querySelectorAll('[name="private-export-scope"]');
const copyButton = document.querySelector("#copy-button");
const downloadButton = document.querySelector("#download-button");
const signedOutAuth = document.querySelector("#signed-out-auth");
const signedInAuth = document.querySelector("#signed-in-auth");
const homeSignedOutAuth = document.querySelector("#home-signed-out-auth");
const homeSignedInAuth = document.querySelector("#home-signed-in-auth");
const authLogin = document.querySelector("#auth-login");
const homeAuthLogin = document.querySelector("#home-auth-login");
const privateAuditButton = document.querySelector("#private-audit-button");
const homePrivateAuditButton = document.querySelector("#home-private-audit-button");
const configureAccessLink = document.querySelector("#configure-access-link");
const logoutButton = document.querySelector("#logout-button");
const homeLogoutButton = document.querySelector("#home-logout-button");
const auditEyebrow = document.querySelector("#audit-eyebrow");
const auditTitle = document.querySelector("#audit-title");
const ratingGuide = document.querySelector("#rating-guide");
const tabButtons = document.querySelectorAll("[data-tab]");
const tabPanels = document.querySelectorAll(".tab-panel");

const appState = {
  user: null,
  repositories: [],
  audits: [],
  supplemental: null,
  mode: "public",
  authUser: null,
  privateInstallation: false,
  privateExports: { public: [], private: [], combined: [], publicSupplemental: null },
};

form.addEventListener("submit", handleFormSubmit);
shareButton.addEventListener("click", shareResult);
scoreCardButton.addEventListener("click", downloadScoreCard);
copyButton.addEventListener("click", copyMarkdown);
downloadButton.addEventListener("click", downloadMarkdown);
privateAuditButton.addEventListener("click", loadPrivateRepositories);
homePrivateAuditButton.addEventListener("click", loadPrivateRepositories);
logoutButton.addEventListener("click", logout);
homeLogoutButton.addEventListener("click", logout);
includeDetailsInput.addEventListener("change", refreshMarkdown);
pinnedOnlyInput.addEventListener("change", refreshMarkdown);
selectedOnlyInput.addEventListener("change", refreshMarkdown);
for (const scopeInput of privateExportScopeInputs) {
  scopeInput.addEventListener("change", refreshMarkdown);
}

for (const tabButton of tabButtons) {
  tabButton.addEventListener("click", handleTabClick);
}

randomizeDoodles();
initializeFromUrl();
initializeAuthSession();

/**
 * varies decorative artwork within CSS-enforced gutter zones
 * @returns {void} no return value
 */
function randomizeDoodles() {
  const doodles = document.querySelector(".page-doodles");
  if (!doodles) return;

  const randomBetween = (minimum, maximum) =>
    Math.round(minimum + Math.random() * (maximum - minimum));
  const properties = {
    "--ring-y": `${randomBetween(40, 240)}px`,
    "--ring-rotation": `${randomBetween(-24, 18)}deg`,
    "--star-y": `${randomBetween(100, 360)}px`,
    "--star-rotation": `${randomBetween(-18, 24)}deg`,
    "--dots-bottom": `${randomBetween(45, 220)}px`,
    "--dots-rotation": `${randomBetween(-12, 14)}deg`,
    "--squiggle-bottom": `${randomBetween(35, 180)}px`,
    "--squiggle-rotation": `${randomBetween(-13, 9)}deg`,
    "--underline-rotation": `${randomBetween(-4, 3)}deg`,
    "--underline-width": `${randomBetween(72, 106)}px`,
  };

  for (const [property, value] of Object.entries(properties)) {
    doodles.style.setProperty(property, value);
  }
  document.documentElement.style.setProperty("--underline-rotation", properties["--underline-rotation"]);
  document.documentElement.style.setProperty("--underline-width", properties["--underline-width"]);
}

/**
 * loads a profile when the form is submitted
 * @param {SubmitEvent} event browser form submission event
 * @returns {Promise<void>} no return value
 */
async function handleFormSubmit(event) {
  event.preventDefault();
  await loadProfile(usernameInput.value.trim());
}

/**
 * loads and renders github profile data for a username
 * @param {string} username github username
 * @returns {Promise<void>} no return value
 */
async function loadProfile(username) {
  if (!username) {
    showError("Enter a GitHub username.");
    return;
  }

  setLoading(true);
  showLoadingView(username);
  statusEl.classList.remove("error");
  statusEl.textContent = "";

  try {
    const user = await fetchJson(
      `https://api.github.com/users/${encodeURIComponent(username)}`
    );
    const [rawRepositories, supplemental] = await Promise.all([
      fetchAllRepositories(user.login),
      fetchSupplementalMetadata(user.login),
    ]);
    const repositories = transformRepositories(rawRepositories, supplemental);
    const audits = repositories.map(scoreTransformedRepository);

    appState.user = user;
    appState.repositories = repositories;
    appState.audits = audits;
    appState.supplemental = supplemental;
    appState.mode = "public";

    updateShareUrl(user.login);
    renderResults();
    showResultView();
    statusEl.textContent = createSuccessStatus(repositories.length, supplemental);
  } catch (error) {
    showHomeView();
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

function showLoadingView(username) {
  hero.hidden = true;
  resultPage.hidden = true;
  resultSection.hidden = true;
  loadingUsername.textContent = `@${username}`;
  loadingScreen.hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showResultView() {
  hero.hidden = true;
  loadingScreen.hidden = true;
  resultPage.hidden = false;
  resultPage.insertBefore(statusEl, resultSection);
  resultSection.hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showHomeView() {
  loadingScreen.hidden = true;
  resultPage.hidden = true;
  resultSection.hidden = true;
  hero.hidden = false;
  hero.appendChild(statusEl);
  window.scrollTo({ top: 0, behavior: "auto" });
}

/**
 * reads safe sign-in state without exposing GitHub credentials to the browser
 * @returns {Promise<void>} no return value
 */
async function initializeAuthSession() {
  try {
    const response = await fetch("/api/auth/session", { headers: { Accept: "application/json" } });
    const data = await response.json();
    appState.authUser = response.ok && data.authenticated ? data.user : null;
    renderAuthState();
    const url = new URL(window.location.href);
    if (url.searchParams.get("auth") === "success" && appState.authUser) {
      statusEl.textContent = `Signed in as @${appState.authUser.login}. Choose repositories to audit.`;
      url.searchParams.delete("auth");
      history.replaceState(null, "", url);
    }
  } catch {
    appState.authUser = null;
    renderAuthState();
  }
}

function renderAuthState() {
  const authenticated = Boolean(appState.authUser);
  signedOutAuth.hidden = authenticated;
  signedInAuth.hidden = !authenticated;
  homeSignedOutAuth.hidden = authenticated;
  homeSignedInAuth.hidden = !authenticated;
  authLogin.textContent = authenticated ? `@${appState.authUser.login}` : "";
  homeAuthLogin.textContent = authenticated ? `@${appState.authUser.login}` : "";
  if (!authenticated) configureAccessLink.hidden = true;
}

/**
 * loads only repositories authorized through the signed-in user's GitHub App installations
 * @returns {Promise<void>} no return value
 */
async function loadPrivateRepositories() {
  if (!appState.authUser) {
    showError("Sign in with GitHub before auditing authorized repositories.");
    return;
  }
  privateAuditButton.disabled = true;
  homePrivateAuditButton.disabled = true;
  statusEl.classList.remove("error");
  statusEl.textContent = "Fetching repositories authorized for GitProfileLens…";

  try {
    const [response, rawPublicRepositories, publicSupplemental] = await Promise.all([
      fetch("/api/private-repositories", { headers: { Accept: "application/json" } }),
      fetchAllRepositories(appState.authUser.login),
      fetchSupplementalMetadata(appState.authUser.login),
    ]);
    const data = await response.json().catch(() => null);
    if (response.status === 401) {
      appState.authUser = null;
      renderAuthState();
      throw new Error(data?.error || "Your GitHub session expired. Please sign in again.");
    }
    if (!response.ok || !data || !Array.isArray(data.repositories) || typeof data.readmes !== "object") {
      throw new Error(data?.error || "GitHub could not return authorized repositories.");
    }

    // Pins live on the public profile, so the authorized audit reuses the public pin list
    // already fetched above. Private repositories simply never appear in it.
    const supplemental = {
      pinnedRepositories: publicSupplemental?.pinnedRepositories || [],
      readmes: data.readmes,
    };
    const repositories = transformRepositories(data.repositories, supplemental);
    const publicRepositories = transformRepositories(rawPublicRepositories, publicSupplemental)
      .filter((repository) => !repository.private);
    const privateRepositories = repositories.filter((repository) => repository.private);
    appState.user = appState.authUser;
    appState.repositories = repositories;
    appState.audits = repositories.map(scoreTransformedRepository);
    appState.supplemental = supplemental;
    appState.mode = "private";
    appState.privateInstallation = Boolean(data.installation);
    appState.privateExports = {
      public: publicRepositories,
      private: privateRepositories,
      combined: combineRepositoryScopes(publicRepositories, privateRepositories),
      publicSupplemental,
    };
    configureAccessLink.hidden = !data.configure_url;
    if (data.configure_url) configureAccessLink.href = data.configure_url;

    clearPublicAuditUrl();
    renderResults();
    showResultView();
    if (!data.installation) {
      statusEl.textContent = "GitProfileLens is connected, but no GitHub App installation is available.";
    } else {
      statusEl.textContent = `Analyzed ${repositories.length} authorized ${repositories.length === 1 ? "repository" : "repositories"}. Private repositories remain separate from your public score.`;
    }
  } catch (error) {
    showError(error.message);
  } finally {
    privateAuditButton.disabled = false;
    homePrivateAuditButton.disabled = false;
  }
}

async function logout() {
  logoutButton.disabled = true;
  homeLogoutButton.disabled = true;
  try {
    await fetch("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
  } finally {
    appState.authUser = null;
    configureAccessLink.hidden = true;
    if (appState.mode === "private") {
      appState.mode = "public";
      appState.user = null;
      appState.repositories = [];
      appState.audits = [];
      appState.supplemental = null;
      clearPrivateExportState();
      showHomeView();
    }
    renderAuthState();
    logoutButton.disabled = false;
    homeLogoutButton.disabled = false;
    statusEl.classList.remove("error");
    statusEl.textContent = "Signed out of GitProfileLens.";
  }
}

function combineRepositoryScopes(publicRepositories, privateRepositories) {
  const repositories = new Map();
  for (const repository of [...publicRepositories, ...privateRepositories]) {
    repositories.set((repository.fullName || repository.name).toLowerCase(), repository);
  }
  return [...repositories.values()];
}

function clearPrivateExportState() {
  appState.privateExports = { public: [], private: [], combined: [], publicSupplemental: null };
  output.value = "";
}

function clearPublicAuditUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("user");
  url.searchParams.delete("view");
  url.searchParams.delete("auth");
  history.replaceState(null, "", url);
}

/**
 * transforms raw github repositories into normalized application data
 * @param {Array<Object>} repositories github rest repositories
 * @param {Object|null} supplemental supplemental github graphql metadata
 * @returns {Array<Object>} normalized repository data
 */
function transformRepositories(repositories, supplemental) {
  const transformed = [];

  for (const repository of repositories) {
    transformed.push(GitHubAudit.transformRepository(repository, supplemental));
  }

  return transformed;
}

/**
 * scores a normalized repository for array mapping
 * @param {Object} repository normalized repository data
 * @returns {Object} repository audit
 */
function scoreTransformedRepository(repository) {
  return GitHubAudit.scoreRepository(repository);
}

/**
 * creates the status message shown after a successful profile fetch
 * @param {number} repositoryCount number of public repositories fetched
 * @param {Object|null} supplemental supplemental github metadata
 * @returns {string} success status message
 */
function createSuccessStatus(repositoryCount, supplemental) {
  if (repositoryCount === 0) {
    return "This account has no public repositories to audit.";
  }

  if (supplemental === null) {
    return `Analyzed ${repositoryCount} repositories. README and pinned data could not be verified.`;
  }

  return `Analyzed ${repositoryCount} repositories, including ${supplemental.pinnedRepositories.length} profile pins.`;
}

/**
 * fetches all public repositories owned by a github user
 * @param {string} username github username
 * @returns {Promise<Array<Object>>} public repositories belonging to the user
 */
async function fetchAllRepositories(username) {
  const allRepositories = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url =
      `https://api.github.com/users/${encodeURIComponent(username)}/repos` +
      `?type=owner&sort=updated&direction=desc&per_page=${perPage}&page=${page}`;
    const repositories = await fetchJson(url);
    allRepositories.push(...repositories);

    if (repositories.length < perPage) break;
    page += 1;
  }

  return allRepositories;
}

/**
 * fetches pinned repositories and readme metadata from the serverless api
 * @param {string} username github username
 * @returns {Promise<Object|null>} supplemental metadata or null when unavailable
 */
async function fetchSupplementalMetadata(username) {
  try {
    const response = await fetch(
      `/api/pinned-repositories?username=${encodeURIComponent(username)}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) return null;
    const data = await response.json();

    if (!Array.isArray(data.repositories) || typeof data.readmes !== "object") {
      return null;
    }

    return { pinnedRepositories: data.repositories, readmes: data.readmes };
  } catch {
    return null;
  }
}

/**
 * fetches json data and translates github api failures into useful messages
 * @param {string} url url to request
 * @returns {Promise<Object|Array>} parsed json response
 */
async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 404) {
    throw new Error("GitHub user not found. Check the username and try again.");
  }

  if (response.status === 403 || response.status === 429) {
    const resetTime = formatRateLimitReset(response.headers.get("X-RateLimit-Reset"));
    throw new Error(`GitHub's public API rate limit was reached.${resetTime}`);
  }

  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}). Try again shortly.`);
  }

  return response.json();
}

/**
 * formats a github rate-limit reset header for an error message
 * @param {string|null} resetHeader unix reset timestamp header
 * @returns {string} formatted reset-time sentence or empty string
 */
function formatRateLimitReset(resetHeader) {
  if (!resetHeader) return " Try again later.";
  const resetDate = new Date(Number(resetHeader) * 1000);
  if (Number.isNaN(resetDate.getTime())) return " Try again later.";
  return ` Try again after ${resetDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
}

/**
 * renders every result view from current application state
 * @returns {void} no return value
 */
function renderResults() {
  if (appState.mode === "private") {
    renderPrivateResults();
    return;
  }
  setResultMode("public");
  renderProfileHeader();
  renderOverview();
  renderAudits();
  renderRepositories();
  refreshMarkdown();
}

function renderPrivateResults() {
  setResultMode("private");
  profileAvatar.crossOrigin = "anonymous";
  profileAvatar.src = appState.authUser.avatar_url;
  profileAvatar.alt = `${appState.authUser.login}'s GitHub avatar`;
  profileName.textContent = "Private Repository Audit";
  profileLink.href = `https://github.com/${encodeURIComponent(appState.authUser.login)}`;
  profileLink.textContent = `@${appState.authUser.login}`;
  profileInsight.textContent = "Review authorized repositories and identify projects worth preparing for your public portfolio.";
  renderAudits();
  refreshMarkdown();
  activateTab("audit", false);
}

function setResultMode(mode) {
  const privateMode = mode === "private";
  shareButton.hidden = privateMode;
  scoreCardButton.hidden = privateMode;
  for (const button of tabButtons) {
    button.hidden = privateMode && !["audit", "markdown"].includes(button.dataset.tab);
  }
  publicExportOptions.hidden = privateMode;
  privateExportOptions.hidden = !privateMode;
  privateExportNote.hidden = !privateMode;
  auditEyebrow.textContent = privateMode ? "Authorized repositories only" : "Lowest scores first";
  auditTitle.textContent = privateMode ? "Private Repository Audit" : "Repository audit";
  ratingGuide.textContent = privateMode
    ? "90–100 strong portfolio candidate · 70–89 worth polishing · below 70 needs presentation work"
    : "90–100 strong · 70–89 minor improvements · below 70 needs attention";
}

/**
 * renders profile identity information
 * @returns {void} no return value
 */
function renderProfileHeader() {
  const user = appState.user;
  const profileScore = GitHubAudit.scoreProfile(appState.audits);
  const firstName = (user.name || user.login).trim().split(/\s+/)[0];
  const strongestCategory = getStrongestCategory(profileScore.categories);
  profileAvatar.crossOrigin = "anonymous";
  profileAvatar.src = user.avatar_url;
  profileAvatar.alt = `${user.login}'s GitHub avatar`;
  profileName.textContent = user.name || `@${user.login}`;
  profileLink.href = user.html_url;
  profileLink.textContent = `@${user.login}`;
  profileInsight.textContent = `${firstName}'s portfolio snapshot: ${appState.repositories.length} public ${appState.repositories.length === 1 ? "project" : "projects"} · strongest signal: ${strongestCategory}.`;
}

/**
 * finds the strongest scored profile category for the personalized summary
 * @param {Object} categories profile category scores
 * @returns {string} readable category name
 */
function getStrongestCategory(categories) {
  const labels = {
    presentation: "repository presentation",
    descriptions: "descriptions",
    readme: "README quality",
    discoverability: "discoverability",
    maintenance: "maintenance",
    focus: "portfolio focus",
  };
  const entries = Object.entries(categories);
  if (entries.length === 0) return "a fresh start";
  const strongest = entries.reduce((best, entry) => entry[1] > best[1] ? entry : best);
  return labels[strongest[0]];
}

/**
 * renders the overall score, category scores, and portfolio recommendations
 * @returns {void} no return value
 */
function renderOverview() {
  if (appState.mode !== "public") return;
  const profileScore = GitHubAudit.scoreProfile(appState.audits);
  const recommendations = GitHubAudit.generateRecommendations(appState.audits);
  overallScore.textContent = profileScore.overall;
  categoryScores.replaceChildren();

  const labels = [
    ["presentation", "Repository presentation", profileScore.categories.presentation],
    ["descriptions", "Descriptions", profileScore.categories.descriptions],
    ["readme", "README quality", profileScore.categories.readme],
    ["discoverability", "Discoverability", profileScore.categories.discoverability],
    ["maintenance", "Maintenance", profileScore.categories.maintenance],
    ["focus", "Portfolio focus", profileScore.categories.focus],
  ];

  for (const [key, label, score] of labels) {
    categoryScores.appendChild(createCategoryScore(key, label, score));
  }

  recommendationList.replaceChildren();
  if (recommendations.length === 0) {
    recommendationList.appendChild(createEmptyState("No high-impact issues were detected in the public repository data."));
  } else {
    for (const recommendation of recommendations) {
      recommendationList.appendChild(createRecommendationCard(recommendation));
    }
  }
}

/**
 * creates a category score display with a progress bar
 * @param {string} key score category key
 * @param {string} label score category label
 * @param {number} score category score
 * @returns {HTMLElement} category score element
 */
function createCategoryScore(key, label, score) {
  const item = document.createElement("div");
  const trigger = document.createElement("button");
  const heading = document.createElement("div");
  const name = document.createElement("span");
  const value = document.createElement("strong");
  const track = document.createElement("div");
  const bar = document.createElement("span");
  const explanation = createCategoryExplanation(key, score);
  const explanationId = `score-explanation-${key}`;
  item.className = "category-score";
  trigger.className = "category-score-trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", explanationId);
  trigger.setAttribute("aria-label", `Explain the ${label.toLowerCase()} score: ${score} out of 100`);
  trigger.title = `Explain the ${label.toLowerCase()} score`;
  heading.className = "category-score-heading";
  name.textContent = label;
  value.textContent = score;
  heading.append(name, value);
  track.className = "score-track";
  bar.style.width = `${score}%`;
  track.appendChild(bar);
  trigger.append(heading, track);
  explanation.id = explanationId;
  explanation.hidden = true;
  trigger.addEventListener("click", () => {
    const willOpen = explanation.hidden;
    for (const openExplanation of categoryScores.querySelectorAll(".category-explanation:not([hidden])")) {
      openExplanation.hidden = true;
      openExplanation.closest(".category-score").classList.remove("is-open");
      openExplanation.previousElementSibling.setAttribute("aria-expanded", "false");
    }
    explanation.hidden = !willOpen;
    item.classList.toggle("is-open", willOpen);
    trigger.setAttribute("aria-expanded", String(willOpen));
  });
  item.append(trigger, explanation);
  return item;
}

/**
 * explains the data and formula behind a profile category score
 * @param {string} key score category key
 * @param {number} score category score
 * @returns {HTMLElement} category explanation
 */
function createCategoryExplanation(key, score) {
  const explanation = document.createElement("div");
  const summary = document.createElement("p");
  const list = document.createElement("ul");
  explanation.className = "category-explanation";

  if (key === "focus") {
    const repositories = appState.repositories;
    const active = repositories.filter((repository) => !repository.archived && !repository.fork);
    const languageCounts = new Map();
    for (const repository of active) {
      if (repository.language) languageCounts.set(repository.language, (languageCounts.get(repository.language) || 0) + 1);
    }
    const leadingLanguage = [...languageCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const curatedCount = repositories.length - active.length;
    summary.textContent = `${score}/100 uses a 55-point baseline, up to 30 points for a coherent language focus, and up to 15 points for archiving or forking work outside the active portfolio.`;
    appendExplanationItem(list, `${active.length} of ${repositories.length} repositories are active, original projects.`);
    appendExplanationItem(list, leadingLanguage ? `${leadingLanguage[0]} is the leading language across ${leadingLanguage[1]} active ${leadingLanguage[1] === 1 ? "repository" : "repositories"}.` : "No leading repository language could be determined.");
    appendExplanationItem(list, `${curatedCount} archived or forked ${curatedCount === 1 ? "repository contributes" : "repositories contribute"} to the curation bonus.`);
  } else {
    const categoryNames = {
      presentation: "Repository presentation",
      descriptions: "Descriptions",
      readme: "README quality",
      discoverability: "Discoverability",
      maintenance: "Project maintenance",
    };
    const repositoryScores = appState.audits.map((audit) => audit.categoryScores[key]);
    const relevantFindings = appState.audits.flatMap((audit) =>
      audit.findings.filter((finding) => finding.category === categoryNames[key])
    );
    const findingCounts = new Map();
    for (const finding of relevantFindings) {
      findingCounts.set(finding.reason, (findingCounts.get(finding.reason) || 0) + 1);
    }
    summary.textContent = `${score}/100 is the rounded average of ${repositoryScores.length} repository ${key === "readme" ? "README" : key} scores${repositoryScores.length ? `, ranging from ${Math.min(...repositoryScores)} to ${Math.max(...repositoryScores)}` : ""}.`;
    if (findingCounts.size === 0) {
      appendExplanationItem(list, "Every analyzed repository passed the checks in this category.");
    } else {
      for (const [reason, count] of [...findingCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        appendExplanationItem(list, `${count} ${count === 1 ? "repository" : "repositories"}: ${reason}`);
      }
    }
  }

  explanation.append(summary, list);
  return explanation;
}

/**
 * appends one score explanation point
 * @param {HTMLUListElement} list explanation list
 * @param {string} text explanation text
 * @returns {void} no return value
 */
function appendExplanationItem(list, text) {
  const item = document.createElement("li");
  item.textContent = text;
  list.appendChild(item);
}

/**
 * creates a portfolio recommendation card
 * @param {Object} recommendation structured portfolio recommendation
 * @returns {HTMLElement} recommendation card
 */
function createRecommendationCard(recommendation) {
  const card = document.createElement("article");
  const top = document.createElement("div");
  const severity = document.createElement("span");
  const category = document.createElement("strong");
  const reason = document.createElement("p");
  const action = document.createElement("p");
  const repositories = document.createElement("p");
  card.className = "recommendation-card";
  top.className = "recommendation-top";
  severity.className = `severity severity-${recommendation.severity}`;
  severity.textContent = recommendation.severity;
  category.textContent = recommendation.category;
  top.append(severity, category);
  reason.textContent = recommendation.reason;
  action.className = "recommendation-action";
  action.textContent = recommendation.action;
  repositories.className = "affected-repositories";
  repositories.textContent = `Affects: ${formatRepositoryNames(recommendation.repositories)}`;
  card.append(top, reason, action, repositories);
  return card;
}

/**
 * formats a concise list of repository names
 * @param {Array<string>} names repository names
 * @returns {string} comma-separated repository summary
 */
function formatRepositoryNames(names) {
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;
}

/**
 * renders every repository audit with the lowest score first
 * @returns {void} no return value
 */
function renderAudits() {
  const sortedAudits = [...appState.audits].sort(compareRepositoryAudits);
  const needingAttention = sortedAudits.filter(hasAuditIssues).length;
  auditSummary.textContent = `${needingAttention} of ${sortedAudits.length} repositories have suggestions.`;
  auditList.replaceChildren();

  if (sortedAudits.length === 0) {
    const message = appState.mode === "private"
      ? appState.privateInstallation
        ? "No repositories owned by this account are currently authorized for GitProfileLens. Configure the GitHub App to select repositories."
        : "Install or configure the GitHub App to choose repositories for this private audit."
      : "No public repositories are available to audit.";
    auditList.appendChild(createEmptyState(message));
    return;
  }

  for (const audit of sortedAudits) {
    auditList.appendChild(createAuditCard(audit));
  }
}

/**
 * compares repository audits by score and update date
 * @param {Object} auditA first repository audit
 * @param {Object} auditB second repository audit
 * @returns {number} audit sort order
 */
function compareRepositoryAudits(auditA, auditB) {
  const difference = auditA.score - auditB.score;
  if (difference !== 0) return difference;
  return new Date(auditB.repository.updatedAt) - new Date(auditA.repository.updatedAt);
}

/**
 * determines whether a repository audit contains actionable findings
 * @param {Object} audit repository audit
 * @returns {boolean} true when a non-informational finding exists
 */
function hasAuditIssues(audit) {
  return audit.findings.some(isActionableFinding);
}

/**
 * determines whether a finding is actionable
 * @param {Object} finding structured audit finding
 * @returns {boolean} true for non-informational findings
 */
function isActionableFinding(finding) {
  return finding.severity !== "info";
}

/**
 * creates a repository-level audit card
 * @param {Object} audit repository audit
 * @returns {HTMLElement} repository audit card
 */
function createAuditCard(audit) {
  const repository = audit.repository;
  const card = document.createElement("article");
  const header = document.createElement("div");
  const titleArea = document.createElement("div");
  const title = document.createElement("h3");
  const link = document.createElement("a");
  const metadata = document.createElement("p");
  const score = document.createElement("strong");
  const description = document.createElement("p");
  const facts = document.createElement("div");
  const readmeChecklist = createReadmeChecklist(repository.readme, audit.categoryScores.readme);
  const findings = document.createElement("div");
  const candidate = document.createElement("p");
  card.className = "audit-card";
  header.className = "audit-card-header";
  link.href = repository.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = repository.name;
  if (appState.mode === "private") {
    const privacy = document.createElement("span");
    privacy.className = "privacy-badge";
    privacy.textContent = repository.private ? "Private" : "Public";
    title.append(privacy, link);
  } else {
    title.appendChild(link);
  }
  metadata.className = "repo-meta-line";
  metadata.textContent = `${repository.language || "Language unknown"} · ★ ${repository.stars} · Forks ${repository.forks} · Updated ${formatShortDate(repository.updatedAt)}`;
  titleArea.append(title, metadata);
  score.className = `repo-score ${getScoreClass(audit.score)}`;
  score.textContent = `${audit.score}/100`;
  header.append(titleArea, score);
  description.className = "current-description";
  description.textContent = repository.description || "No description";
  facts.className = "fact-row";
  const factBadges = [
    createFactBadge(`Topics: ${repository.topics.length || "none"}`),
    createFactBadge(`License: ${repository.license || "none"}`),
    createFactBadge(`README: ${formatReadmeStatus(repository.readme)}`),
  ];
  if (appState.mode === "public") {
    factBadges.push(createFactBadge(repository.pinned === null ? "Pin: unknown" : repository.pinned ? "Pinned" : "Not pinned"));
  }
  facts.append(...factBadges);
  findings.className = "finding-list";

  if (audit.findings.length === 0) {
    findings.appendChild(createEmptyState("Strong presentation: no issues detected by the current checks."));
  } else {
    for (const finding of audit.findings) {
      findings.appendChild(createFindingRow(finding));
    }
  }

  card.append(header, description, facts);
  if (appState.mode === "private") {
    candidate.className = "candidate-label";
    candidate.textContent = audit.score >= 90
      ? "Strong portfolio candidate"
      : audit.score >= 70
        ? "Worth polishing before publishing"
        : "Needs presentation work before publishing";
    card.appendChild(candidate);
  }
  if (readmeChecklist) card.appendChild(readmeChecklist);
  card.appendChild(findings);
  return card;
}

/**
 * creates a compact metadata badge
 * @param {string} text badge text
 * @returns {HTMLElement} metadata badge
 */
function createFactBadge(text) {
  const badge = document.createElement("span");
  badge.textContent = text;
  return badge;
}

/**
 * creates a compact checklist of verified README content signals
 * @param {Object} readme README metadata
 * @param {number} readmeScore README category score
 * @returns {HTMLElement|null} checklist or null when structural data is unavailable
 */
function createReadmeChecklist(readme, readmeScore) {
  if (!readme?.present || !readme.sections) return null;

  const section = document.createElement("section");
  const header = document.createElement("div");
  const title = document.createElement("h4");
  const score = document.createElement("span");
  const list = document.createElement("ul");
  const checks = [
    ["Overview", readme.sections.overview],
    ["Setup", readme.sections.installation],
    ["Usage", readme.sections.usage],
    ["Example or demo", readme.sections.examples],
    ["Contribution guide", readme.sections.contributing],
    ["Code sample", readme.hasCodeBlock],
    ["Visual", readme.hasImage],
  ];

  section.className = "readme-checklist";
  section.setAttribute("aria-label", "README analysis");
  title.textContent = "README checklist";
  score.textContent = `${readmeScore}/100`;
  header.append(title, score);

  for (const [label, detected] of checks) {
    const item = document.createElement("li");
    item.className = detected ? "is-detected" : "is-missing";
    item.textContent = `${detected ? "✓" : "–"} ${label}`;
    list.appendChild(item);
  }

  section.append(header, list);
  return section;
}

/**
 * formats readme metadata for display
 * @param {Object} readme readme metadata
 * @returns {string} readable readme status
 */
function formatReadmeStatus(readme) {
  return GitHubAudit.formatReadmeStatus(readme).replaceAll("_", " ");
}

/**
 * creates a factual or advisory audit finding row
 * @param {Object} finding structured audit finding
 * @returns {HTMLElement} finding row
 */
function createFindingRow(finding) {
  const row = document.createElement("article");
  const heading = document.createElement("div");
  const type = document.createElement("span");
  const category = document.createElement("strong");
  const reason = document.createElement("p");
  const action = document.createElement("p");
  row.className = "finding";
  type.className = `finding-type ${finding.factual ? "is-factual" : "is-advisory"}`;
  type.textContent = finding.factual ? "Factual check" : "Recommendation";
  category.textContent = finding.category;
  heading.append(type, category);
  reason.textContent = finding.reason;
  action.className = "finding-action";
  action.textContent = `Next step: ${finding.action}`;
  row.append(heading, reason, action);
  return row;
}

/**
 * returns a visual score class for a numeric score
 * @param {number} score repository score
 * @returns {string} css class representing the score band
 */
function getScoreClass(score) {
  if (score >= 90) return "score-strong";
  if (score >= 70) return "score-medium";
  return "score-weak";
}

/**
 * renders fetched repository data and selection controls
 * @returns {void} no return value
 */
function renderRepositories() {
  if (appState.mode !== "public") return;
  const repositories = [...appState.repositories].sort(compareRepositoriesForExplorer);
  repositorySummary.textContent = `${repositories.length} public repositories fetched.`;
  repositoryList.replaceChildren();

  if (repositories.length === 0) {
    repositoryList.appendChild(createEmptyState("This account has no public repositories."));
    return;
  }

  for (const repository of repositories) {
    repositoryList.appendChild(createRepositoryCard(repository));
  }
}

/**
 * creates a repository data card with an export selection control
 * @param {Object} repository normalized repository data
 * @returns {HTMLElement} repository data card
 */
function createRepositoryCard(repository) {
  const card = document.createElement("article");
  const checkbox = document.createElement("input");
  const content = document.createElement("div");
  const heading = document.createElement("div");
  const title = document.createElement("a");
  const flags = document.createElement("span");
  const description = document.createElement("p");
  const metadata = document.createElement("p");
  card.className = "repository-card";
  checkbox.type = "checkbox";
  checkbox.checked = repository.selected;
  checkbox.dataset.repository = repository.name;
  checkbox.setAttribute("aria-label", `Include ${repository.name} in selected exports`);
  checkbox.addEventListener("change", handleRepositorySelection);
  content.className = "repository-card-content";
  heading.className = "repository-card-heading";
  title.href = repository.url;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = repository.name;
  flags.className = "repository-flags";
  flags.textContent = [repository.pinned ? "Pinned" : "", repository.archived ? "Archived" : "", repository.fork ? "Fork" : ""].filter(Boolean).join(" · ");
  heading.append(title, flags);
  description.textContent = repository.description || "No description";
  metadata.className = "repo-meta-line";
  metadata.textContent = `${repository.language || "Unknown language"} · ${repository.topics.length} topics · ${repository.license || "No license"} · README ${formatReadmeStatus(repository.readme)} · Updated ${formatShortDate(repository.updatedAt)}`;
  content.append(heading, description, metadata);
  card.append(checkbox, content);
  return card;
}

/**
 * updates repository selection state and the markdown preview
 * @param {Event} event repository checkbox change event
 * @returns {void} no return value
 */
function handleRepositorySelection(event) {
  if (appState.mode !== "public") return;
  const repository = appState.repositories.find(
    (item) => item.name === event.currentTarget.dataset.repository
  );
  if (repository) repository.selected = event.currentTarget.checked;
  refreshMarkdown();
}

/**
 * compares repository creation dates with the newest repository first
 * @param {Object} repositoryA first repository
 * @param {Object} repositoryB second repository
 * @returns {number} repository sort order
 */
function compareCreationDatesNewestFirst(repositoryA, repositoryB) {
  return new Date(repositoryB.createdAt) - new Date(repositoryA.createdAt);
}

/**
 * keeps profile pins first and in the order chosen on GitHub
 * @param {Object} repositoryA first repository
 * @param {Object} repositoryB second repository
 * @returns {number} repository sort order
 */
function comparePinnedPositions(repositoryA, repositoryB) {
  const positionA = repositoryA.pinnedPosition ?? Number.MAX_SAFE_INTEGER;
  const positionB = repositoryB.pinnedPosition ?? Number.MAX_SAFE_INTEGER;
  return positionA - positionB;
}

function compareRepositoriesForExplorer(repositoryA, repositoryB) {
  if (repositoryA.pinned === true || repositoryB.pinned === true) {
    const pinnedOrder = comparePinnedPositions(repositoryA, repositoryB);
    if (pinnedOrder !== 0) return pinnedOrder;
  }
  return compareCreationDatesNewestFirst(repositoryA, repositoryB);
}

/**
 * updates markdown output from current export options
 * @returns {void} no return value
 */
function refreshMarkdown() {
  if (!appState.user) return;
  if (appState.mode === "private") {
    refreshPrivateMarkdown();
    return;
  }
  const options = {
    includeDetails: includeDetailsInput.checked,
    pinnedOnly: pinnedOnlyInput.checked,
    selectedOnly: selectedOnlyInput.checked,
  };
  const repositories = filterRepositoriesForExport(appState.repositories, options);
  output.value = createMarkdown(appState.user.login, repositories, appState.supplemental, options);
  exportSummary.textContent = `${repositories.length} repositories included in this export.`;
  pinnedOnlyInput.disabled = appState.supplemental === null;
}

function refreshPrivateMarkdown() {
  const scope = [...privateExportScopeInputs].find((input) => input.checked)?.value || "private";
  const repositories = appState.privateExports[scope] || [];
  const labels = {
    public: "public",
    private: "authorized private",
    combined: "combined public and authorized private",
  };
  output.value = createMarkdown(
    appState.authUser.login,
    repositories,
    scope === "private" ? null : appState.privateExports.publicSupplemental,
    {
      includeDetails: true,
      includePinned: scope !== "private",
      includeVisibility: true,
      scope: labels[scope],
    }
  );
  exportSummary.textContent = `${repositories.length} ${labels[scope]} ${repositories.length === 1 ? "repository" : "repositories"} included in this export.`;
}

/**
 * filters repositories according to export options
 * @param {Array<Object>} repositories normalized repositories
 * @param {Object} options markdown export options
 * @returns {Array<Object>} filtered repositories
 */
function filterRepositoriesForExport(repositories, options) {
  const includedRepositories = [];

  for (const repository of repositories) {
    if (options.pinnedOnly && repository.pinned !== true) continue;
    if (options.selectedOnly && !repository.selected) continue;
    includedRepositories.push(repository);
  }

  return includedRepositories;
}

/**
 * creates a markdown summary from normalized repositories
 * @param {string} username github username
 * @param {Array<Object>} repositories normalized repositories
 * @param {Object|null} supplemental supplemental github metadata
 * @param {Object} options markdown export options
 * @returns {string} formatted markdown report
 */
function createMarkdown(username, repositories, supplemental, options) {
  const sortedRepositories = [...repositories].sort(
    options.pinnedOnly ? comparePinnedPositions : compareCreationDatesNewestFirst
  );
  const includePinned = options.includePinned !== false;
  const lines = [
    `username: ${escapeMarkdown(username)}`,
    `${options.scope || "public"} repositories in report: ${sortedRepositories.length}`,
    "",
  ];
  if (includePinned) {
    lines.push("# pinned repositories:", "");
    const pinnedRepositories = sortedRepositories
      .filter(isPinnedRepository)
      .sort(comparePinnedPositions);

    if (supplemental === null) {
      lines.push("Pinned repository data unavailable.", "");
    } else if (pinnedRepositories.length === 0) {
      lines.push("No pinned repositories included in this report.", "");
    } else {
      for (const repository of pinnedRepositories) {
        lines.push(`- ${escapeMarkdown(repository.name)}`);
      }
      lines.push("");
    }
  }

  lines.push("# repositories:", "");

  for (let index = 0; index < sortedRepositories.length; index += 1) {
    const repository = sortedRepositories[index];
    const repositoryLines = [
      `### repo ${sortedRepositories.length - index}:`,
      "",
      `- name: ${escapeMarkdown(repository.name)}`,
      `- desc: ${escapeMarkdown(repository.description || "No description")}`,
      `- url: ${repository.url}`,
    ];
    if (options.includeVisibility) {
      repositoryLines.push(`- visibility: ${repository.private ? "Private" : "Public"}`);
    }
    if (includePinned) {
      repositoryLines.push(`- pinned on profile: ${repository.pinned === null ? "Unavailable" : repository.pinned ? "Yes" : "No"}`);
    }
    lines.push(...repositoryLines);

    if (options.includeDetails) {
      lines.push(
        `- created: ${formatEasternTimestamp(repository.createdAt)}`,
        `- last updated: ${formatEasternTimestamp(repository.updatedAt)}`,
        `- last pushed: ${repository.pushedAt ? formatEasternTimestamp(repository.pushedAt) : "Never"}`,
        `- primary language: ${escapeMarkdown(repository.language || "Not specified")}`,
        `- license: ${escapeMarkdown(repository.license || "Not specified")}`,
        `- topics: ${escapeMarkdown(repository.topics.join(", ") || "None")}`,
        `- stars: ${repository.stars}`,
        `- forks: ${repository.forks}`,
        `- open issues and pull requests: ${repository.openIssues}`,
        `- README: ${formatReadmeStatus(repository.readme)}`,
        `- archived: ${repository.archived ? "Yes" : "No"}`,
        `- forked repository: ${repository.fork ? "Yes" : "No"}`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * determines whether a repository is pinned
 * @param {Object} repository normalized repository
 * @returns {boolean} true when pinned
 */
function isPinnedRepository(repository) {
  return repository.pinned === true;
}

/**
 * handles switching between result tabs
 * @param {MouseEvent} event tab button click event
 * @returns {void} no return value
 */
function handleTabClick(event) {
  activateTab(event.currentTarget.dataset.tab, true);
}

/**
 * activates one result tab and optionally updates the url
 * @param {string} tabName tab identifier
 * @param {boolean} updateUrl whether to write the tab into the url
 * @returns {void} no return value
 */
function activateTab(tabName, updateUrl) {
  if (appState.mode === "private" && !["audit", "markdown"].includes(tabName)) tabName = "audit";
  const validTab = ["overview", "audit", "repositories", "markdown"].includes(tabName)
    ? tabName
    : "overview";

  for (const button of tabButtons) {
    const active = button.dataset.tab === validTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }

  for (const panel of tabPanels) {
    panel.hidden = panel.id !== `${validTab}-panel`;
  }

  if (updateUrl && appState.user && appState.mode === "public") {
    updateShareUrl(appState.user.login, validTab);
  }
}

/**
 * updates the current url with the audited username and active view
 * @param {string} username github username
 * @param {string|null} tabName optional result tab identifier
 * @returns {void} no return value
 */
function updateShareUrl(username, tabName = null) {
  if (appState.mode !== "public") return;
  const url = new URL(window.location.href);
  url.searchParams.set("user", username);
  const activeTab = tabName || url.searchParams.get("view");

  if (activeTab && activeTab !== "overview") {
    url.searchParams.set("view", activeTab);
  } else {
    url.searchParams.delete("view");
  }

  history.replaceState(null, "", url);
}

/**
 * initializes username and result view from url parameters
 * @returns {void} no return value
 */
function initializeFromUrl() {
  const username = GitHubAudit.parseUsernameFromSearch(window.location.search);
  const tabName = new URLSearchParams(window.location.search).get("view") || "overview";
  activateTab(tabName, false);

  if (username) {
    usernameInput.value = username;
    loadProfile(username);
  }
}

/**
 * shares the current dynamic score and audit URL, with clipboard fallback
 * @returns {Promise<void>} no return value
 */
async function shareResult() {
  if (!appState.user || appState.mode !== "public") return;
  const profileScore = GitHubAudit.scoreProfile(appState.audits);
  const shareText = GitProfileShare.buildShareText(appState.user.login, profileScore.overall);

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "My GitProfileLens score", text: shareText });
      showTemporaryButtonText(shareButton, "Shared!");
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(shareText);
    showTemporaryButtonText(shareButton, "Copied!");
  } catch {
    showError("Could not share automatically. Copy the audit URL from the address bar.");
  }
}

/**
 * downloads a social-friendly PNG score card generated entirely in the browser
 * @returns {Promise<void>} resolves after the card image has been prepared
 */
async function downloadScoreCard() {
  if (!appState.user || appState.mode !== "public") return;
  const profileScore = GitHubAudit.scoreProfile(appState.audits);
  const cardData = GitProfileShare.buildScoreCardData(appState.user.login, profileScore);
  scoreCardButton.disabled = true;

  let avatar = null;
  try {
    avatar = await loadImage(appState.user.avatar_url);
  } catch {
    // A blocked avatar request falls back to the account's initial.
  }

  const canvas = renderScoreCard(cardData, avatar);
  canvas.toBlob((blob) => {
    scoreCardButton.disabled = false;
    if (!blob) {
      showError("Could not create the score card in this browser.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${appState.user.login}-gitprofilelens-score.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showTemporaryButtonText(scoreCardButton, "Downloaded!");
  }, "image/png");
}

/**
 * loads an image with anonymous CORS access so it can be safely drawn to canvas
 * @param {string} source image url
 * @returns {Promise<HTMLImageElement>} loaded image
 */
function loadImage(source) {
  return new Promise((resolve, reject) => {
    if (!source) {
      reject(new Error("No image source"));
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

/**
 * renders score-card data to a fixed-size canvas without external assets
 * @param {Object} data dynamic score-card content
 * @param {HTMLImageElement|null} avatar loaded GitHub avatar, when available
 * @returns {HTMLCanvasElement} rendered score card
 */
function renderScoreCard(data, avatar) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");

  context.fillStyle = "#0b0f14";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const glow = context.createRadialGradient(940, 100, 20, 940, 100, 430);
  glow.addColorStop(0, "rgba(88, 166, 255, .22)");
  glow.addColorStop(1, "rgba(11, 15, 20, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  drawScoreCardAvatar(context, avatar, data.username, 91, 104, 49);
  context.strokeStyle = "#d2a8ff";
  context.lineWidth = 6;
  context.beginPath();
  context.arc(91, 104, 52, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = "rgba(210, 168, 255, .45)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(91, 104, 57, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = "#58a6ff";
  context.font = "800 28px system-ui, sans-serif";
  context.fillText("GitProfileLens", 165, 96);
  context.fillStyle = "#9da7b3";
  context.font = "600 25px system-ui, sans-serif";
  context.fillText(data.username, 165, 133);

  context.fillStyle = "#e6edf3";
  context.font = "800 40px system-ui, sans-serif";
  context.fillText("GitHub Portfolio Score", 90, 245);
  context.font = "900 146px system-ui, sans-serif";
  context.fillText(String(data.score), 82, 405);
  const scoreWidth = context.measureText(String(data.score)).width;
  context.fillStyle = "#79c0ff";
  context.font = "800 42px system-ui, sans-serif";
  context.fillText("/ 100", 94 + scoreWidth, 399);

  context.fillStyle = "#161b22";
  drawRoundedRectangle(context, 650, 190, 455, 100, 16);
  drawRoundedRectangle(context, 650, 315, 455, 100, 16);
  context.fillStyle = "#8b949e";
  context.font = "700 20px system-ui, sans-serif";
  context.fillText("STRONGEST SIGNAL", 680, 225);
  context.fillText("NEXT FOCUS", 680, 350);
  context.fillStyle = "#e6edf3";
  context.font = "750 27px system-ui, sans-serif";
  context.fillText(data.strongest, 680, 264);
  context.fillText(data.improvement, 680, 389);

  context.fillStyle = "#8b949e";
  context.font = "600 23px system-ui, sans-serif";
  context.fillText("Presentation and discoverability, not developer ability.", 90, 515);
  context.fillStyle = "#58a6ff";
  context.font = "750 24px system-ui, sans-serif";
  context.fillText(data.productUrl, 90, 566);
  return canvas;
}

function drawScoreCardAvatar(context, avatar, username, centerX, centerY, radius) {
  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.clip();

  context.fillStyle = "#21262d";
  context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

  if (avatar && avatar.naturalWidth && avatar.naturalHeight) {
    const sourceSize = Math.min(avatar.naturalWidth, avatar.naturalHeight);
    const sourceX = (avatar.naturalWidth - sourceSize) / 2;
    const sourceY = (avatar.naturalHeight - sourceSize) / 2;
    context.drawImage(
      avatar,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2
    );
  } else {
    context.fillStyle = "#e6edf3";
    context.font = "800 42px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText((username[0] || "?").toUpperCase(), centerX, centerY + 2);
  }

  context.restore();
}

function drawRoundedRectangle(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

/**
 * copies the generated markdown preview
 * @returns {Promise<void>} no return value
 */
async function copyMarkdown() {
  if (!output.value) return;
  try {
    await navigator.clipboard.writeText(output.value);
    showTemporaryButtonText(copyButton, "Copied");
  } catch {
    showError("Could not copy automatically. Select the Markdown and copy it manually.");
  }
}

/**
 * downloads the generated markdown as a file
 * @returns {void} no return value
 */
function downloadMarkdown() {
  if (!output.value) return;
  const blob = new Blob([output.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const scope = appState.mode === "private"
    ? [...privateExportScopeInputs].find((input) => input.checked)?.value || "private"
    : "public";
  link.download = appState.mode === "private"
    ? `${appState.user?.login || "github-user"}-${scope}-repositories.md`
    : `${appState.user?.login || "github-user"}-repositories.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * temporarily changes button text to acknowledge an action
 * @param {HTMLButtonElement} button button to update
 * @param {string} temporaryText temporary button label
 * @returns {void} no return value
 */
function showTemporaryButtonText(button, temporaryText) {
  const originalText = button.textContent;
  button.textContent = temporaryText;
  window.setTimeout(function restoreButtonText() {
    button.textContent = originalText;
  }, 1200);
}

/**
 * creates a reusable empty-state message
 * @param {string} message empty-state message
 * @returns {HTMLElement} empty-state element
 */
function createEmptyState(message) {
  const emptyState = document.createElement("p");
  emptyState.className = "empty-state";
  emptyState.textContent = message;
  return emptyState;
}

/**
 * formats a timestamp as a concise local date
 * @param {string} timestamp iso timestamp
 * @returns {string} concise date
 */
function formatShortDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

/**
 * formats a github timestamp in united states eastern time
 * @param {string} timestamp iso timestamp returned by github
 * @returns {string} date and time formatted in est or edt
 */
function formatEasternTimestamp(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

/**
 * escapes markdown special characters in a value
 * @param {*} value value to escape
 * @returns {string} markdown safe string
 */
function escapeMarkdown(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, " ")
    .replace(/([*_`[\]<>])/g, "\\$1");
}

/**
 * updates the form loading state
 * @param {boolean} isLoading whether the application is loading
 * @returns {void} no return value
 */
function setLoading(isLoading) {
  generateButton.disabled = isLoading;
  usernameInput.disabled = isLoading;
  generateButton.textContent = isLoading ? "Analyzing…" : "Analyze profile";
}

/**
 * displays an error message to the user
 * @param {string} message error message to display
 * @returns {void} no return value
 */
function showError(message) {
  statusEl.classList.add("error");
  statusEl.textContent = message;
}
