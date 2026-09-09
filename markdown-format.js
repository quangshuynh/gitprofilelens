(function () {
  "use strict";

  function escapeCompactMarkdown(value) {
    return String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/([`*_{}\[\]()#+.!|>])/g, "\\$1");
  }

  function formatCompactDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return date.toISOString().slice(0, 10);
  }

  function compactReadmeStatus(readme) {
    if (readme?.present === true) return "Present";
    if (readme?.present === false) return "Missing";
    return "Unverified";
  }

  function compareCompactCreationDates(repositoryA, repositoryB) {
    return new Date(repositoryB.createdAt) - new Date(repositoryA.createdAt);
  }

  function compareCompactPinnedPositions(repositoryA, repositoryB) {
    const positionA = repositoryA.pinnedPosition ?? Number.MAX_SAFE_INTEGER;
    const positionB = repositoryB.pinnedPosition ?? Number.MAX_SAFE_INTEGER;
    return positionA - positionB;
  }

  function createCompactMarkdown(username, repositories, supplemental, options = {}) {
    const sortedRepositories = [...repositories].sort(
      options.pinnedOnly ? compareCompactPinnedPositions : compareCompactCreationDates
    );
    const includePinned = options.includePinned !== false;
    const scope = options.scope || "public";
    const lines = [
      "# GitProfileLens Repository Report",
      "",
      `**GitHub:** @${escapeCompactMarkdown(username)}`,
      `**Scope:** ${escapeCompactMarkdown(scope)}`,
      `**Repositories:** ${sortedRepositories.length}`,
      "",
    ];

    if (includePinned) {
      lines.push("## Pinned repositories", "");
      const pinnedRepositories = sortedRepositories
        .filter((repository) => repository.pinned === true)
        .sort(compareCompactPinnedPositions);

      if (supplemental === null) {
        lines.push("Pinned repository data is unavailable.", "");
      } else if (pinnedRepositories.length === 0) {
        lines.push("No pinned repositories are included in this report.", "");
      } else {
        for (const repository of pinnedRepositories) {
          lines.push(`- [${escapeCompactMarkdown(repository.name)}](${repository.url}) — ${escapeCompactMarkdown(repository.description || "No description")}`);
        }
        lines.push("");
      }
    }

    lines.push("## Repositories", "");

    if (sortedRepositories.length === 0) {
      lines.push("No repositories are included in this report.", "");
      return lines.join("\n");
    }

    for (const repository of sortedRepositories) {
      lines.push(
        `### [${escapeCompactMarkdown(repository.name)}](${repository.url})`,
        "",
        escapeCompactMarkdown(repository.description || "No description"),
        ""
      );

      const metadata = [];
      if (options.includeVisibility) metadata.push(`**Visibility:** ${repository.private ? "Private" : "Public"}`);
      metadata.push(`**Language:** ${escapeCompactMarkdown(repository.language || "Not specified")}`);
      if (repository.topics?.length) metadata.push(`**Topics:** ${repository.topics.map(escapeCompactMarkdown).join(", ")}`);
      if (repository.license) metadata.push(`**License:** ${escapeCompactMarkdown(repository.license)}`);
      metadata.push(`**README:** ${compactReadmeStatus(repository.readme)}`);
      metadata.push(`**Updated:** ${formatCompactDate(repository.updatedAt)}`);
      if (includePinned) {
        metadata.push(`**Pinned:** ${repository.pinned === null ? "Unavailable" : repository.pinned ? "Yes" : "No"}`);
      }

      lines.push(metadata.join(" · "), "");
    }

    return lines.join("\n");
  }

  function initializeMarkdownFormatControl() {
    if (typeof document === "undefined") return;
    const publicOptions = document.querySelector("#public-export-options");
    const privateOptions = document.querySelector("#private-export-options");
    const exportSummaryElement = document.querySelector("#export-summary");
    const outputElement = document.querySelector("#output");
    if (!publicOptions || !privateOptions || !exportSummaryElement || !outputElement) return;

    const control = document.createElement("label");
    control.className = "export-format-control";
    control.htmlFor = "export-format";
    control.append("Format ");

    const select = document.createElement("select");
    select.id = "export-format";
    select.setAttribute("aria-label", "Markdown export format");
    select.innerHTML = '<option value="full">Full</option><option value="compact">Compact</option>';
    select.style.marginLeft = ".35rem";
    select.style.padding = ".45rem .65rem";
    select.style.borderRadius = ".5rem";
    select.style.border = "1px solid currentColor";
    select.style.background = "inherit";
    select.style.color = "inherit";
    control.appendChild(select);
    exportSummaryElement.before(control);

    const originalRefreshMarkdown = typeof refreshMarkdown === "function" ? refreshMarkdown : null;

    function syncFormatControls() {
      if (typeof includeDetailsInput !== "undefined") {
        includeDetailsInput.disabled = select.value === "compact";
        includeDetailsInput.closest("label")?.toggleAttribute("aria-disabled", select.value === "compact");
      }
    }

    function applyCompactFormat() {
      syncFormatControls();
      if (select.value !== "compact" || typeof appState === "undefined" || !appState.user) return;

      let repositories;
      let supplemental;
      let options;

      if (appState.mode === "private") {
        const scope = [...privateExportScopeInputs].find((input) => input.checked)?.value || "private";
        const labels = {
          public: "public",
          private: "authorized private",
          combined: "combined public and authorized private",
        };
        repositories = appState.privateExports[scope] || [];
        supplemental = scope === "private" ? null : appState.privateExports.publicSupplemental;
        options = {
          includePinned: scope !== "private",
          includeVisibility: true,
          scope: labels[scope],
        };
      } else {
        options = {
          pinnedOnly: pinnedOnlyInput.checked,
          selectedOnly: selectedOnlyInput.checked,
          includePinned: true,
          scope: "public",
        };
        repositories = filterRepositoriesForExport(appState.repositories, options);
        supplemental = appState.supplemental;
      }

      outputElement.value = createCompactMarkdown(
        appState.user.login,
        repositories,
        supplemental,
        options
      );
    }

    function refreshSelectedFormat() {
      syncFormatControls();
      if (originalRefreshMarkdown) originalRefreshMarkdown();
      applyCompactFormat();
    }

    select.addEventListener("change", refreshSelectedFormat);

    document.addEventListener("change", (event) => {
      if (event.target === select) return;
      if (
        event.target?.matches?.("#include-details, #pinned-only, #selected-only, [name='private-export-scope'], [data-repository]")
      ) {
        queueMicrotask(applyCompactFormat);
      }
    });

    if (originalRefreshMarkdown) {
      refreshMarkdown = function () {
        originalRefreshMarkdown();
        applyCompactFormat();
      };
    }

    syncFormatControls();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      createCompactMarkdown,
      compactReadmeStatus,
      formatCompactDate,
      escapeCompactMarkdown,
    };
  }

  if (typeof document !== "undefined") {
    initializeMarkdownFormatControl();
  }
})();
