/**
 * initializes the audit module for browsers and node tests
 * @param {Object} root global object receiving the browser module
 * @param {Function} factory function that creates the audit api
 * @returns {void} no return value
 */
(function initializeAuditModule(root, factory) {
  const auditModule = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = auditModule;
  }

  root.GitHubAudit = auditModule;
})(
  typeof globalThis !== "undefined" ? globalThis : window,
  /**
   * creates the deterministic github audit api
   * @returns {Object} public scoring and transformation functions
   */
  function createAuditModule() {
  const DAY_IN_MILLISECONDS = 86400000;
  const GENERIC_NAME_PATTERN = /^(test|testing|project|repo|repository|demo|sample|hello[-_]?world)([-_]?\d*)?$/i;
  const CLUTTER_NAME_PATTERN = /(tutorial|practice|course|homework|assignment|lab[-_]?\d*|test[-_]?\d*)/i;
  const VAGUE_DESCRIPTION_PATTERN = /^(a |an )?(python|java|javascript|typescript|react|web|school|class)?\s*(app|application|project|website|program|repo|repository|tool)$/i;

  /**
   * limits a numeric score to the inclusive range from zero to one hundred
   * @param {number} score score to limit
   * @returns {number} rounded score between zero and one hundred
   */
  function clampScore(score) {
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * calculates the average of a list of numeric values
   * @param {Array<number>} values values to average
   * @returns {number} rounded average or zero for an empty list
   */
  function average(values) {
    if (values.length === 0) return 0;
    return Math.round(values.reduce(sumNumbers, 0) / values.length);
  }

  /**
   * adds two numbers for array reduction
   * @param {number} total running total
   * @param {number} value value to add
   * @returns {number} updated total
   */
  function sumNumbers(total, value) {
    return total + value;
  }

  /**
   * creates a structured audit finding
   * @param {string} category scoring category associated with the finding
   * @param {string} severity priority level for the finding
   * @param {string} reason explanation of the detected condition
   * @param {string} action suggested action for addressing the condition
   * @param {boolean} factual whether the finding is a factual check
   * @returns {Object} structured audit finding
   */
  function createFinding(category, severity, reason, action, factual) {
    return { category, severity, reason, action, factual };
  }

  /**
   * scores the clarity and completeness of a repository description
   * @param {string|null} description github repository description
   * @returns {{score: number, findings: Array<Object>}} description score and findings
   */
  function scoreDescription(description) {
    const value = (description || "").trim();
    const findings = [];
    let score = 100;

    if (!value) {
      findings.push(createFinding("Descriptions", "high", "Description is missing.", "Add one sentence stating what the project does, its audience, and a distinguishing technology or outcome.", true));
      return { score: 0, findings };
    }

    if (/^(test|testing|todo|tbd|wip|sample|demo)$/i.test(value)) {
      score -= 55;
      findings.push(createFinding("Descriptions", "high", "Description is placeholder text.", "Replace it with the project's purpose and key capability.", true));
    } else if (VAGUE_DESCRIPTION_PATTERN.test(value)) {
      score -= 35;
      findings.push(createFinding("Descriptions", "high", "Description is too generic to distinguish the project.", "Add the problem solved, key behavior, and relevant stack instead of only naming the project type.", false));
    }

    if (value.length < 30) {
      score -= 25;
      findings.push(createFinding("Descriptions", "medium", `Description is only ${value.length} characters.`, "Add concrete context so the purpose is clear without opening the repository.", true));
    }

    if (value.length > 160) {
      score -= 15;
      findings.push(createFinding("Descriptions", "low", `Description is ${value.length} characters and difficult to scan.`, "Condense it to one focused sentence of 160 characters or fewer.", true));
    }

    if (/^\s*\((wip|broken|deprecated|archived)\)/i.test(value)) {
      score -= 15;
      findings.push(createFinding("Descriptions", "medium", "Description begins with a temporary status label.", "Use GitHub archive settings or topics for status and reserve the description for project purpose.", true));
    }

    if (/^[a-z]/.test(value)) {
      score -= 5;
      findings.push(createFinding("Descriptions", "low", "Description begins with a lowercase letter.", "Start the description with a capital letter for a more polished presentation.", true));
    }

    return { score: clampScore(score), findings };
  }

  /**
   * scores repository name clarity and consistency
   * @param {string} name github repository name
   * @returns {{score: number, findings: Array<Object>}} name score and findings
   */
  function scoreName(name) {
    const findings = [];
    let score = 100;

    if (name.length > 50) {
      score -= 20;
      findings.push(createFinding("Repository presentation", "medium", "Repository name exceeds 50 characters.", "Shorten the name so it is easier to scan, remember, and type.", true));
    }

    if (/_/.test(name)) {
      score -= 10;
      findings.push(createFinding("Repository presentation", "low", "Repository name uses underscores.", "Consider lowercase kebab-case for consistent readability.", true));
    }

    if (/[A-Z]/.test(name)) {
      score -= 5;
      findings.push(createFinding("Repository presentation", "low", "Repository name contains uppercase letters.", "Consider lowercase kebab-case for consistency across the portfolio.", true));
    }

    if (GENERIC_NAME_PATTERN.test(name)) {
      score -= 40;
      findings.push(createFinding("Repository presentation", "high", "Repository name is too generic to communicate its purpose.", "Choose a short, distinctive name related to what the project does.", false));
    }

    if (CLUTTER_NAME_PATTERN.test(name)) {
      score -= 15;
      findings.push(createFinding("Portfolio focus", "low", "Name suggests a tutorial, class, or test repository.", "If this is no longer representative work, consider archiving it or keeping it unpinned.", false));
    }

    return { score: clampScore(score), findings };
  }

  /**
   * scores repository readme quality using available metadata
   * @param {{present: boolean|null, size: number|null}} readme readme metadata
   * @returns {{score: number, findings: Array<Object>}} readme score and findings
   */
  function scoreReadme(readme) {
    const findings = [];

    if (!readme || readme.present === null) {
      findings.push(createFinding("README quality", "info", "README status could not be verified.", "Configure the serverless GitHub integration to include README checks.", true));
      return { score: 60, findings };
    }

    if (!readme.present) {
      findings.push(createFinding("README quality", "high", "Repository has no root README.", "Add a README explaining the problem, setup, usage, and important implementation decisions.", true));
      return { score: 10, findings };
    }

    if (readme.size !== null && readme.size < 500) {
      findings.push(createFinding("README quality", "medium", `README is only ${readme.size} bytes.`, "Expand it with purpose, setup, usage, and a screenshot or example where useful.", true));
      return { score: 55, findings };
    }

    // Older deployments only expose byte size, so preserve their established score.
    if (!readme.sections) return { score: 100, findings };

    let score = 35;
    const sections = readme.sections;
    const coreSections = [sections.overview, sections.installation, sections.usage];
    score += coreSections.filter(Boolean).length * 15;
    score += sections.examples ? 10 : 0;
    score += sections.contributing ? 5 : 0;
    score += readme.hasCodeBlock ? 5 : 0;
    score += readme.hasImage ? 5 : 0;
    score += readme.headingCount >= 3 ? 5 : 0;

    const missingCore = [
      ["overview", sections.overview],
      ["installation or setup", sections.installation],
      ["usage", sections.usage],
    ].filter((entry) => !entry[1]).map((entry) => entry[0]);

    if (missingCore.length > 0) {
      findings.push(createFinding(
        "README quality",
        missingCore.length >= 2 ? "medium" : "low",
        `README is missing clear ${missingCore.join(", ")} guidance.`,
        "Add clearly labeled sections so visitors can understand, install, and use the project quickly.",
        true
      ));
    }
    if (!sections.examples && !readme.hasImage) {
      findings.push(createFinding("README quality", "low", "README has no detected example, demo, screenshot, or image.", "Show the project in action with a concise example, screenshot, or demo section.", true));
    }

    return { score: clampScore(score), findings };
  }

  /**
   * scores repository discoverability metadata
   * @param {Object} repository normalized repository data
   * @returns {{score: number, findings: Array<Object>}} discoverability score and findings
   */
  function scoreDiscoverability(repository) {
    const findings = [];
    let score = 100;

    if (repository.topics.length === 0) {
      score -= 40;
      findings.push(createFinding("Discoverability", "medium", "Repository has no topics.", "Add three to five specific topics covering the project domain, stack, and use case.", true));
    }

    if (!repository.license) {
      score -= 25;
      findings.push(createFinding("Discoverability", "medium", "Repository has no detected license.", "Add an appropriate license if you intend others to use or contribute to the project.", true));
    }

    if (!repository.homepage && !repository.archived && /^(HTML|CSS|JavaScript|TypeScript|Vue|Svelte)$/i.test(repository.language || "")) {
      score -= 15;
      findings.push(createFinding("Discoverability", "low", "Web project has no homepage or demo URL.", "Add a live demo URL when the project is deployable.", false));
    }

    return { score: clampScore(score), findings };
  }

  /**
   * scores repository maintenance signals
   * @param {Object} repository normalized repository data
   * @param {Date} now current date used for deterministic age calculation
   * @returns {{score: number, findings: Array<Object>}} maintenance score and findings
   */
  function scoreMaintenance(repository, now) {
    const findings = [];

    if (repository.archived) {
      return { score: 85, findings };
    }

    const updatedAt = new Date(repository.pushedAt || repository.updatedAt);
    const ageInDays = Math.floor((now - updatedAt) / DAY_IN_MILLISECONDS);

    if (!Number.isFinite(ageInDays)) {
      findings.push(createFinding("Project maintenance", "info", "Maintenance date could not be determined.", "Check that the repository exposes a valid update timestamp.", true));
      return { score: 60, findings };
    }

    if (ageInDays > 1095) {
      findings.push(createFinding("Project maintenance", "medium", `Repository has not been pushed to in ${Math.floor(ageInDays / 365)} years.`, "Update it, clearly mark it complete, or archive it if it is no longer maintained.", true));
      return { score: 35, findings };
    }

    if (ageInDays > 730) {
      findings.push(createFinding("Project maintenance", "low", "Repository has not been pushed to in more than two years.", "Review whether it still represents the work you want visitors to see.", true));
      return { score: 65, findings };
    }

    if (ageInDays > 365) {
      return { score: 85, findings };
    }

    return { score: 100, findings };
  }

  /**
   * normalizes github repository and supplemental metadata for scoring and rendering
   * @param {Object} repository github rest repository response
   * @param {Object|null} supplemental supplemental readme and pin metadata
   * @returns {Object} normalized repository data
   */
  function transformRepository(repository, supplemental) {
    const readme = supplemental?.readmes?.[repository.name] || { present: null, size: null };
    const pinnedRepositories = supplemental?.pinnedRepositories || [];
    const pinnedPosition = pinnedRepositories.indexOf(repository.name);

    return {
      raw: repository,
      name: repository.name,
      fullName: repository.full_name,
      description: repository.description,
      url: repository.html_url,
      homepage: repository.homepage || null,
      language: repository.language || null,
      topics: Array.isArray(repository.topics) ? repository.topics : [],
      license: repository.license?.spdx_id || null,
      stars: repository.stargazers_count || 0,
      forks: repository.forks_count || 0,
      openIssues: repository.open_issues_count || 0,
      archived: Boolean(repository.archived),
      fork: Boolean(repository.fork),
      private: Boolean(repository.private),
      visibility: repository.visibility || (repository.private ? "private" : "public"),
      createdAt: repository.created_at,
      updatedAt: repository.updated_at,
      pushedAt: repository.pushed_at,
      pinned: supplemental === null ? null : pinnedPosition >= 0,
      pinnedPosition: pinnedPosition >= 0 ? pinnedPosition : null,
      readme,
      selected: true,
    };
  }

  function formatReadmeStatus(readme) {
    if (!readme || readme.present === null) return "unverified";
    if (!readme.present) return "missing";
    if (readme.size !== null && readme.size < 500) return "short";
    if (readme.sections) {
      const coreCount = [readme.sections.overview, readme.sections.installation, readme.sections.usage].filter(Boolean).length;
      if (coreCount < 2) return "needs_structure";
      if (coreCount === 3 && (readme.sections.examples || readme.hasImage)) return "comprehensive";
    }
    return "present";
  }

  function createReport(username, repositories) {
    return {
      username,
      public_repositories: repositories.length,
      pinned_repositories: repositories
        .filter((repository) => repository.pinned === true)
        .sort((repositoryA, repositoryB) =>
          (repositoryA.pinnedPosition ?? Number.MAX_SAFE_INTEGER)
          - (repositoryB.pinnedPosition ?? Number.MAX_SAFE_INTEGER)
        )
        .map((repository) => repository.name),
      repositories: repositories.map((repository) => ({
        name: repository.name,
        description: repository.description || null,
        url: repository.url,
        pinned: repository.pinned === true,
        created_at: repository.createdAt,
        updated_at: repository.updatedAt,
        pushed_at: repository.pushedAt,
        primary_language: repository.language || null,
        license: repository.license || null,
        topics: repository.topics,
        stars: repository.stars,
        forks: repository.forks,
        open_issues: repository.openIssues,
        readme_status: formatReadmeStatus(repository.readme),
        archived: repository.archived,
        forked: repository.fork,
      })),
    };
  }

  /**
   * calculates a repository presentation and discoverability audit
   * @param {Object} repository normalized repository data
   * @param {Date} now current date used for maintenance scoring
   * @returns {Object} complete repository audit
   */
  function scoreRepository(repository, now = new Date()) {
    const name = scoreName(repository.name);
    const description = scoreDescription(repository.description);
    const readme = scoreReadme(repository.readme);
    const discoverability = scoreDiscoverability(repository);
    const maintenance = scoreMaintenance(repository, now);
    const findings = [
      ...name.findings,
      ...description.findings,
      ...readme.findings,
      ...discoverability.findings,
      ...maintenance.findings,
    ];
    const score = clampScore(
      name.score * 0.15 +
      description.score * 0.25 +
      readme.score * 0.25 +
      discoverability.score * 0.2 +
      maintenance.score * 0.15
    );

    return {
      repository,
      score,
      categoryScores: {
        presentation: name.score,
        descriptions: description.score,
        readme: readme.score,
        discoverability: discoverability.score,
        maintenance: maintenance.score,
      },
      findings,
    };
  }

  /**
   * scores how clearly a portfolio emphasizes a coherent set of projects
   * @param {Array<Object>} repositories normalized repositories
   * @returns {number} portfolio focus score
   */
  function scorePortfolioFocus(repositories) {
    if (repositories.length === 0) return 0;
    const active = repositories.filter(isActiveRepository);
    const languageCounts = new Map();

    for (const repository of active) {
      if (!repository.language) continue;
      languageCounts.set(repository.language, (languageCounts.get(repository.language) || 0) + 1);
    }

    const largestLanguageGroup = Math.max(0, ...languageCounts.values());
    const concentration = active.length > 0 ? largestLanguageGroup / active.length : 0;
    const archivedOrForked = repositories.length - active.length;
    const curationBonus = Math.min(15, archivedOrForked * 2);
    return clampScore(55 + concentration * 30 + curationBonus);
  }

  /**
   * determines whether a repository is active portfolio work
   * @param {Object} repository normalized repository data
   * @returns {boolean} true when the repository is neither archived nor forked
   */
  function isActiveRepository(repository) {
    return !repository.archived && !repository.fork;
  }

  /**
   * calculates portfolio category scores and an overall presentation score
   * @param {Array<Object>} audits repository audits
   * @returns {Object} overall and category portfolio scores
   */
  function scoreProfile(audits) {
    if (audits.length === 0) {
      return {
        overall: 0,
        categories: { presentation: 0, descriptions: 0, readme: 0, discoverability: 0, maintenance: 0, focus: 0 },
      };
    }

    const repositories = audits.map(getAuditedRepository);
    const categories = {
      presentation: average(audits.map(getPresentationScore)),
      descriptions: average(audits.map(getDescriptionScore)),
      readme: average(audits.map(getReadmeScore)),
      discoverability: average(audits.map(getDiscoverabilityScore)),
      maintenance: average(audits.map(getMaintenanceScore)),
      focus: scorePortfolioFocus(repositories),
    };
    const overall = clampScore(
      categories.presentation * 0.15 +
      categories.descriptions * 0.2 +
      categories.readme * 0.2 +
      categories.discoverability * 0.2 +
      categories.maintenance * 0.15 +
      categories.focus * 0.1
    );

    return { overall, categories };
  }

  /**
   * gets the repository from a repository audit
   * @param {Object} audit repository audit
   * @returns {Object} normalized repository
   */
  function getAuditedRepository(audit) { return audit.repository; }

  /**
   * gets the presentation score from a repository audit
   * @param {Object} audit repository audit
   * @returns {number} presentation score
   */
  function getPresentationScore(audit) { return audit.categoryScores.presentation; }

  /**
   * gets the description score from a repository audit
   * @param {Object} audit repository audit
   * @returns {number} description score
   */
  function getDescriptionScore(audit) { return audit.categoryScores.descriptions; }

  /**
   * gets the readme score from a repository audit
   * @param {Object} audit repository audit
   * @returns {number} readme score
   */
  function getReadmeScore(audit) { return audit.categoryScores.readme; }

  /**
   * gets the discoverability score from a repository audit
   * @param {Object} audit repository audit
   * @returns {number} discoverability score
   */
  function getDiscoverabilityScore(audit) { return audit.categoryScores.discoverability; }

  /**
   * gets the maintenance score from a repository audit
   * @param {Object} audit repository audit
   * @returns {number} maintenance score
   */
  function getMaintenanceScore(audit) { return audit.categoryScores.maintenance; }

  /**
   * generates ranked portfolio-level recommendations from repository audits
   * @param {Array<Object>} audits repository audits
   * @returns {Array<Object>} highest-impact recommendations
   */
  function generateRecommendations(audits) {
    const groups = new Map();

    for (const audit of audits) {
      for (const finding of audit.findings) {
        if (finding.severity === "info") continue;
        const key = `${finding.category}|${finding.action}`;
        const group = groups.get(key) || { ...finding, repositories: [] };
        group.repositories.push(audit.repository.name);
        groups.set(key, group);
      }
    }

    const recommendations = [...groups.values()];
    addPinningRecommendations(recommendations, audits);
    recommendations.sort(compareRecommendations);
    return recommendations.slice(0, 5);
  }

  /**
   * adds portfolio curation advice when pinned metadata is available
   * @param {Array<Object>} recommendations recommendations receiving pin advice
   * @param {Array<Object>} audits repository audits
   * @returns {void} no return value
   */
  function addPinningRecommendations(recommendations, audits) {
    const pinnedAudits = audits.filter(isPinnedAudit);
    const weakPinnedAudits = pinnedAudits.filter(isWeakAudit);
    const strongUnpinnedAudits = audits
      .filter(isStrongUnpinnedAudit)
      .sort(compareAuditScoresDescending)
      .slice(0, 3);

    if (weakPinnedAudits.length > 0) {
      recommendations.push({
        category: "Portfolio focus",
        severity: "high",
        reason: "One or more pinned repositories have weak presentation scores.",
        action: "Improve or unpin these repositories so pinned work represents the strongest public projects.",
        factual: false,
        repositories: weakPinnedAudits.map(getAuditRepositoryName),
      });
    }

    if (pinnedAudits.length < 6 && strongUnpinnedAudits.length > 0) {
      recommendations.push({
        category: "Portfolio focus",
        severity: "medium",
        reason: "Strong repository candidates are not currently pinned.",
        action: "Consider pinning these projects if they represent the work you want visitors to notice first.",
        factual: false,
        repositories: strongUnpinnedAudits.map(getAuditRepositoryName),
      });
    }
  }

  /**
   * determines whether an audit belongs to a pinned repository
   * @param {Object} audit repository audit
   * @returns {boolean} true when pinned
   */
  function isPinnedAudit(audit) { return audit.repository.pinned === true; }

  /**
   * determines whether a repository audit has a weak score
   * @param {Object} audit repository audit
   * @returns {boolean} true when the score is below sixty
   */
  function isWeakAudit(audit) { return audit.score < 60; }

  /**
   * determines whether an audit is strong, unpinned, and has verified pin data
   * @param {Object} audit repository audit
   * @returns {boolean} true when the repository is a pin candidate
   */
  function isStrongUnpinnedAudit(audit) {
    return audit.repository.pinned === false && audit.score >= 85 && !audit.repository.archived;
  }

  /**
   * compares repository audits from highest score to lowest
   * @param {Object} auditA first repository audit
   * @param {Object} auditB second repository audit
   * @returns {number} audit sort order
   */
  function compareAuditScoresDescending(auditA, auditB) { return auditB.score - auditA.score; }

  /**
   * gets a repository name from an audit
   * @param {Object} audit repository audit
   * @returns {string} repository name
   */
  function getAuditRepositoryName(audit) { return audit.repository.name; }

  /**
   * compares recommendations by severity and affected repository count
   * @param {Object} recommendationA first recommendation
   * @param {Object} recommendationB second recommendation
   * @returns {number} recommendation sort order
   */
  function compareRecommendations(recommendationA, recommendationB) {
    const weights = { high: 3, medium: 2, low: 1, info: 0 };
    const impactA = weights[recommendationA.severity] * 100 + recommendationA.repositories.length;
    const impactB = weights[recommendationB.severity] * 100 + recommendationB.repositories.length;
    return impactB - impactA;
  }

  /**
   * reads and validates a github username from a query string
   * @param {string} search url query string
   * @returns {string|null} valid username or null
   */
  function parseUsernameFromSearch(search) {
    const username = new URLSearchParams(search).get("user")?.trim() || "";
    return isValidUsername(username) ? username : null;
  }

  function isValidUsername(username) {
    return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username);
  }

  return {
    createReport,
    formatReadmeStatus,
    generateRecommendations,
    isValidUsername,
    parseUsernameFromSearch,
    scoreDescription,
    scoreDiscoverability,
    scoreMaintenance,
    scoreName,
    scorePortfolioFocus,
    scoreProfile,
    scoreReadme,
    scoreRepository,
    transformRepository,
  };
  }
);
