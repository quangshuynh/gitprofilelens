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
const contributionsSection = document.querySelector("#contributions-section");
const contributionSummary = document.querySelector("#contribution-summary");
const contributionList = document.querySelector("#contribution-list");
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
const networkStatus = document.querySelector("#network-status");
const networkSummary = document.querySelector("#network-summary");
const networkRetryButton = document.querySelector("#network-retry-button");
const networkResults = document.querySelector("#network-results");
const networkFollowerCount = document.querySelector("#network-follower-count");
const networkFollowingCount = document.querySelector("#network-following-count");
const networkUnreciprocatedCount = document.querySelector("#network-unreciprocated-count");
const networkUnreciprocatedSection = document.querySelector("#network-unreciprocated-section");
const networkDisclosureControls = document.querySelector("#network-disclosure-controls");
const networkExpandAllButton = document.querySelector("#network-expand-all");
const networkCollapseAllButton = document.querySelector("#network-collapse-all");
const networkNotice = document.querySelector("#network-notice");
const networkOrderingNote = document.querySelector("#network-ordering-note");
const networkHistoryNote = document.querySelector("#network-history-note");
const networkHistoryControls = document.querySelector("#network-history-controls");
const networkHistoryResetButton = document.querySelector("#network-history-reset");
const networkHistoryConfirmGroup = document.querySelector("#network-history-confirm-group");
const networkHistoryConfirmButton = document.querySelector("#network-history-confirm");
const networkHistoryCancelButton = document.querySelector("#network-history-cancel");
const networkManage = document.querySelector("#network-manage");
const networkManageButton = document.querySelector("#network-manage-unfollows");
const networkManageNote = document.querySelector("#network-manage-note");
const networkManager = document.querySelector("#network-manager");
const networkManagerBack = document.querySelector("#network-manager-back");
const networkManagerHeading = document.querySelector("#network-manager-heading");
const networkManagerSummary = document.querySelector("#network-manager-summary");
const networkManagerBlocked = document.querySelector("#network-manager-blocked");
const networkManagerAnnouncement = document.querySelector("#network-manager-announcement");
const networkManagerFilterGroup = document.querySelector("#network-manager-filter-group");
const networkManagerFilter = document.querySelector("#network-manager-filter");
const networkManagerEmpty = document.querySelector("#network-manager-empty");
const networkManagerList = document.querySelector("#network-manager-list");
const networkManagerStatus = document.querySelector("#network-manager-status");
const networkManagerControls = document.querySelector("#network-manager-controls");
const networkManagerMore = document.querySelector("#network-manager-more");
const networkManagerAll = document.querySelector("#network-manager-all");
const networkManagerCollapse = document.querySelector("#network-manager-collapse");
const networkExport = document.querySelector("#network-export");
const networkOutput = document.querySelector("#network-output");
const networkCopyButton = document.querySelector("#network-copy-button");
const networkDownloadButton = document.querySelector("#network-download-button");
const pinnedSummary = document.querySelector("#pinned-summary");
const pinnedShortfall = document.querySelector("#pinned-shortfall");
const pinnedRecommendedList = document.querySelector("#pinned-recommended-list");
const pinnedCurrentNote = document.querySelector("#pinned-current-note");
const pinnedCurrentList = document.querySelector("#pinned-current-list");
const pinnedChangesNote = document.querySelector("#pinned-changes-note");
const pinnedChangesList = document.querySelector("#pinned-changes-list");
const pinnedPrivateSection = document.querySelector("#pinned-private-section");
const pinnedPrivateList = document.querySelector("#pinned-private-list");
const pinnedExcludedSection = document.querySelector("#pinned-excluded-section");
const pinnedExcludedList = document.querySelector("#pinned-excluded-list");

/**
 * Result tabs, in the order the tab strip presents them.
 */
const RESULT_TABS = ["overview", "audit", "repositories", "network", "pinned", "markdown"];

/**
 * Result tabs available in the authenticated private audit.
 *
 * Network is a public-profile view. The pinned optimizer stays available because
 * an authorized audit is the only place a private repository can be recognized as
 * strong portfolio work while being reported as something a public profile cannot
 * pin.
 */
const PRIVATE_MODE_TABS = ["audit", "pinned", "markdown"];

const appState = {
  user: null,
  repositories: [],
  contributedRepositories: [],
  audits: [],
  supplemental: null,
  mode: "public",
  authUser: null,
  // Whether this session passed through the follow-management authorization. The
  // server decides it and the server enforces it; this copy exists only so the
  // interface can stop offering an action that would be refused.
  canManageFollows: false,
  privateInstallation: false,
  privateExports: { public: [], private: [], combined: [], publicSupplemental: null },
};

/**
 * how many accounts each network list shows before it is expanded
 */
const NETWORK_PAGE_SIZE = 25;

/**
 * the three network relationship lists, each disclosed independently
 *
 * accounts holds the complete list for the section; only a slice of it is ever
 * rendered, so the initial Network view stays small no matter how large the
 * network is. Markdown is always built from the complete network instead.
 */
const networkSections = ["followers", "following", "unreciprocated"].map((key) => ({
  key,
  list: document.querySelector(`#network-${key === "followers" ? "follower" : key}-list`),
  emptyState: document.querySelector(`#network-${key}-empty`),
  status: document.querySelector(`#network-${key}-status`),
  controls: document.querySelector(`#network-${key}-controls`),
  moreButton: document.querySelector(`#network-${key}-more`),
  allButton: document.querySelector(`#network-${key}-all`),
  collapseButton: document.querySelector(`#network-${key}-collapse`),
  emptyMessage: {
    followers: "No followers.",
    following: "Not following anyone.",
    unreciprocated: "Everyone you follow also follows you.",
  }[key],
  accounts: [],
  // Observation history describing `accounts`, used only to mark the accounts that
  // arrived after the baseline. Null means no history, which marks nothing.
  historyList: null,
  // What is currently in the DOM, so a disclosure change can append or trim the
  // difference instead of rebuilding a list the reader is already looking at.
  renderedAccounts: null,
  renderedCount: 0,
}));

/**
 * network state for the currently audited profile, held apart from appState so that
 * opening the Network tab can never mutate audit results. status is idle, loading,
 * loaded, or failed, and username records which profile the state belongs to.
 * visibleCounts is presentation only and never reaches the Markdown export.
 */
const networkState = {
  requestId: 0,
  username: null,
  status: "idle",
  network: null,
  notFollowingBack: null,
  markdown: "",
  visibleCounts: createInitialVisibleCounts(),
  // Set once per completed retrieval, then read by rendering and by the export, so
  // the two can never disagree about the order or about what the order means.
  history: { followers: null, following: null, storage: null, droppedProfiles: 0 },
  // The display order, held once so that reconciling a confirmed unfollow can drop
  // one account from an already ordered list instead of re-deriving the order of
  // everything else. Removing one element cannot change the relative order of the
  // rest, so re-sorting per mutation would be work that produces the same answer.
  ordered: { followers: [], following: [] },
};

/**
 * the unfollow manager, which is the only place in GitProfileLens that mutates
 *
 * Why this is a separate state object rather than a fourth network section
 * -----------------------------------------------------------------------
 * The Network sections describe what GitHub returned. This describes what the
 * reader has done about it, which outlives a re-render and has to survive the
 * list underneath it changing. Keeping the two apart is also what makes clearing
 * it on a profile switch a single assignment rather than a hunt for stale rows.
 *
 * `accounts` is a snapshot taken when the manager opened, in the Network order it
 * inherited. It deliberately does not shrink as accounts are unfollowed: removing
 * the row under the reader's cursor would move focus and shift every row below it
 * while they are working through a list. The rows are marked instead, and the
 * Network lists, counts and Markdown are what reconcile immediately.
 *
 * `outcomes` maps a normalized login to what happened to it, so a re-render after
 * a filter or a disclosure change rebuilds the same marks. `pending` holds the one
 * login with a request in flight; only that row is inert, and the rest of the
 * manager stays usable.
 */
const managerState = {
  open: false,
  username: null,
  accounts: [],
  filtered: [],
  filter: "",
  visibleCount: NETWORK_PAGE_SIZE,
  outcomes: new Map(),
  confirming: null,
  pending: null,
  // Set when the authorization the manager depends on has gone while it was open.
  // The view stays readable so the reader can see what happened; it just stops
  // offering an action that can no longer succeed.
  blocked: "",
  // Set when a confirmed unfollow has changed `networkState` but the Network
  // sections behind the manager have not been repainted yet.
  dirty: false,
  renderedAccounts: null,
  renderedCount: 0,
  // Normalized login to rendered row, so repainting one row after a mutation is a
  // lookup rather than a scan of everything on screen.
  rows: new Map(),
  // Normalized login to the account as GitHub spelled it. Rows are keyed by the
  // folded login because that is the identity GitHub compares, but everything the
  // reader sees, and the login sent to the server, uses GitHub's own spelling.
  accountsByLogin: new Map(),
};

/**
 * observation history for the Network lists, stored only in this browser
 *
 * GitHub exposes no follow timestamp, so ordering can never come from the API.
 * What GitProfileLens can honestly do is remember which relationships it has seen
 * before, and place the ones it first saw most recently at the top. The store is
 * created against localStorage where the browser allows it, and against nothing at
 * all where it does not: history is an enhancement, and the Network tab works
 * exactly as before without it.
 */
const networkHistory = GitProfileNetworkHistory.createStore({
  storage: readLocalStorage(),
});

/**
 * reads localStorage only when the browser actually permits it
 *
 * Accessing window.localStorage throws outright in some privacy configurations,
 * so the access is guarded rather than assumed.
 *
 * @returns {Object|null} usable storage, or null when storage is unavailable
 */
function readLocalStorage() {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * builds the default visible-account count for every network section
 * @returns {Object} section key to visible count
 */
function createInitialVisibleCounts() {
  return { followers: NETWORK_PAGE_SIZE, following: NETWORK_PAGE_SIZE, unreciprocated: NETWORK_PAGE_SIZE };
}

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
  tabButton.addEventListener("keydown", handleTabKeydown);
}

