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

  function formatCompactVisibility(repository) {
    return repository.private ? "Private" : "Public";
  }

  function formatCompactPinned(repository) {
    if (repository.private) return "No";
    if (repository.pinned === true) return "Yes";
    if (repository.pinned === false) return "No";
    return "Unavailable";
  }

  function createCompactMarkdown(username, repositories, supplemental, options = {}) {
    void username;
    void supplemental;

    const sortedRepositories = [...repositories].sort(
      options.pinnedOnly ? compareCompactPinnedPositions : compareCompactCreationDates
    );
    const lines = ["## Repositories", ""];

    if (sortedRepositories.length === 0) {
      lines.push("No repositories are included in this report.", "");
      return lines.join("\n");
    }

    for (const repository of sortedRepositories) {
      const forkLabel = repository.fork === true ? " (FORKED)" : "";
      lines.push(
        `### [${escapeCompactMarkdown(repository.name)}](${repository.url})${forkLabel}`,
        "",
        `- ${escapeCompactMarkdown(repository.description || "No description")}`
      );

      const metadata = [
        `**Visibility:** ${formatCompactVisibility(repository)}`,
        `**Language:** ${escapeCompactMarkdown(repository.language || "Not specified")}`,
      ];
      if (repository.topics?.length) {
        metadata.push(`**Topics:** ${repository.topics.map(escapeCompactMarkdown).join(", ")}`);
      }
      if (repository.license) {
        metadata.push(`**License:** ${escapeCompactMarkdown(repository.license)}`);
      }
      metadata.push(`**README:** ${compactReadmeStatus(repository.readme)}`);
      metadata.push(`**Updated:** ${formatCompactDate(repository.updatedAt)}`);
      metadata.push(`**Pinned:** ${formatCompactPinned(repository)}`);

      lines.push(`- ${metadata.join(" · ")}`, "");
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
    control.style.display = "inline-flex";
    control.style.alignItems = "center";
    control.style.gap = ".55rem";
    control.style.margin = ".25rem 0 .8rem";
    control.style.fontSize = ".88rem";
    control.style.fontWeight = "700";
    control.style.color = "#b1bac4";
    control.append("Format");

    const select = document.createElement("select");
    select.id = "export-format";
    select.setAttribute("aria-label", "Markdown export format");
    select.innerHTML = '<option value="full">Full</option><option value="compact">Compact</option>';
    select.style.minWidth = "118px";
    select.style.padding = ".55rem 2rem .55rem .75rem";
    select.style.border = "1px solid #30363d";
    select.style.borderRadius = "8px";
    select.style.background = "#21262d";
    select.style.color = "#f0f6fc";
    select.style.font = "inherit";
    select.style.fontWeight = "700";
    select.style.cursor = "pointer";
    select.style.boxShadow = "0 2px 8px rgba(0,0,0,.18)";
    select.style.outline = "none";
    select.addEventListener("focus", () => {
      select.style.borderColor = "#58a6ff";
      select.style.boxShadow = "0 0 0 2px rgba(88,166,255,.25)";
    });
    select.addEventListener("blur", () => {
      select.style.borderColor = "#30363d";
      select.style.boxShadow = "0 2px 8px rgba(0,0,0,.18)";
    });
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
        repositories = appState.privateExports[scope] || [];
        supplemental = scope === "private" ? null : appState.privateExports.publicSupplemental;
        options = { includePinned: true };
      } else {
        options = {
          pinnedOnly: pinnedOnlyInput.checked,
          selectedOnly: selectedOnlyInput.checked,
          includePinned: true,
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
      formatCompactVisibility,
      formatCompactPinned,
    };
  }

  if (typeof document !== "undefined") {
    initializeMarkdownFormatControl();
  }
})();