networkCopyButton.addEventListener("click", copyNetworkMarkdown);
networkDownloadButton.addEventListener("click", downloadNetworkMarkdown);
networkRetryButton.addEventListener("click", reloadNetwork);
networkExpandAllButton.addEventListener("click", () => setEveryNetworkSection("all"));
networkCollapseAllButton.addEventListener("click", () => setEveryNetworkSection("collapse"));
networkHistoryResetButton.addEventListener("click", () => setHistoryResetConfirmation(true));
networkHistoryCancelButton.addEventListener("click", () => setHistoryResetConfirmation(false));
networkHistoryConfirmButton.addEventListener("click", resetNetworkHistory);
networkManageButton.addEventListener("click", () => {
  if (describeManageAvailability().needsPermission) startFollowManagementAuthorization();
  else openUnfollowManager();
});
networkManagerBack.addEventListener("click", closeUnfollowManager);
networkManagerMore.addEventListener("click", () => {
  managerState.visibleCount += NETWORK_PAGE_SIZE;
  renderUnfollowManager();
});
networkManagerAll.addEventListener("click", () => {
  managerState.visibleCount = managerState.filtered.length;
  renderUnfollowManager();
});
networkManagerCollapse.addEventListener("click", () => {
  managerState.visibleCount = NETWORK_PAGE_SIZE;
  renderUnfollowManager();
});
networkManagerFilter.addEventListener("input", () => {
  managerState.filter = networkManagerFilter.value;
  // Narrowing the list starts its disclosure over, so a filter applied after
  // Show all does not silently render every match.
  managerState.visibleCount = NETWORK_PAGE_SIZE;
  renderUnfollowManager();
});
// One delegated listener for the whole list, so a manager holding several hundred
// rows attaches three handlers rather than a thousand.
networkManagerList.addEventListener("click", handleManagerListClick);
networkManagerList.addEventListener("keydown", (event) => {
  // Escape backs out of a confirmation the way it backs out of a dialog, without
  // the row having to be a dialog.
  if (event.key !== "Escape" || !managerState.confirming) return;
  event.stopPropagation();
  setManagerConfirmation(managerState.confirming, false);
});

for (const section of networkSections) {
  section.moreButton.addEventListener("click", () => {
    networkState.visibleCounts[section.key] += NETWORK_PAGE_SIZE;
    applyNetworkDisclosure(section);
  });
  section.allButton.addEventListener("click", () => {
    networkState.visibleCounts[section.key] = section.accounts.length;
    applyNetworkDisclosure(section);
  });
  section.collapseButton.addEventListener("click", () => {
    networkState.visibleCounts[section.key] = NETWORK_PAGE_SIZE;
    applyNetworkDisclosure(section);
  });
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
    const [rawRepositories, supplemental, contributedRepositories] = await Promise.all([
      fetchAllRepositories(user.login),
      fetchSupplementalMetadata(user.login),
      fetchContributedRepositories(user.login),
    ]);
    const repositories = transformRepositories(rawRepositories, supplemental);
    const audits = repositories.map(scoreTransformedRepository);

    appState.user = user;
    appState.repositories = repositories;
    appState.contributedRepositories = contributedRepositories;
    appState.audits = audits;
    appState.supplemental = supplemental;
    appState.mode = "public";

    // A newly audited profile must never inherit the previous profile's network.
    resetNetworkState();

    updateShareUrl(user.login);
    renderResults();
    showResultView();
    // A ?view=network deep link activates the tab before any profile exists, so the
    // lazy load is triggered here once the audited profile is actually available.
    if (isNetworkTabActive()) ensureNetworkLoaded();
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
    // A capability the server reports, never a credential. The server checks it
    // again on every mutation, so this copy only decides what is offered.
    appState.canManageFollows = Boolean(appState.authUser && data.can_manage_follows);
    renderAuthState();
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("auth");
    if (outcome === "success" && appState.authUser) {
      statusEl.textContent = `Signed in as @${appState.authUser.login}. Choose repositories to audit.`;
      url.searchParams.delete("auth");
      history.replaceState(null, "", url);
    }
    if (outcome === "manage-follows" && appState.authUser) {
      statusEl.textContent = appState.canManageFollows
        ? `GitProfileLens can now unfollow accounts you choose, as @${appState.authUser.login}. ` +
          "It will never unfollow anyone automatically."
        : "GitHub did not grant permission to manage who you follow.";
      url.searchParams.delete("auth");
      history.replaceState(null, "", url);
    }
  } catch {
    appState.authUser = null;
    appState.canManageFollows = false;
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
  if (!authenticated) {
    configureAccessLink.hidden = true;
    appState.canManageFollows = false;
  }
  // Whether unfollowing may be offered follows the authorization as it stands now,
  // not the one that happened to hold when the Network tab was first loaded. An
  // open manager keeps showing what already happened, with its remaining offers
  // withdrawn, rather than vanishing mid-action.
  if (!authenticated && managerState.open && !managerState.blocked) {
    blockUnfollowManager("You are no longer signed in to GitHub.");
  }
  updateManageAvailability();
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
    const response = await fetch("/api/private-repositories", { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => null);
    if (response.status === 401) {
      appState.authUser = null;
      renderAuthState();
      throw new Error(data?.error || "Your GitHub session expired. Please sign in again.");
    }
    if (!response.ok || !data || !Array.isArray(data.repositories) ||
        !Array.isArray(data.public_repositories) || typeof data.readmes !== "object") {
      throw new Error(data?.error || "GitHub could not return authorized repositories.");
    }
    const publicSupplemental = await fetchSupplementalMetadata(appState.authUser.login);

    // Pins live on the public profile, so the authorized audit reuses the public pin list
    // already fetched above. Private repositories simply never appear in it.
    const supplemental = {
      pinnedRepositories: publicSupplemental?.pinnedRepositories || [],
      readmes: data.readmes,
    };
    const repositories = transformRepositories(data.repositories, supplemental);
    const publicRepositories = transformRepositories(data.public_repositories, publicSupplemental)
      .filter((repository) => !repository.private);
    const privateRepositories = repositories.filter((repository) => repository.private);
    appState.user = appState.authUser;
    appState.repositories = repositories;
    appState.contributedRepositories = [];
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
    // The Network tab is public-profile only, so entering private mode drops it.
    resetNetworkState();
    renderResults();
    showResultView();
    if (!data.installation) {
      statusEl.textContent = "GitProfileLens is connected, but no GitHub App installation is available.";
    } else if (data.metadata?.complete === false) {
      const unavailable = Number(data.metadata.unavailable_readmes) || 0;
      statusEl.textContent = `Analyzed ${repositories.length} authorized ${repositories.length === 1 ? "repository" : "repositories"}. ${unavailable} ${unavailable === 1 ? "README was" : "READMEs were"} unavailable and scored neutrally as unverified. Private repositories remain separate from your public score.`;
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
      appState.contributedRepositories = [];
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
 * fetches informational external contributions from the public report endpoint
 * @param {string} username github username
 * @returns {Promise<Array<Object>>} normalized public contributed repositories
 */
async function fetchContributedRepositories(username) {
  try {
    const response = await fetch(
      `/api/report?user=${encodeURIComponent(username)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.contributed_repositories) ? data.contributed_repositories : [];
  } catch {
    return [];
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
  // One profile score for the whole render. It is a deterministic function of the
  // finished audits, so the header and the overview were computing the same answer
  // twice over every repository.
  const profileScore = GitHubAudit.scoreProfile(appState.audits);
  renderProfileHeader(profileScore);
  renderOverview(profileScore);
  renderAudits();
  renderRepositories();
  renderContributions();
  renderPinnedOptimizer();
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
  renderPinnedOptimizer();
  refreshMarkdown();
  activateTab("audit", false);
}

function setResultMode(mode) {
  const privateMode = mode === "private";
  shareButton.hidden = privateMode;
  scoreCardButton.hidden = privateMode;
  for (const button of tabButtons) {
    button.hidden = privateMode && !PRIVATE_MODE_TABS.includes(button.dataset.tab);
  }
  publicExportOptions.hidden = privateMode;
  if (privateMode) contributionsSection.hidden = true;
  privateExportOptions.hidden = !privateMode;
  privateExportNote.hidden = !privateMode;
  auditEyebrow.textContent = privateMode ? "Authorized repositories only" : "Lowest scores first";
  auditTitle.textContent = privateMode ? "Private Repository Audit" : "Repository audit";
  // The score band describes presentation only, in both modes. Portfolio candidacy
  // is a separate judgment shown per repository, so this guide never restates it as
  // a band; the private guide used to, which made the band read as a candidacy rule.
  ratingGuide.textContent =
    "Presentation score: 90–100 strong · 70–89 minor improvements · below 70 needs attention. " +
    "Portfolio candidacy is judged separately on each repository.";
}

/**
 * renders profile identity information
 * @param {Object} profileScore profile score already computed for this render
 * @returns {void} no return value
 */
function renderProfileHeader(profileScore) {
  const user = appState.user;
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
 * @param {Object} profileScore profile score already computed for this render
 * @returns {void} no return value
 */
function renderOverview(profileScore) {
  if (appState.mode !== "public") return;
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
  card.className = "audit-card";
  // The pinned optimizer links here by repository name instead of repeating a
  // repository's findings inside its recommendation card.
  card.dataset.auditRepository = repository.name;
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
  if (repository.fork === true) {
    const forkBadge = document.createElement("span");
    forkBadge.className = "fork-badge";
    forkBadge.textContent = "Fork";
    title.appendChild(forkBadge);
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
  if (repository.fork === true) {
    factBadges.unshift(createFactBadge("Fork: Yes"));
  }
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

  card.append(header, description, facts, createCandidatePanel(audit.candidate));
  if (readmeChecklist) card.appendChild(readmeChecklist);
  card.appendChild(findings);
  return card;
}

/** Badge modifier for each portfolio candidate label. */
const CANDIDATE_CLASSES = {
  strong: "is-strong",
  polish: "is-polish",
  deemphasize: "is-deemphasize",
};

/**
 * creates the portfolio candidacy panel for a repository audit
 *
 * Candidacy is shown in both public and private mode, and is deliberately styled
 * apart from the score pill, the factual metadata badges, and finding severity,
 * because it answers a different question from any of them: whether this is a
 * good repository to put in front of a visitor first.
 *
 * @param {Object} candidate portfolio candidate classification
 * @returns {HTMLElement} candidacy panel
 */
function createCandidatePanel(candidate) {
  const panel = document.createElement("section");
  const header = document.createElement("div");
  const label = document.createElement("span");
  const eyebrow = document.createElement("span");
  const explanation = document.createElement("p");
  panel.className = "candidate-panel";
  header.className = "candidate-header";
  eyebrow.className = "candidate-eyebrow";
  eyebrow.textContent = "Portfolio candidacy";
  label.className = `candidate-badge ${CANDIDATE_CLASSES[candidate.label]}`;
  label.textContent = candidate.title;
  header.append(eyebrow, label);

  if (candidate.qualifier) {
    const qualifier = document.createElement("span");
    qualifier.className = "candidate-qualifier";
    qualifier.textContent = candidate.qualifier;
    header.appendChild(qualifier);
  }

  explanation.className = "candidate-explanation";
  explanation.textContent = candidate.explanation;
  panel.append(header, explanation);
  return panel;
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

function renderContributions() {
  const repositories = appState.contributedRepositories;
  contributionsSection.hidden = false;
  contributionSummary.textContent = `${repositories.length} external ${repositories.length === 1 ? "project" : "projects"} found.`;
  contributionList.replaceChildren();

  if (repositories.length === 0) {
    contributionList.appendChild(createEmptyState("No public external repositories with merged authored pull requests were found."));
    return;
  }

  for (const repository of repositories) {
    const card = document.createElement("article");
    const content = document.createElement("div");
    const heading = document.createElement("div");
    const title = document.createElement("a");
    const count = document.createElement("span");
    const description = document.createElement("p");
    const metadata = document.createElement("p");
    card.className = "repository-card contributed-repository-card";
    content.className = "repository-card-content";
    heading.className = "repository-card-heading";
    title.href = repository.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = repository.full_name;
    count.className = "contribution-count";
    count.textContent = `${repository.contribution.merged_pull_requests} merged ${repository.contribution.merged_pull_requests === 1 ? "PR" : "PRs"}`;
    description.textContent = repository.description || "No description";
    metadata.className = "repo-meta-line";
    metadata.textContent = `${repository.primary_language || "Unknown language"} · ${repository.stars} stars · ${repository.forks} forks`;
    heading.append(title, count);
    content.append(heading, description, metadata);
    card.append(content);
    contributionList.appendChild(card);
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
  flags.textContent = [repository.pinned ? "Pinned" : "", repository.archived ? "Archived" : "", repository.fork === true ? "Fork" : ""].filter(Boolean).join(" · ");
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
    repositoryLines.push(`- forked repository: ${repository.fork === true ? "Yes" : repository.fork === false ? "No" : "Unavailable"}`);
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
        `- archived: ${repository.archived ? "Yes" : "No"}`
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
 * renders the pinned repository optimizer from the current audits
 *
 * The optimizer runs over audits already in memory, so opening this tab issues no
 * GitHub request and cannot change any score already shown elsewhere.
 *
 * @returns {void} no return value
 */
function renderPinnedOptimizer() {
  const result = GitProfilePinnedOptimizer.optimizePinnedSet(appState.audits);

  pinnedSummary.textContent = result.recommended.length === 0
    ? `0 of up to ${result.limit} slots recommended.`
    : `${result.recommended.length} of up to ${result.limit} slots recommended, from ${result.eligibleCount} eligible ${result.eligibleCount === 1 ? "repository" : "repositories"}.`;

  pinnedShortfall.hidden = result.shortfall === null;
  pinnedShortfall.textContent = result.shortfall ?? "";

  pinnedRecommendedList.replaceChildren();
  if (result.recommended.length === 0) {
    pinnedRecommendedList.appendChild(createEmptyState("No repository currently meets the recommendation criteria."));
  } else {
    for (const entry of result.recommended) {
      pinnedRecommendedList.appendChild(createPinnedRecommendationCard(entry));
    }
  }

  renderPinnedCurrentSet(result);
  renderPinnedChanges(result);
  renderPinnedPrivateWork(result);
  renderPinnedExclusions(result);
}

/**
 * renders what GitHub currently reports as pinned
 * @param {Object} result optimizer result
 * @returns {void} no return value
 */
function renderPinnedCurrentSet(result) {
  const recommended = new Set(result.recommended.map((entry) => entry.name));
  pinnedCurrentList.replaceChildren();

  if (!result.currentPinsKnown) {
    pinnedCurrentNote.textContent = "GitProfileLens could not verify which repositories this profile pins, so the two sets cannot be compared. The recommended set above is unaffected.";
    return;
  }

  if (result.currentPinned.length === 0) {
    pinnedCurrentNote.textContent = "This profile pins no repositories.";
    return;
  }

  pinnedCurrentNote.textContent = `GitHub reports ${result.currentPinned.length} pinned ${result.currentPinned.length === 1 ? "repository" : "repositories"}, in profile order.`;
  for (const name of result.currentPinned) {
    const item = document.createElement("li");
    const marker = document.createElement("span");
    const label = document.createElement("span");
    const inSet = recommended.has(name);
    marker.className = `pinned-marker ${inSet ? "is-kept" : "is-outgoing"}`;
    marker.textContent = inSet ? "✓" : "✕";
    marker.setAttribute("aria-hidden", "true");
    label.textContent = name;
    item.className = "pinned-current-item";
    item.append(marker, label, createPinnedStatus(inSet ? "In the recommended set" : "Not in the recommended set"));
    pinnedCurrentList.appendChild(item);
  }
}

/**
 * renders the advisory difference between the current pins and the recommendation
 * @param {Object} result optimizer result
 * @returns {void} no return value
 */
function renderPinnedChanges(result) {
  pinnedChangesList.replaceChildren();
  pinnedChangesNote.hidden = false;

  if (!result.currentPinsKnown) {
    pinnedChangesNote.textContent = "Pinned repository data was unavailable, so there is nothing to compare.";
    return;
  }
  if (result.alreadyOptimal) {
    pinnedChangesNote.textContent = "Your current pinned repositories already match the optimizer's recommended set.";
    return;
  }
  if (result.changes.length === 0) {
    pinnedChangesNote.textContent = "There is nothing to compare yet.";
    return;
  }

  pinnedChangesNote.hidden = true;
  for (const change of result.changes) {
    const card = document.createElement("article");
    const heading = document.createElement("div");
    const action = document.createElement("span");
    const name = document.createElement("strong");
    const explanation = document.createElement("p");
    card.className = "pinned-change";
    heading.className = "pinned-change-heading";
    action.className = `pinned-action is-${change.action}`;
    action.textContent = change.title;
    name.textContent = change.repository;
    heading.append(action, name);
    explanation.textContent = change.explanation;
    card.append(heading, explanation);
    pinnedChangesList.appendChild(card);
  }
}

/**
 * renders authorized private repositories that read as strong portfolio work
 * @param {Object} result optimizer result
 * @returns {void} no return value
 */
function renderPinnedPrivateWork(result) {
  pinnedPrivateSection.hidden = result.privateCandidates.length === 0;
  pinnedPrivateList.replaceChildren();

  for (const entry of result.privateCandidates) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    item.className = "pinned-current-item";
    label.textContent = entry.name;
    item.append(label, createPinnedStatus(`${entry.title} · not publicly pinnable`));
    pinnedPrivateList.appendChild(item);
  }
}

/**
 * renders the repositories that were not considered for the recommended set
 * @param {Object} result optimizer result
 * @returns {void} no return value
 */
function renderPinnedExclusions(result) {
  pinnedExcludedSection.hidden = result.excluded.length === 0;
  pinnedExcludedList.replaceChildren();

  for (const group of result.excluded) {
    const card = document.createElement("article");
    const explanation = document.createElement("p");
    const repositories = document.createElement("p");
    card.className = "pinned-excluded-group";
    explanation.className = "pinned-excluded-reason";
    explanation.textContent = group.explanation;
    repositories.className = "affected-repositories";
    repositories.textContent = formatRepositoryNames(group.repositories);
    card.append(explanation, repositories);
    pinnedExcludedList.appendChild(card);
  }
}

/**
 * creates one recommended repository entry
 *
 * The card carries the candidacy label, the presentation score, and the reasons
 * the optimizer recorded when it chose this repository, then links to the
 * repository's own audit card rather than repeating its findings here.
 *
 * @param {Object} entry recommended repository entry
 * @returns {HTMLElement} recommendation card
 */
function createPinnedRecommendationCard(entry) {
  const card = document.createElement("article");
  const header = document.createElement("div");
  const heading = document.createElement("h4");
  const position = document.createElement("span");
  const badge = document.createElement("span");
  const score = document.createElement("span");
  const reasons = document.createElement("ul");
  card.className = "pinned-card";
  header.className = "pinned-card-header";
  position.className = "pinned-position";
  position.textContent = entry.position;
  heading.className = "pinned-card-name";
  heading.append(position, document.createTextNode(entry.name));
  badge.className = `candidate-badge ${CANDIDATE_CLASSES[entry.label]}`;
  badge.textContent = entry.title;
  score.className = "pinned-score";
  score.textContent = `Presentation score: ${entry.score}`;
  header.append(heading, badge, score);

  if (entry.qualifier) {
    const qualifier = document.createElement("span");
    qualifier.className = "candidate-qualifier";
    qualifier.textContent = entry.qualifier;
    header.appendChild(qualifier);
  }

  reasons.className = "pinned-reasons";
  for (const reason of entry.reasons) {
    const item = document.createElement("li");
    item.textContent = reason;
    reasons.appendChild(item);
  }

  card.append(header, reasons, createAuditJumpLink(entry.name));
  return card;
}

/**
 * creates a link from a recommendation to the repository's own audit card
 * @param {string} name repository name
 * @returns {HTMLElement} audit navigation button
 */
function createAuditJumpLink(name) {
  const link = document.createElement("button");
  link.type = "button";
  link.className = "secondary pinned-audit-link";
  link.dataset.auditTarget = name;
  link.textContent = "View repository audit";
  link.addEventListener("click", () => showRepositoryAudit(name));
  return link;
}

/**
 * opens the Audit tab and brings one repository's audit card into view
 * @param {string} name repository name
 * @returns {void} no return value
 */
function showRepositoryAudit(name) {
  activateTab("audit", true);
  for (const highlighted of auditList.querySelectorAll(".is-highlighted")) {
    highlighted.classList.remove("is-highlighted");
  }
  const card = auditList.querySelector(`[data-audit-repository="${CSS.escape(name)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.add("is-highlighted");
}

/**
 * creates the trailing status text of a pinned list entry
 * @param {string} text status text
 * @returns {HTMLElement} status element
 */
function createPinnedStatus(text) {
  const status = document.createElement("span");
  status.className = "pinned-status";
  status.textContent = text;
  return status;
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
 * moves focus between available tabs using the ARIA tabs keyboard pattern
 * @param {KeyboardEvent} event keyboard event from a tab button
 * @returns {void} no return value
 */
function handleTabKeydown(event) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;

  const availableTabs = [...tabButtons].filter((button) => !button.hidden);
  const currentIndex = availableTabs.indexOf(event.currentTarget);
  if (currentIndex < 0) return;

  let nextIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = availableTabs.length - 1;
  else {
    const direction = event.key === "ArrowRight" ? 1 : -1;
    nextIndex = (currentIndex + direction + availableTabs.length) % availableTabs.length;
  }

  event.preventDefault();
  const nextTab = availableTabs[nextIndex];
  nextTab.focus();
  activateTab(nextTab.dataset.tab, true);
}

/**
 * activates one result tab and optionally updates the url
 * @param {string} tabName tab identifier
 * @param {boolean} updateUrl whether to write the tab into the url
 * @returns {void} no return value
 */
function activateTab(tabName, updateUrl) {
  if (appState.mode === "private" && !PRIVATE_MODE_TABS.includes(tabName)) tabName = "audit";
  const validTab = RESULT_TABS.includes(tabName)
    ? tabName
    : "overview";

  for (const button of tabButtons) {
    const active = button.dataset.tab === validTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }

  for (const panel of tabPanels) {
    panel.hidden = panel.id !== `${validTab}-panel`;
  }

  if (updateUrl && appState.user && appState.mode === "public") {
    updateShareUrl(appState.user.login, validTab);
  }

  // Follower and following pages are fetched only once this tab is actually opened,
  // so an ordinary audit spends none of the unauthenticated request budget on them.
  if (validTab === "network") ensureNetworkLoaded();
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
  const parameters = new URLSearchParams(window.location.search);
  const username = GitHubAudit.parseUsernameFromSearch(window.location.search);
  const tabName = parameters.get("view") || "overview";
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
 * loads the network for the audited profile the first time the tab is opened
 *
 * A successful result is cached against the username it belongs to, so switching
 * away and back does not refetch. A failed attempt is also remembered rather than
 * retried automatically, because the usual cause is the unauthenticated rate limit
 * and silently retrying on every tab switch would spend the remaining budget. The
 * Try again button re-requests explicitly.
 *
 * @returns {void} no return value
 */
function ensureNetworkLoaded() {
  const username = appState.mode === "public" ? appState.user?.login : null;
  if (!username) return;
  if (networkState.status === "loading") return;
  if (networkState.username === username && networkState.status !== "idle") return;
  loadNetwork(username);
}

/**
 * reports whether the Network tab is the one currently selected
 * @returns {boolean} true when the network tab is active
 */
function isNetworkTabActive() {
  return [...tabButtons].some(
    (button) => button.dataset.tab === "network" && button.classList.contains("is-active")
  );
}

/**
 * re-requests the network for the audited profile after a failed attempt
 * @returns {void} no return value
 */
function reloadNetwork() {
  if (appState.mode !== "public" || !appState.user?.login) return;
  // An explicit retry reads the profile again rather than reusing the audit's
  // copy: the reader asked for another look at GitHub, not at what is in memory.
  loadNetwork(appState.user.login, { refresh: true });
}

/**
 * clears network state so one profile's followers can never appear under another
 * @returns {void} no return value
 */
function resetNetworkState() {
  networkState.requestId += 1;
  networkState.username = null;
  networkState.status = "idle";
  networkState.network = null;
  networkState.notFollowingBack = null;
  networkState.markdown = "";
  clearNetworkPanel();
}

/**
 * retrieves and renders the complete public follower and following lists
 * @param {string} username github username to load
 * @param {Object} options set refresh to re-read the profile instead of reusing the audit's
 * @returns {Promise<void>} no return value
 */
async function loadNetwork(username, options = {}) {
  const validation = GitProfileNetwork.validateUsername(username);
  if (!validation.ok) {
    resetNetworkState();
    networkState.status = "failed";
    showNetworkError(validation.message);
    return;
  }

  const requestId = (networkState.requestId += 1);
  clearNetworkPanel();
  networkState.username = validation.username;
  networkState.status = "loading";
  networkState.network = null;
  networkState.notFollowingBack = null;
  networkState.markdown = "";
  networkStatus.classList.remove("error");
  networkStatus.textContent = `Loading the public network for @${validation.username}…`;
  networkSummary.textContent = "Loading…";

  try {
    // The audit already fetched this profile. Handing it over turns opening the
    // Network tab from four GitHub requests into three on a live-shaped profile,
    // which matters against an unauthenticated allowance of sixty an hour.
    const network = await GitProfileNetwork.fetchNetwork(validation.username, {
      profile: options.refresh ? null : appState.user,
    });
    if (requestId !== networkState.requestId) return;
    networkState.status = "loaded";
    renderNetwork(network);
  } catch (error) {
    if (requestId !== networkState.requestId) return;
    clearNetworkPanel();
    networkState.status = "failed";
    showNetworkError(error.message);
  }
}

/**
 * renders a retrieved network and enables export only when it is complete
 * @param {Object} network retrieved network result
 * @returns {void} no return value
 */
function renderNetwork(network) {
  networkState.network = network;

  // Exactly one observation per completed retrieval, recorded before anything is
  // ordered so that the list the reader sees is ordered by history that already
  // includes this observation. Re-rendering never records again.
  recordNetworkObservation(network);

  networkFollowerCount.textContent = formatNetworkCount(network.followers);
  networkFollowingCount.textContent = formatNetworkCount(network.following);
  const followers = orderNetworkList("followers", network.followers);
  const following = orderNetworkList("following", network.following);
  networkState.ordered = { followers, following };
  setNetworkSectionAccounts("followers", followers, networkState.history.followers);
  setNetworkSectionAccounts("following", following, networkState.history.following);
  networkResults.hidden = false;
  renderNetworkOrderingNote();

  const incompleteReason = GitProfileNetwork.describeIncompleteRetrieval(network);
  if (incompleteReason) {
    // A login missing from a partial followers list may sit on a page that never
    // arrived, so the derived difference is withheld rather than shown as a fact.
    networkUnreciprocatedSection.hidden = true;
    networkUnreciprocatedCount.textContent = "Unavailable";
    networkNotice.textContent = incompleteReason;
    networkNotice.classList.add("is-error");
    networkNotice.hidden = false;
    networkSummary.textContent = "Retrieval incomplete";
    setNetworkSectionAccounts("unreciprocated", [], null);
    updateGlobalDisclosureControls();
    updateManageAvailability();
    showNetworkError(`The network for @${network.user.login} could not be completely retrieved.`);
    return;
  }

  // Non-follow-back is Following minus Followers and has no chronology of its own,
  // so it is derived from the already ordered Following list and inherits it.
  const notFollowingBack = GitProfileNetwork.deriveNotFollowingBack({
    ...network,
    following: { ...network.following, accounts: following },
  });
  networkState.notFollowingBack = notFollowingBack;
  networkUnreciprocatedCount.textContent = String(notFollowingBack.length);
  setNetworkSectionAccounts("unreciprocated", notFollowingBack, networkState.history.following);
  networkUnreciprocatedSection.hidden = false;
  updateGlobalDisclosureControls();
  updateManageAvailability();

  networkState.markdown = GitProfileNetwork.buildMarkdown(network, {
    followers,
    following,
    notFollowingBack,
    orderingNote: networkOrderingNote.textContent,
  });
  networkOutput.value = networkState.markdown;
  networkExport.hidden = false;
  networkCopyButton.disabled = false;
  networkDownloadButton.disabled = false;

  const countDifference = GitProfileNetwork.describeCountDifference(network);
  if (countDifference) {
    networkNotice.textContent = countDifference;
    networkNotice.hidden = false;
  }

  networkSummary.textContent = `Public network for @${network.user.login}`;
  networkStatus.textContent =
    `Loaded ${network.followers.accounts.length} followers and ` +
    `${network.following.accounts.length} following for @${network.user.login}. ` +
    `${notFollowingBack.length} of those followed accounts do not follow back.`;
}

/**
 * records one observation of the retrieved network in this browser's history
 *
 * The recorded time is shared by everything seen in this retrieval, which is the
 * only honest reading: seeing 131 followers at once establishes that all 131
 * existed by this moment and establishes nothing about their order. An incomplete
 * list is skipped entirely by the store, so a retrieval that stopped early can
 * never mark the accounts it did not reach as gone.
 *
 * @param {Object} network retrieved network result
 * @returns {Object} the store's outcome for this observation
 */
function recordNetworkObservation(network) {
  const outcome = networkHistory.recordNetworkObservation({
    login: network.user.login,
    followers: network.followers,
    following: network.following,
    observedAt: new Date(),
  });

  networkState.history = {
    followers: network.followers.complete ? outcome.lists.followers : null,
    following: network.following.complete ? outcome.lists.following : null,
    // What the store actually persisted, so the note can say so when it could not.
    storage: outcome.wrote ? null : outcome.error,
    droppedProfiles: outcome.droppedProfiles ?? 0,
  };
  return outcome;
}

/**
 * orders one retrieved list by observation history, or leaves github's order alone
 *
 * An incomplete list is never reordered. Its history was deliberately not updated,
 * so reordering it would present a mixture of current and stale evidence as one
 * chronology.
 *
 * @param {string} key relationship identifier
 * @param {Object} relationship retrieved relationship list
 * @returns {Array<Object>} the accounts to render and export, in display order
 */
function orderNetworkList(key, relationship) {
  if (!relationship.complete) return relationship.accounts;
  return GitProfileNetworkHistory.orderAccounts(
    relationship.accounts,
    networkState.history[key]
  ).accounts;
}

/**
 * states what the current order means and offers to delete the history behind it
 *
 * The sentence is never "newest follows first". The strongest claim the evidence
 * supports is about when this browser first saw each relationship, so that is the
 * claim the interface makes, and the Markdown export reuses this exact sentence.
 *
 * @returns {void} no return value
 */
function renderNetworkOrderingNote() {
  const lists = [networkState.history.followers, networkState.history.following].filter(Boolean);
  // The list that has learned the most decides the wording, so a profile whose
  // Following has grown is not described as if nothing had ever been observed.
  const describing = lists.reduce(
    (best, list) =>
      best === null || GitProfileNetworkHistory.listCohorts(list).length >
        GitProfileNetworkHistory.listCohorts(best).length
        ? list
        : best,
    null
  );

  networkOrderingNote.textContent = GitProfileNetworkHistory.describeOrdering(describing);

  if (!describing) {
    networkHistoryNote.hidden = true;
    networkHistoryControls.hidden = true;
    return;
  }

  const observations = Math.max(...lists.map((list) => list.observationCount));
  const sentences = [
    "Observation history is kept only in this browser and is never uploaded.",
    `${observations} ${observations === 1 ? "observation" : "observations"} recorded since ` +
      `${formatShortDate(describing.baselineObservedAt)}.`,
  ];

  // A browser that refused the write leaves the order above describing history
  // that was already stored, not this visit. Saying so is better than letting the
  // count quietly stop advancing.
  if (networkState.history.storage === "quota") {
    sentences.push(
      "This browser's storage is full, so this visit could not be added to the history below."
    );
  } else if (networkState.history.droppedProfiles > 0) {
    const dropped = networkState.history.droppedProfiles;
    sentences.push(
      `Storage was full, so history for ${dropped} other ${dropped === 1 ? "profile" : "profiles"} ` +
      "was released to make room for this one."
    );
  }

  networkHistoryNote.textContent = sentences.join(" ");
  networkHistoryNote.hidden = false;
  networkHistoryControls.hidden = false;
  setHistoryResetConfirmation(false);
}

/**
 * shows or hides the deliberate confirmation step before history is deleted
 * @param {boolean} confirming whether the confirmation step should be shown
 * @returns {void} no return value
 */
function setHistoryResetConfirmation(confirming) {
  const wasConfirming = !networkHistoryConfirmGroup.hidden;
  networkHistoryResetButton.hidden = confirming;
  networkHistoryConfirmGroup.hidden = !confirming;
  // The control the reader just used disappears either way, so focus is moved to
  // the one that replaced it rather than dropped back to the document.
  if (confirming) networkHistoryConfirmButton.focus();
  else if (wasConfirming) networkHistoryResetButton.focus();
}

/**
 * deletes every profile's observation history after the reader confirms
 *
 * History is deleted only from here. Clearing it is not folded into any other
 * action, because accumulated observations cannot be re-derived once discarded.
 *
 * @returns {void} no return value
 */
function resetNetworkHistory() {
  networkHistory.reset();
  networkState.history = { followers: null, following: null, storage: null, droppedProfiles: 0 };
  networkHistoryConfirmGroup.hidden = true;
  networkHistoryResetButton.hidden = true;
  networkHistoryControls.hidden = true;
  networkHistoryNote.hidden = false;
  networkHistoryNote.textContent =
    "Observation history deleted. The next time this network is loaded it starts a new baseline.";
  // Every control in this group is now gone, so focus lands on the sentence that
  // says what happened instead of being lost to the document body.
  networkHistoryNote.focus();

  if (!networkState.network) return;
  // The lists on screen were ordered by history that no longer exists, so they are
  // returned to GitHub's order rather than left in an order nothing now explains.
  const network = networkState.network;
  const followers = network.followers.accounts;
  const following = network.following.accounts;
  networkState.ordered = { followers, following };
  setNetworkSectionAccounts("followers", followers, null);
  setNetworkSectionAccounts("following", following, null);
  networkOrderingNote.textContent = GitProfileNetworkHistory.describeOrdering(null);

  if (networkState.notFollowingBack) {
    const notFollowingBack = GitProfileNetwork.deriveNotFollowingBack(network);
    networkState.notFollowingBack = notFollowingBack;
    setNetworkSectionAccounts("unreciprocated", notFollowingBack, null);
    networkState.markdown = GitProfileNetwork.buildMarkdown(network, {
      followers,
      following,
      notFollowingBack,
      orderingNote: networkOrderingNote.textContent,
    });
    networkOutput.value = networkState.markdown;
  }
}

/**
 * decides whether unfollow management may be offered, and says why when it may not
 *
 * Three independent conditions have to hold, and each is refused for its own
 * reason rather than collapsed into one unavailable state:
 *
 *  - The difference has to be authoritative. Non-follow-back is Following minus
 *    Followers, and a login missing from a partial followers list may simply be on
 *    a page that never arrived. Offering to end relationships on the strength of a
 *    guess is exactly the wrong place to be approximate.
 *  - The audited profile has to be the signed-in account. GitProfileLens can show
 *    anyone's public relationships, but a session belonging to one account cannot
 *    manage another account's follows, and the interface should not imply it can.
 *    Logins are compared the way GitHub compares them, case-folded.
 *  - The session has to carry the follow-management permission, which is granted
 *    by an authorization the reader passes through deliberately.
 *
 * @returns {Object} whether the action is actionable, a note, and whether to offer opt-in
 */
function describeManageAvailability() {
  if (networkState.status !== "loaded" || !networkState.network) {
    return { actionable: false, note: "" };
  }
  const network = networkState.network;
  if (!network.followers.complete || !network.following.complete) {
    return {
      actionable: false,
      note: "Managing unfollows needs both the Followers and Following lists in full. " +
        "Until they are complete, an account missing from Followers may just be on a page " +
        "that did not arrive, so GitProfileLens will not offer to act on the difference.",
    };
  }
  if (!appState.authUser) {
    return {
      actionable: false,
      note: `Sign in as @${network.user.login} to manage who this account follows.`,
    };
  }
  if (appState.authUser.login.toLowerCase() !== network.user.login.toLowerCase()) {
    return {
      actionable: false,
      note: `You are signed in as @${appState.authUser.login} and viewing @${network.user.login}. ` +
        "You can only manage the follows of the account you are signed in as.",
    };
  }
  if (!appState.canManageFollows) {
    return {
      actionable: false,
      needsPermission: true,
      note: "Managing follows requires permission to change who you follow. " +
        "GitProfileLens never unfollows accounts automatically, and asks for this " +
        "only so you can unfollow an account yourself from here.",
    };
  }
  return { actionable: true, note: "" };
}

/**
 * shows, hides, or explains the entry point into the unfollow manager
 * @returns {void} no return value
 */
function updateManageAvailability() {
  const availability = describeManageAvailability();
  const visible = networkState.status === "loaded" && Boolean(networkState.network);
  networkManage.hidden = !visible;
  if (!visible) {
    networkManageButton.hidden = true;
    networkManageNote.textContent = "";
    return;
  }

  if (availability.actionable) {
    const count = networkState.notFollowingBack?.length ?? 0;
    networkManageButton.hidden = false;
    networkManageButton.textContent = "Manage unfollows";
    networkManageButton.setAttribute(
      "aria-label",
      `Manage unfollows for ${count} ${count === 1 ? "account" : "accounts"} who don't follow back`
    );
    networkManageNote.textContent = count === 0
      ? "Everyone you follow follows you back, so there is nothing to manage."
      : "Review these accounts and unfollow them one at a time.";
    return;
  }

  // The permission case is the one refusal the reader can resolve from here, so it
  // keeps a control. Every other refusal is a statement of fact, not an offer.
  networkManageButton.hidden = !availability.needsPermission;
  if (availability.needsPermission) {
    networkManageButton.textContent = "Allow managing follows";
    networkManageButton.setAttribute("aria-label", "Allow GitProfileLens to manage who you follow");
  }
  networkManageNote.textContent = availability.note;
}

/**
 * sends the reader to github to grant the follow-management permission
 *
 * A separate authorization from ordinary sign-in, so that reading a profile never
 * quietly carries the ability to change one. GitHub grants a GitHub App's user
 * permissions as one set, so this cannot narrow the token; what it does is make
 * the moment explicit and record that the reader chose it.
 *
 * @returns {void} no return value
 */
function startFollowManagementAuthorization() {
  window.location.href = "/api/auth/github?manage=follows";
}

/**
 * opens the focused management view over the network lists
 *
 * The snapshot is taken here, once, from the Network order established by
 * observation history. The manager invents no order of its own.
 *
 * @returns {void} no return value
 */
function openUnfollowManager() {
  if (!describeManageAvailability().actionable) return;

  managerState.open = true;
  managerState.username = networkState.username;
  managerState.accounts = networkState.notFollowingBack ?? [];
  managerState.accountsByLogin = new Map(
    managerState.accounts.map((account) => [account.login.toLowerCase(), account])
  );
  managerState.filter = "";
  managerState.visibleCount = NETWORK_PAGE_SIZE;
  managerState.confirming = null;
  managerState.pending = null;
  managerState.renderedAccounts = null;
  managerState.renderedCount = 0;
  managerState.blocked = "";
  networkManagerFilter.value = "";
  networkManagerAnnouncement.textContent = "";
  networkManagerAnnouncement.classList.remove("is-error");
  networkManagerBlocked.hidden = true;
  networkManagerBlocked.textContent = "";

  networkResults.hidden = true;
  networkExport.hidden = true;
  networkManager.hidden = false;
  renderUnfollowManager();
  // The view changed under the reader, so the heading takes focus and names what
  // they are now looking at rather than leaving them at the top of the document.
  networkManagerHeading.focus();
}

/**
 * returns to the network lists, re-rendering them only if a mutation changed them
 *
 * The Network sections are hidden while the manager is open, so a confirmed
 * unfollow updates `networkState` immediately and defers the DOM work to here.
 * That keeps one unfollow from rebuilding a fully expanded list of thousands of
 * pills that nobody is looking at, once per account.
 *
 * @returns {void} no return value
 */
function closeUnfollowManager() {
  if (!managerState.open) return;
  managerState.open = false;
  managerState.confirming = null;
  networkManager.hidden = true;
  // Restored only to what the network itself supports. A session that ended while
  // the manager was open must not reveal results the Network tab would not have
  // shown on its own.
  const loaded = networkState.status === "loaded" && Boolean(networkState.network);
  networkResults.hidden = !loaded;
  networkExport.hidden = !loaded || Boolean(networkState.network?.complete) === false;

  if (managerState.dirty) {
    managerState.dirty = false;
    renderReconciledNetwork();
  }
  updateManageAvailability();
  if (!networkManageButton.hidden) networkManageButton.focus();
}

/**
 * clears every trace of one profile's management state
 *
 * Called whenever the audited profile or the network underneath it changes, so a
 * pending row, an error, or a confirmation from one profile can never be shown
 * against another.
 *
 * @returns {void} no return value
 */
function resetUnfollowManager() {
  managerState.open = false;
  managerState.username = null;
  managerState.accounts = [];
  managerState.filtered = [];
  managerState.filter = "";
  managerState.visibleCount = NETWORK_PAGE_SIZE;
  managerState.outcomes = new Map();
  managerState.confirming = null;
  managerState.pending = null;
  managerState.blocked = "";
  managerState.dirty = false;
  managerState.renderedAccounts = null;
  managerState.renderedCount = 0;
  managerState.rows = new Map();
  managerState.accountsByLogin = new Map();
  networkManager.hidden = true;
  networkManagerList.replaceChildren();
  networkManagerAnnouncement.textContent = "";
  networkManagerAnnouncement.classList.remove("is-error");
  networkManagerBlocked.hidden = true;
  networkManagerBlocked.textContent = "";
  networkManagerFilter.value = "";
  networkManagerFilterGroup.hidden = true;
  networkManage.hidden = true;
  networkManageButton.hidden = true;
  networkManageNote.textContent = "";
}

/**
 * renders the manager's summary, its disclosed rows, and its controls
 * @returns {void} no return value
 */
function renderUnfollowManager() {
  const previouslyFocused = document.activeElement;
  const total = managerState.accounts.length;
  const filter = managerState.filter.trim().toLowerCase();
  managerState.filtered = filter
    ? managerState.accounts.filter((account) => account.login.toLowerCase().includes(filter))
    : managerState.accounts;

  const matching = managerState.filtered.length;
  const visibleCount = Math.min(
    Math.max(managerState.visibleCount, NETWORK_PAGE_SIZE),
    matching
  );
  managerState.visibleCount = visibleCount;

  networkManagerSummary.textContent =
    `${total} ${total === 1 ? "account currently appears" : "accounts currently appear"} in ` +
    `"Following who don't follow back" for @${managerState.username}.`;
  // Worth offering only once there are more accounts than one screenful, and it
  // never asks GitHub anything: it narrows the rows already retrieved.
  networkManagerFilterGroup.hidden = total <= NETWORK_PAGE_SIZE;

  renderManagerRows(visibleCount);

  if (matching === 0) {
    networkManagerEmpty.textContent = filter
      ? `No loaded account matches "${managerState.filter.trim()}".`
      : "Everyone you follow also follows you.";
    networkManagerEmpty.hidden = false;
    networkManagerStatus.hidden = true;
    networkManagerControls.hidden = true;
    return;
  }

  networkManagerEmpty.hidden = true;
  const expandable = matching > NETWORK_PAGE_SIZE;
  const fullyShown = visibleCount >= matching;
  const scope = filter ? ` matching "${managerState.filter.trim()}"` : "";

  networkManagerStatus.hidden = false;
  if (!expandable) {
    networkManagerStatus.textContent =
      `${matching} ${matching === 1 ? "account" : "accounts"}${scope}`;
  } else if (fullyShown) {
    networkManagerStatus.textContent = `Showing all ${matching}${scope}`;
  } else {
    networkManagerStatus.textContent = `Showing ${visibleCount} of ${matching}${scope}`;
  }

  networkManagerControls.hidden = !expandable;
  networkManagerMore.hidden = fullyShown;
  networkManagerAll.hidden = fullyShown;
  networkManagerCollapse.hidden = visibleCount <= NETWORK_PAGE_SIZE;
  keepManagerDisclosureFocus(previouslyFocused);
}

/**
 * moves focus only when the disclosure control the reader just used disappeared
 * @param {Element|null} previouslyFocused element focused before the controls updated
 * @returns {void} no return value
 */
function keepManagerDisclosureFocus(previouslyFocused) {
  const buttons = [networkManagerMore, networkManagerAll, networkManagerCollapse];
  if (!buttons.includes(previouslyFocused) || !previouslyFocused.hidden) return;
  const replacement = buttons.find((button) => !button.hidden);
  if (replacement) replacement.focus();
}

/**
 * renders the disclosed slice of the manager, reusing the rows already rendered
 *
 * Show 25 more appends only what it adds and Collapse removes only what it hides,
 * exactly as the Network lists do, so expanding a list of several hundred accounts
 * does not rebuild the rows the reader has already acted on.
 *
 * @param {number} visibleCount how many rows should be rendered
 * @returns {void} no return value
 */
function renderManagerRows(visibleCount) {
  const accounts = managerState.filtered;
  const reusable = managerState.renderedAccounts === accounts;
  const rendered = reusable ? managerState.renderedCount : 0;

  if (!reusable) {
    networkManagerList.replaceChildren();
    managerState.rows = new Map();
  }

  if (visibleCount > rendered) {
    const fragment = document.createDocumentFragment();
    for (let index = rendered; index < visibleCount; index += 1) {
      const account = accounts[index];
      const row = createManagerRow(account);
      managerState.rows.set(account.login.toLowerCase(), row);
      fragment.appendChild(row);
    }
    networkManagerList.appendChild(fragment);
  } else if (visibleCount < rendered) {
    for (let index = rendered; index > visibleCount; index -= 1) {
      const removed = networkManagerList.lastElementChild;
      managerState.rows.delete(removed.dataset.login);
      removed.remove();
    }
  }

  managerState.renderedAccounts = accounts;
  managerState.renderedCount = visibleCount;
  networkManagerList.hidden = visibleCount === 0;
}

/**
 * builds one account row: enough to decide, and one control that decides it
 *
 * The row carries what GitHub already returned with the relationship list — the
 * avatar, the login, and a link to the profile. It does not fetch a profile per
 * account: for a few hundred rows that would be a few hundred requests spent on
 * decoration, and the link is there for anyone who wants the real thing.
 *
 * @param {Object} account account to manage
 * @returns {HTMLLIElement} the row
 */
function createManagerRow(account) {
  const normalized = account.login.toLowerCase();
  const row = document.createElement("li");
  row.className = "manager-row";
  row.dataset.login = normalized;

  if (account.avatarUrl) {
    const avatar = document.createElement("img");
    avatar.className = "manager-avatar";
    avatar.src = account.avatarUrl;
    // Decorative: the login beside it already names the account.
    avatar.alt = "";
    avatar.width = 30;
    avatar.height = 30;
    avatar.loading = "lazy";
    row.appendChild(avatar);
  }

  const identity = document.createElement("div");
  identity.className = "manager-identity";
  const link = document.createElement("a");
  link.className = "manager-login";
  link.href = account.profileUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `View ${account.login} on GitHub`);
  link.appendChild(document.createTextNode(account.login));
  const view = document.createElement("span");
  view.className = "manager-view";
  view.textContent = "View on GitHub";
  link.appendChild(view);
  identity.appendChild(link);
  row.appendChild(identity);

  const actions = document.createElement("div");
  actions.className = "manager-actions";

  const unfollowButton = document.createElement("button");
  unfollowButton.type = "button";
  unfollowButton.className = "secondary manager-unfollow";
  unfollowButton.dataset.action = "unfollow";
  unfollowButton.textContent = "Unfollow";
  unfollowButton.setAttribute("aria-label", `Unfollow ${account.login}`);

  const confirm = document.createElement("span");
  confirm.className = "manager-confirm";
  confirm.hidden = true;
  const confirmLabel = document.createElement("span");
  confirmLabel.className = "manager-confirm-label";
  confirmLabel.textContent = `Unfollow @${account.login}?`;
  const confirmYes = document.createElement("button");
  confirmYes.type = "button";
  confirmYes.className = "secondary";
  confirmYes.dataset.action = "confirm";
  confirmYes.textContent = "Unfollow";
  confirmYes.setAttribute("aria-label", `Confirm unfollowing ${account.login}`);
  const confirmNo = document.createElement("button");
  confirmNo.type = "button";
  confirmNo.className = "secondary";
  confirmNo.dataset.action = "cancel";
  confirmNo.textContent = "Keep";
  confirmNo.setAttribute("aria-label", `Keep following ${account.login}`);
  confirm.append(confirmLabel, confirmYes, confirmNo);

  actions.append(unfollowButton, confirm);
  row.appendChild(actions);

  const outcome = document.createElement("p");
  outcome.className = "manager-outcome";
  outcome.id = `manager-outcome-${normalized}`;
  outcome.hidden = true;
  row.appendChild(outcome);

  applyManagerRowState(row, account);
  return row;
}

/**
 * paints one row to match what the manager knows about that account
 *
 * The primary button is never replaced, only relabelled, which is what keeps focus
 * still through a confirmation, a request, and its result. A reader who unfollows
 * an account is left exactly where they were rather than being thrown back to the
 * top of a list of three hundred.
 *
 * State is never carried by colour alone: every row says in words what happened.
 *
 * @param {HTMLLIElement} row the row to paint
 * @param {Object} account the account it describes
 * @returns {void} no return value
 */
function applyManagerRowState(row, account) {
  // Read before anything is hidden: the browser blurs a control the moment it
  // disappears, and by then where the reader was is already lost.
  const previouslyFocused = document.activeElement;
  const normalized = account.login.toLowerCase();
  const outcome = managerState.outcomes.get(normalized) ?? null;
  const pending = managerState.pending === normalized;
  const confirming = managerState.confirming === normalized;
  const button = row.querySelector(".manager-unfollow");
  const confirmGroup = row.querySelector(".manager-confirm");
  const outcomeText = row.querySelector(".manager-outcome");

  confirmGroup.hidden = !confirming;
  button.hidden = confirming;
  row.dataset.state = pending ? "pending" : outcome ? outcome.state : confirming ? "confirming" : "idle";
  row.toggleAttribute("aria-busy", pending);

  if (pending) {
    button.textContent = "Unfollowing…";
    button.setAttribute("aria-label", `Unfollowing ${account.login}`);
    button.setAttribute("aria-disabled", "true");
  } else if (outcome && outcome.state === "done") {
    button.textContent = outcome.label;
    button.setAttribute("aria-label", `${outcome.label}: ${account.login}`);
    button.setAttribute("aria-disabled", "true");
  } else if (managerState.blocked) {
    // The authorization is gone, so the offer is withdrawn rather than left to
    // fail. The label says why in words rather than relying on how it looks.
    button.textContent = "Unavailable";
    button.setAttribute("aria-label", `Cannot unfollow ${account.login}: ${managerState.blocked}`);
    button.setAttribute("aria-disabled", "true");
  } else {
    button.textContent = "Unfollow";
    button.setAttribute("aria-label", `Unfollow ${account.login}`);
    button.removeAttribute("aria-disabled");
  }

  const message = outcome?.message ?? "";
  outcomeText.textContent = message;
  outcomeText.hidden = !message;
  if (message) button.setAttribute("aria-describedby", outcomeText.id);
  else button.removeAttribute("aria-describedby");

  // Confirming a request collapses the confirmation the reader was standing in,
  // so focus follows to the control that replaced it. Without this, pressing
  // Enter on a confirmation drops focus to the document and a keyboard reader
  // loses their place in a list of several hundred.
  if (row.contains(previouslyFocused) && previouslyFocused.closest("[hidden]")) button.focus();
}

/**
 * withdraws every remaining offer in an open manager, saying why
 *
 * Preferred to closing the manager outright. A session that ends mid-action is
 * exactly the moment the reader most needs to see which accounts were changed and
 * which were not, and pulling the view away would take that with it.
 *
 * @param {string} reason short phrase naming what is missing
 * @returns {void} no return value
 */
function blockUnfollowManager(reason) {
  managerState.blocked = reason;
  managerState.confirming = null;
  networkManagerBlocked.textContent =
    `${reason} Nothing further can be unfollowed from here until that is resolved. ` +
    "Accounts already marked below were confirmed by GitHub before this happened.";
  networkManagerBlocked.hidden = false;
  for (const [normalized] of managerState.rows) refreshManagerRow(normalized);
}

/**
 * repaints exactly the row one account is on, leaving the rest of the list alone
 * @param {string} login account whose row changed
 * @returns {void} no return value
 */
function refreshManagerRow(login) {
  const normalized = login.toLowerCase();
  const row = managerState.rows.get(normalized);
  const account = managerState.accountsByLogin.get(normalized);
  if (row && account) applyManagerRowState(row, account);
}

/**
 * says what just happened, once, where assistive technology will read it
 * @param {string} message sentence to announce
 * @param {boolean} isError whether the sentence reports a failure
 * @returns {void} no return value
 */
function announceManager(message, isError = false) {
  networkManagerAnnouncement.textContent = message;
  networkManagerAnnouncement.classList.toggle("is-error", isError);
}

/**
 * routes a click inside the manager list to the row it happened on
 *
 * An activation of a control already marked `aria-disabled` is ignored here rather
 * than prevented by the `disabled` attribute, because a disabled button drops out
 * of the tab order and takes the reader's place in the list with it.
 *
 * @param {MouseEvent} event click within the list
 * @returns {void} no return value
 */
function handleManagerListClick(event) {
  const control = event.target.closest("button[data-action]");
  if (!control) return;
  const row = control.closest(".manager-row");
  if (!row) return;
  // GitHub's own spelling, so a message never renames the account the reader is
  // looking at and the server receives the login GitHub returned.
  const login = managerState.accountsByLogin.get(row.dataset.login)?.login;
  if (!login) return;

  if (control.dataset.action === "cancel") {
    setManagerConfirmation(login, false);
    return;
  }
  if (control.getAttribute("aria-disabled") === "true") return;
  if (control.dataset.action === "unfollow") {
    setManagerConfirmation(login, true);
    return;
  }
  if (control.dataset.action === "confirm") requestUnfollow(login);
}

/**
 * opens, cancels, or acts on the deliberate confirmation for one row
 *
 * The two-stage confirmation is the pattern this application already uses to guard
 * deleting observation history, so it is the one used here. It asks nothing to be
 * typed, costs one extra keystroke, and leaves a reader working through a long
 * list able to go Tab, Enter, Enter. A modal per account would be correct and
 * unbearable at a hundred repetitions.
 *
 * @param {string} login account being confirmed
 * @param {boolean} confirming whether the confirmation should be open
 * @returns {void} no return value
 */
function setManagerConfirmation(login, confirming) {
  const normalized = login.toLowerCase();
  const previous = managerState.confirming;
  managerState.confirming = confirming ? normalized : null;
  // Only one confirmation is open at a time, so an older one is closed rather than
  // left armed somewhere further up the list.
  if (previous && previous !== managerState.confirming) refreshManagerRow(previous);
  refreshManagerRow(normalized);

  const row = managerState.rows.get(normalized);
  if (!row) return;
  if (confirming) row.querySelector('[data-action="confirm"]').focus();
  else if (previous === normalized) row.querySelector(".manager-unfollow").focus();
}

/**
 * asks GitProfileLens to unfollow one account, and believes only GitHub's answer
 *
 * Nothing about the relationship changes here until the server has reported that
 * GitHub accepted the change. There is no optimistic removal to undo, which means
 * a failure has nothing to roll back and cannot leave the interface claiming an
 * unfollow that did not happen.
 *
 * @param {string} login account to unfollow
 * @returns {Promise<void>} no return value
 */
async function requestUnfollow(login) {
  const normalized = login.toLowerCase();
  // One request at a time for the whole manager. A second activation of the same
  // row from a double click or a held Enter key finds it already pending and does
  // nothing, and a different row waits rather than turning deliberate review into
  // a burst of writes against GitHub's content-creation limit.
  if (managerState.pending) return;
  if (managerState.blocked) return;
  if (managerState.outcomes.get(normalized)?.state === "done") return;

  managerState.pending = normalized;
  managerState.confirming = null;
  refreshManagerRow(normalized);
  announceManager(`Unfollowing @${login}…`);

  let response;
  let data = null;
  try {
    response = await fetch("/api/unfollow", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ login }),
    });
    data = await response.json().catch(() => null);
  } catch {
    finishUnfollow(login, {
      state: "failed",
      message: "GitProfileLens could not be reached, so nothing was changed. " +
        `You are still following @${login}.`,
    });
    return;
  }

  if (response.status === 401) {
    // The session is gone, so every other row is unactionable too.
    appState.authUser = null;
    appState.canManageFollows = false;
    finishUnfollow(login, {
      state: "failed",
      message: data?.error || "Your GitHub session expired. Please sign in again.",
    });
    blockUnfollowManager("Your GitHub session ended.");
    renderAuthState();
    return;
  }
  if (response.status === 403 && data?.reason === "permission_required") {
    appState.canManageFollows = false;
    finishUnfollow(login, { state: "failed", message: data.error });
    blockUnfollowManager("GitProfileLens no longer has permission to change who you follow.");
    updateManageAvailability();
    return;
  }
  if (!response.ok || !data?.state) {
    finishUnfollow(login, {
      state: "failed",
      message: data?.error || `GitHub did not confirm the change. You are still following @${login}.`,
    });
    return;
  }

  // GitHub confirmed. `already_not_following` is just as authoritative: the
  // relationship is over either way, and saying which is honest about the fact
  // that the page had gone stale rather than pretending this click did it.
  reconcileUnfollow(login);
  finishUnfollow(login, {
    state: "done",
    label: data.state === "already_not_following" ? "Not following" : "Unfollowed",
    message: data.message,
  });
}

/**
 * records one row's result, repaints it, and announces it
 * @param {string} login account the result belongs to
 * @param {Object} outcome resulting state, label, and message
 * @returns {void} no return value
 */
function finishUnfollow(login, outcome) {
  const normalized = login.toLowerCase();
  managerState.outcomes.set(normalized, outcome);
  managerState.pending = null;
  refreshManagerRow(login);
  announceManager(
    outcome.state === "done"
      ? `${outcome.message} ${countRemainingToManage()}`
      : outcome.message,
    outcome.state === "failed"
  );
}

/**
 * counts the accounts in the manager that have not yet been acted on
 * @returns {string} a sentence naming what is left
 */
function countRemainingToManage() {
  let remaining = 0;
  for (const account of managerState.accounts) {
    if (managerState.outcomes.get(account.login.toLowerCase())?.state !== "done") remaining += 1;
  }
  return `${remaining} ${remaining === 1 ? "account remains" : "accounts remain"} in this list.`;
}

/**
 * brings every derived view of the network into line with a confirmed unfollow
 *
 * This runs only after GitHub has confirmed, and it reconciles rather than
 * re-fetches: the retrieved network differs from the current one by exactly one
 * account, and spending four more GitHub requests to rediscover that would be
 * slower, would risk the unauthenticated rate limit, and would replace observation
 * history's ordering for no gain.
 *
 * Every surface moves together — the counts, both lists, the Markdown, and the
 * observation history — so no part of the page is left asserting a relationship
 * that GitProfileLens knows first-hand has ended.
 *
 * @param {string} login account GitHub confirmed is no longer followed
 * @returns {void} no return value
 */
function reconcileUnfollow(login) {
  const removal = GitProfileNetwork.withAccountRemoved(networkState.network, login);
  if (!removal.removed) return;
  networkState.network = removal.network;

  // History is told about the mutation rather than left to infer it from the next
  // retrieval, because a confirmed unfollow is stronger evidence than an
  // observation and the history would otherwise keep asserting the relationship.
  if (networkState.history.following) {
    const recorded = networkHistory.recordUnfollow({
      login: networkState.username,
      target: login,
      confirmedAt: new Date(),
    });
    if (recorded.list) networkState.history.following = recorded.list;
  }

  // One account leaves an order that already holds for everything else, so the
  // display order is filtered rather than derived again. Each of these passes is
  // linear in the list, which keeps a reader working through a hundred accounts
  // linear overall rather than quadratic.
  const target = login.toLowerCase();
  const following = networkState.ordered.following.filter(
    (account) => account.login.toLowerCase() !== target
  );
  networkState.ordered = { followers: networkState.ordered.followers, following };
  const notFollowingBack = GitProfileNetwork.deriveNotFollowingBack({
    ...removal.network,
    following: { ...removal.network.following, accounts: following },
  });
  networkState.notFollowingBack = notFollowingBack;
  networkState.markdown = GitProfileNetwork.buildMarkdown(removal.network, {
    followers: networkState.ordered.followers,
    following,
    notFollowingBack,
    orderingNote: networkOrderingNote.textContent,
  });
  networkOutput.value = networkState.markdown;
  // The Network lists are hidden behind the manager, so their DOM is rebuilt when
  // the reader goes back rather than once per unfollow.
  managerState.dirty = true;
}

/**
 * repaints the network lists and counts from the reconciled state
 * @returns {void} no return value
 */
function renderReconciledNetwork() {
  const network = networkState.network;
  if (!network) return;

  networkFollowerCount.textContent = formatNetworkCount(network.followers);
  networkFollowingCount.textContent = formatNetworkCount(network.following);
  setNetworkSectionAccounts("following", networkState.ordered.following, networkState.history.following);
  const notFollowingBack = networkState.notFollowingBack ?? [];
  networkUnreciprocatedCount.textContent = String(notFollowingBack.length);
  setNetworkSectionAccounts("unreciprocated", notFollowingBack, networkState.history.following);
  updateGlobalDisclosureControls();

  networkStatus.textContent =
    `Loaded ${network.followers.accounts.length} followers and ` +
    `${network.following.accounts.length} following for @${network.user.login}. ` +
    `${notFollowingBack.length} of those followed accounts do not follow back.`;

  const countDifference = GitProfileNetwork.describeCountDifference(network);
  networkNotice.textContent = countDifference || "";
  networkNotice.hidden = !countDifference;
}

/**
 * gives one network section its complete account list and renders the first page
 * @param {string} key section identifier
 * @param {Array<Object>} accounts complete accounts, already in display order
 * @param {Object|null} historyList observation history describing those accounts
 * @returns {void} no return value
 */
function setNetworkSectionAccounts(key, accounts, historyList) {
  const section = networkSections.find((candidate) => candidate.key === key);
  section.accounts = accounts;
  section.historyList = historyList ?? null;
  // A different list invalidates whatever is already rendered for this section.
  section.renderedAccounts = null;
  section.renderedCount = 0;
  applyNetworkDisclosure(section);
}

/**
 * renders the currently disclosed slice of one section and updates its controls
 *
 * Only the visible slice reaches the DOM, so a profile following several hundred
 * accounts still renders a small list until the reader asks for more.
 *
 * @param {Object} section network section descriptor
 * @returns {void} no return value
 */
function applyNetworkDisclosure(section) {
  // Read this before any control is hidden: the browser blurs a button the moment
  // it becomes hidden, so afterwards the reader's place is already lost.
  const previouslyFocused = document.activeElement;
  const total = section.accounts.length;
  const requested = networkState.visibleCounts[section.key] || NETWORK_PAGE_SIZE;
  const visibleCount = Math.min(Math.max(requested, NETWORK_PAGE_SIZE), total);
  networkState.visibleCounts[section.key] = visibleCount;

  renderAccountList(section, visibleCount);

  if (total === 0) {
    section.status.hidden = true;
    section.status.textContent = "";
    section.controls.hidden = true;
    return;
  }

  const expandable = total > NETWORK_PAGE_SIZE;
  const fullyShown = visibleCount >= total;

  section.status.hidden = false;
  if (!expandable) {
    section.status.textContent = `${total} ${total === 1 ? "user" : "users"}`;
  } else if (fullyShown) {
    section.status.textContent = `Showing all ${total}`;
  } else {
    section.status.textContent = `Showing ${visibleCount} of ${total}`;
  }

  section.controls.hidden = !expandable;
  section.moreButton.hidden = fullyShown;
  section.allButton.hidden = fullyShown;
  section.collapseButton.hidden = visibleCount <= NETWORK_PAGE_SIZE;
  keepDisclosureFocusInSection(section, previouslyFocused);
}

/**
 * moves focus only when the control the reader just used has disappeared
 * @param {Object} section network section descriptor
 * @param {Element|null} previouslyFocused element focused before the controls updated
 * @returns {void} no return value
 */
function keepDisclosureFocusInSection(section, previouslyFocused) {
  const buttons = [section.moreButton, section.allButton, section.collapseButton];
  if (!buttons.includes(previouslyFocused) || !previouslyFocused.hidden) return;

  const replacement = buttons.find((button) => !button.hidden);
  if (replacement) replacement.focus();
}

/**
 * expands or collapses every network section at once
 * @param {string} mode either all or collapse
 * @returns {void} no return value
 */
function setEveryNetworkSection(mode) {
  for (const section of networkSections) {
    networkState.visibleCounts[section.key] =
      mode === "all" ? section.accounts.length : NETWORK_PAGE_SIZE;
    applyNetworkDisclosure(section);
  }
}

/**
 * shows the shared expand and collapse controls only when a list is long enough
 * @returns {void} no return value
 */
function updateGlobalDisclosureControls() {
  networkDisclosureControls.hidden = !networkSections.some(
    (section) => section.accounts.length > NETWORK_PAGE_SIZE
  );
}

/**
 * builds one account pill, marking only what observation history actually knows
 *
 * A first-observation date is shown only for an account that arrived after the
 * baseline. Baseline accounts carry no date, because "first observed when history
 * started" is not evidence about them, and printing it would read as one.
 *
 * @param {Object} section network section descriptor
 * @param {Object} account retrieved account
 * @returns {HTMLLIElement} list item for the account
 */
function createAccountItem(section, account) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = account.profileUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.appendChild(document.createTextNode(account.login));

  const entry = GitProfileNetworkHistory.findEntry(section.historyList, account.login);
  if (entry && !GitProfileNetworkHistory.isBaselineAccount(section.historyList, account.login)) {
    const observed = document.createElement("span");
    observed.className = "account-observed";
    observed.textContent = `first seen ${formatShortDate(entry.firstObservedAt)}`;
    link.appendChild(observed);
    link.classList.add("is-newly-observed");
    link.title = `First observed by GitProfileLens on ${formatShortDate(entry.firstObservedAt)}. ` +
      "GitHub does not report when the follow happened.";
  }

  item.appendChild(link);
  return item;
}

/**
 * renders the disclosed slice of one section, reusing the nodes already rendered
 *
 * Show 25 more appends only the accounts it adds, and Collapse removes only the
 * accounts it hides, so expanding a long list neither rebuilds the pills already
 * on screen nor discards the reader's place in them. A full rebuild happens only
 * when the underlying list itself changed, which is the one case where the
 * existing nodes describe something that is no longer true.
 *
 * @param {Object} section network section descriptor
 * @param {number} visibleCount how many accounts should be rendered
 * @returns {void} no return value
 */
function renderAccountList(section, visibleCount) {
  const accounts = section.accounts;
  const reusable = section.renderedAccounts === accounts;
  const rendered = reusable ? section.renderedCount : 0;

  if (!reusable) section.list.replaceChildren();

  if (visibleCount > rendered) {
    // One fragment, so appending 9,975 pills costs the document one insertion.
    const fragment = document.createDocumentFragment();
    for (let index = rendered; index < visibleCount; index += 1) {
      fragment.appendChild(createAccountItem(section, accounts[index]));
    }
    section.list.appendChild(fragment);
  } else if (visibleCount < rendered) {
    for (let index = rendered; index > visibleCount; index -= 1) {
      section.list.lastElementChild.remove();
    }
  }

  section.renderedAccounts = accounts;
  section.renderedCount = visibleCount;
  section.emptyState.textContent = section.emptyMessage;
  section.emptyState.hidden = visibleCount > 0;
  section.list.hidden = visibleCount === 0;
}

/**
 * formats a relationship count, labeling partial retrievals honestly
 * @param {Object} relationship retrieved relationship list
 * @returns {string} display count
 */
function formatNetworkCount(relationship) {
  return relationship.complete
    ? String(relationship.accounts.length)
    : `${relationship.accounts.length} retrieved (incomplete)`;
}

/**
 * clears every rendered network result and disables export controls
 * @returns {void} no return value
 */
function clearNetworkPanel() {
  networkResults.hidden = true;
  networkExport.hidden = true;
  networkOutput.value = "";
  networkNotice.hidden = true;
  networkNotice.textContent = "";
  networkNotice.classList.remove("is-error");
  networkCopyButton.disabled = true;
  networkDownloadButton.disabled = true;
  networkUnreciprocatedSection.hidden = true;
  networkRetryButton.hidden = true;
  networkStatus.classList.remove("error");
  networkStatus.textContent = "";
  networkSummary.textContent = "";
  networkFollowerCount.textContent = "0";
  networkFollowingCount.textContent = "0";
  networkUnreciprocatedCount.textContent = "0";
  networkDisclosureControls.hidden = true;
  networkHistoryNote.hidden = true;
  networkHistoryNote.textContent = "";
  networkHistoryControls.hidden = true;
  networkHistoryConfirmGroup.hidden = true;
  networkHistoryResetButton.hidden = false;
  networkOrderingNote.textContent = GitProfileNetworkHistory.describeOrdering(null);
  // Management state belongs to the network that is being cleared. Switching
  // profiles, retrying, or reloading must never leave one profile's pending row,
  // error, or confirmation showing against another's accounts.
  resetUnfollowManager();

  // Disclosure is per profile: a newly loaded list never inherits "Showing 75 of …".
  networkState.visibleCounts = createInitialVisibleCounts();
  networkState.history = { followers: null, following: null, storage: null, droppedProfiles: 0 };
  networkState.ordered = { followers: [], following: [] };
  for (const section of networkSections) {
    section.accounts = [];
    section.historyList = null;
    section.renderedAccounts = null;
    section.renderedCount = 0;
    section.list.replaceChildren();
    section.status.hidden = true;
    section.status.textContent = "";
    section.controls.hidden = true;
    section.collapseButton.hidden = true;
  }
}

/**
 * displays a network error and offers an explicit retry
 * @param {string} message error message to display
 * @returns {void} no return value
 */
function showNetworkError(message) {
  networkStatus.classList.add("error");
  networkStatus.textContent = message;
  networkSummary.textContent = "";
  networkRetryButton.hidden = false;
}

/**
 * copies the generated network markdown when the export is complete
 * @returns {Promise<void>} no return value
 */
async function copyNetworkMarkdown() {
  if (!networkState.markdown) return;
  try {
    await navigator.clipboard.writeText(networkState.markdown);
    showTemporaryButtonText(networkCopyButton, "Copied");
  } catch {
    showNetworkError("Could not copy automatically. Select the Markdown and copy it manually.");
  }
}

/**
 * downloads the generated network markdown when the export is complete
 * @returns {void} no return value
 */
function downloadNetworkMarkdown() {
  if (!networkState.markdown || !networkState.network) return;
  const blob = new Blob([networkState.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = GitProfileNetwork.buildFilename(networkState.network.user.login);
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
