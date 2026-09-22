/**
 * initializes the pinned repository optimizer for browsers and node tests
 * @param {Object} root global object receiving the browser module
 * @param {Function} factory function that creates the optimizer api
 * @returns {void} no return value
 */
(function initializePinnedOptimizerModule(root, factory) {
  const auditModule = typeof require === "function" ? require("./audit.js") : root.GitHubAudit;
  const optimizerModule = factory(auditModule);

  if (typeof module === "object" && module.exports) {
    module.exports = optimizerModule;
  }

  root.GitProfilePinnedOptimizer = optimizerModule;
})(
  typeof globalThis !== "undefined" ? globalThis : window,
  /**
   * creates the deterministic pinned repository optimizer
   *
   * The optimizer answers a set question, not another repository question. The
   * repository score asks how well one repository presents itself, portfolio
   * candidacy asks whether one repository is worth featuring, and the optimizer
   * asks which combination of repositories forms the strongest set a visitor
   * would see first. It reads finished audits and changes none of them.
   *
   * @param {Object} audit shared audit module supplying candidacy evidence phrasing
   * @returns {Object} optimizer api
   */
  function createPinnedOptimizerModule(audit) {
  /**
   * GitHub's documented pinned-item limit.
   *
   * "Select up to six repositories and gists, combined." — GitHub profile
   * documentation for pinning items to a profile. The product already encodes the
   * same invariant in `api/github-metadata.js` (`pinnedItems(first: 6)`), in the
   * pin advice in `audit.js`, and in the corpus fixture builder. The optimizer
   * recommends *up to* this many repositories and never pads the set to reach it.
   */
  const MAXIMUM_PINNED_REPOSITORIES = 6;

  /** Advisory actions used when comparing the current pins with the recommendation. */
  const ACTIONS = {
    keep: "Keep",
    polish: "Polish first",
    add: "Consider adding",
    replace: "Consider replacing",
  };

  /** Why an audited repository cannot enter the recommended public set. */
  const EXCLUSION_REASONS = {
    deemphasize: "Classified De-emphasize, which is not recommended for prominent placement.",
    highFindings: "Worth polishing, but a high-priority presentation finding is still open.",
    unreadable: "No verified description or README content a visitor could read before opening it.",
    private: "Private, so it cannot be featured on a public GitHub profile.",
  };

  /**
   * Originality preference, lower is preferred.
   *
   * Confirmed original work is preferred for a portfolio set. An unreported fork
   * status sits between the two: the tool will not record it as confirmed original
   * work, and it will not treat it as a confirmed fork either.
   */
  const ORIGINALITY_RANK = { original: 0, unknown: 1, fork: 2 };

  /**
   * How many shared topics mark two repositories as telling a similar story.
   *
   * GitHub topics are author-chosen keywords rather than a taxonomy, so a single
   * shared topic such as `python` says very little. Two or more is the
   * conservative reading the product is willing to act on.
   */
  const SHARED_TOPIC_THRESHOLD = 2;

  /**
   * How close two presentation scores must be for breadth to choose between them.
   *
   * Breadth is a tie-breaker: it decides which of two comparably well presented
   * repositories to feature, not whether presentation evidence matters. Outside
   * this band the two are not comparable, so the stronger presentation evidence
   * decides and breadth abstains.
   *
   * The band exists because the alternative has no upper bound. With breadth
   * ranked ahead of presentation score unconditionally, a repository could enter
   * the set over one scoring arbitrarily higher purely for reporting a different
   * primary language, which is not a claim about portfolio quality that
   * GitProfileLens can support from what it observes.
   *
   * Five points is the middle of the range the evidence leaves open. Across the
   * evaluation corpus every band from 2 to 9 produces identical sets, and on a
   * 32-repository profile with a deep Strong pool, bands of 3 to 6 keep four
   * distinct languages in the set while cutting the largest score a breadth
   * decision overrides from 7 points to 3. Tighter bands collapse that profile to
   * a two-language set, which defeats the purpose of measuring breadth at all;
   * wider bands restore the unbounded overrides the band exists to prevent.
   */
  const COMPARABLE_SCORE_BAND = 5;

  /**
   * How close two presentation scores must be for candidacy to choose between them.
   *
   * Candidacy answers a different question from the presentation score, and for
   * two of its nine gates it answers it from evidence the score does not read at
   * all: fork status and archive status. Those two keep deciding without any
   * band, because stages 2 and 3 apply them directly.
   *
   * The other seven gates read evidence the score already reads — README state,
   * description score, topics, maintenance score, high findings, medium findings,
   * and the score itself. A repository that fails one of them has already been
   * charged for it once, in its score. Ranking candidacy ahead of score without a
   * band charges it a second time, with no ceiling on the second charge.
   *
   * The ceiling was measured rather than assumed. Searching the reachable input
   * space, the lowest score a Strong candidate can reach is 79 and the highest a
   * Worth polishing repository can reach while failing only score-visible gates is
   * 95. So the unbanded rule allowed a 16-point override: a repository presenting
   * at 79 could precede one presenting at 95 because the latter's README carried
   * one core section fewer than the gate wants. 5,764 of the 6,912 Strong shapes
   * in that search sit below that ceiling, so this is not a rare corner.
   *
   * Five points is the same band breadth uses, so the optimizer has one notion of
   * "comparable presentation" rather than two. It is also at or above the largest
   * inversion actually observed: 5 points across the evaluation corpus, 3 on a
   * live 33-repository profile. Within the band, candidacy still decides, which is
   * the case its evidence was meant for. Outside it, the presentation gap is wide
   * enough that the score speaks for itself.
   *
   * Applying it changes no recommendation on any profile measured, on the corpus
   * or live. It bounds a structural override rather than moving a set.
   */
  const CANDIDACY_SCORE_BAND = 5;

  /**
   * reports the maximum number of repositories a GitHub profile can pin
   * @returns {number} GitHub's documented pinned-item limit
   */
  function getPinnedLimit() {
    return MAXIMUM_PINNED_REPOSITORIES;
  }

  /**
   * decides whether a repository carries something a visitor can read before opening it
   *
   * This is an evidence floor, not a quality penalty. A usable description or a
   * README verified to exist satisfies it. An unverified README never fails it on
   * its own, because unknown evidence is not absence; what unknown evidence does
   * do is prevent the affirmative claim that this repository is ready to lead a
   * profile, which is exactly what a pin recommendation asserts.
   *
   * @param {Object} evidence candidacy evidence from the audit
   * @returns {boolean} true when at least one readable presentation signal was verified
   */
  function hasReadableEvidence(evidence) {
    return evidence.description >= 70
      || evidence.readmeState === "present"
      || evidence.readmeState === "comprehensive";
  }

  /**
   * partitions one audit into the optimizer's eligibility classes
   *
   * Eligibility is decided from candidacy and fact, never from the presentation
   * score. A repository is not eligible merely because it scored well.
   *
   * @param {Object} repositoryAudit repository audit carrying its candidacy
   * @returns {{eligible: boolean, reason: string|null}} eligibility outcome
   */
  function classifyEligibility(repositoryAudit) {
    const candidate = repositoryAudit.candidate;
    const evidence = candidate.evidence;

    // Ordered from the most specific statement to the most general, so a
    // repository is reported under the reason that explains the most about it.
    if (candidate.label === "deemphasize") return { eligible: false, reason: "deemphasize" };
    if (!hasReadableEvidence(evidence)) return { eligible: false, reason: "unreadable" };
    if (candidate.label === "polish" && evidence.highFindings > 0) {
      return { eligible: false, reason: "highFindings" };
    }
    if (evidence.private) return { eligible: false, reason: "private" };
    return { eligible: true, reason: null };
  }

  /**
   * counts the verified presentation metadata a repository carries
   * @param {Object} evidence candidacy evidence
   * @returns {number} number of verified presentation signals
   */
  function countMetadata(evidence) {
    return [
      evidence.topics > 0,
      Boolean(evidence.license),
      evidence.homepage,
      evidence.readmeState === "comprehensive",
      evidence.description === 100,
    ].filter(Boolean).length;
  }

  /**
   * builds the fixed, set-independent facts the optimizer ranks a repository by
   * @param {Object} repositoryAudit repository audit
   * @returns {Object} optimizer candidate
   */
  function createCandidate(repositoryAudit) {
    const repository = repositoryAudit.repository;
    const candidate = repositoryAudit.candidate;
    const evidence = candidate.evidence;

    return {
      audit: repositoryAudit,
      name: repository.name,
      url: repository.url,
      language: repository.language,
      topics: repository.topics,
      homepage: Boolean(repository.homepage),
      label: candidate.label,
      title: candidate.title,
      qualifier: candidate.qualifier,
      score: repositoryAudit.score,
      // Tier is the one hard ordering constraint: every Strong candidate is
      // considered before any Worth polishing repository.
      tier: candidate.label === "strong" ? 0 : 1,
      originality: evidence.originality,
      originalityRank: ORIGINALITY_RANK[evidence.originality],
      archived: evidence.archived,
      archivedRank: evidence.archived ? 1 : 0,
      maintenance: evidence.maintenance,
      maintenanceUnknown: evidence.maintenanceUnknown,
      metadataCount: countMetadata(evidence),
      gaps: audit.describeCandidateGaps(evidence),
      evidence,
    };
  }

  /**
   * measures how much a candidate repeats what the selected set already shows
   *
   * Only observable, structured signals are compared. GitProfileLens has no
   * reliable project or domain categories, so none are invented here: the set
   * reasons about primary language and topic overlap, both of which GitHub
   * reports directly.
   *
   * Breadth is a credit earned by verified distinctness, never by absent data. A
   * repository whose primary language GitHub did not report, and one with no
   * topics at all, earn no breadth credit, because neither can demonstrate that
   * it widens the set. That is the same rule candidacy applies: unknown evidence
   * cannot support an affirmative claim. It is not a penalty either — an unknown
   * signal scores exactly as a repeated one, never worse.
   *
   * @param {Object} candidate optimizer candidate under consideration
   * @param {Array<Object>} selected repositories already in the set
   * @returns {Object} redundancy measurement and the evidence behind it
   */
  function measureRedundancy(candidate, selected) {
    const languageMatch = candidate.language
      ? selected.find((entry) => entry.language === candidate.language) || null
      : null;
    const topicMatch = findTopicOverlap(candidate, selected);
    const addsLanguage = Boolean(candidate.language) && languageMatch === null;
    const addsTopics = candidate.topics.length > 0 && topicMatch === null;

    return {
      addsLanguage,
      addsTopics,
      // Lower is less redundant. Two earned credits, so the value is 0, 1, or 2.
      total: (addsLanguage ? 0 : 1) + (addsTopics ? 0 : 1),
      languageMatch,
      topicMatch,
    };
  }

  /**
   * finds the first selected repository sharing enough topics to read as the same story
   * @param {Object} candidate optimizer candidate under consideration
   * @param {Array<Object>} selected repositories already in the set
   * @returns {Object|null} overlapping repository and the shared topics
   */
  function findTopicOverlap(candidate, selected) {
    for (const entry of selected) {
      const shared = candidate.topics.filter((topic) => entry.topics.includes(topic));
      if (shared.length >= SHARED_TOPIC_THRESHOLD) return { repository: entry, shared };
    }
    return null;
  }

  /**
   * orders two candidates against the set already selected
   *
   * The comparison is lexicographic rather than a weighted utility score, so every
   * decision can be read off one named rule instead of a number whose components
   * cannot be recovered. The order encodes the product's stated preferences:
   *
   * 1. candidacy tier, so a Strong candidate always precedes a Worth polishing one;
   * 2. originality, so confirmed original work precedes unreported fork status,
   *    which precedes a confirmed fork;
   * 3. archive status, so an active repository precedes a retired one;
   * 4. redundancy, but only between repositories whose presentation scores sit
   *    within COMPARABLE_SCORE_BAND of each other, so breadth precedes repetition
   *    among comparable work and abstains otherwise;
   * 5. presentation score, then maintenance, then verified metadata count;
   * 6. repository name, which makes the order total and independent of API order.
   *
   * Redundancy therefore can never promote a weaker tier, a fork over an original,
   * or an archive over an active project, and it can no longer promote a markedly
   * weaker presentation over a markedly stronger one. It only chooses among
   * repositories the earlier rules already consider equally suitable, which is
   * what the band makes true rather than merely stated.
   *
   * @param {Object} entryA first candidate with its redundancy measurement
   * @param {Object} entryB second candidate with its redundancy measurement
   * @returns {number} sort order
   */
  function compareCandidates(entryA, entryB) {
    return compareByStages(entryA, entryB, SELECTION_STAGES).order;
  }

  /**
   * the ordering rules, in the order they are applied, each one named
   *
   * The comparator is built from this list rather than from a chain of `||`
   * expressions so that the rule which actually settled a comparison can be
   * reported rather than inferred. The resulting order is identical; naming the
   * stages only makes the decision legible.
   *
   * Each stage returns a negative number when the first entry should precede the
   * second, so a stage phrased as "higher wins" subtracts in the opposite order.
   */
  const SELECTION_STAGES = [
    {
      name: "candidacy",
      // Abstains when the two presentations are too far apart to read as
      // comparable, because seven of the nine gates behind the tier are evidence
      // the score already counted. Fork and archive status are not among them and
      // keep deciding unbanded, at stages 2 and 3.
      compare: (a, b) =>
        Math.abs(b.candidate.score - a.candidate.score) <= CANDIDACY_SCORE_BAND
          ? a.candidate.tier - b.candidate.tier
          : 0,
    },
    {
      name: "originality",
      compare: (a, b) => a.candidate.originalityRank - b.candidate.originalityRank,
    },
    { name: "archive", compare: (a, b) => a.candidate.archivedRank - b.candidate.archivedRank },
    {
      name: "breadth",
      // Abstains unless the two repositories present comparably well, so breadth
      // breaks ties rather than overriding presentation evidence.
      compare: (a, b) =>
        Math.abs(b.candidate.score - a.candidate.score) <= COMPARABLE_SCORE_BAND
          ? a.redundancy.total - b.redundancy.total
          : 0,
    },
    { name: "score", compare: (a, b) => b.candidate.score - a.candidate.score },
    { name: "maintenance", compare: (a, b) => b.candidate.maintenance - a.candidate.maintenance },
    { name: "metadata", compare: (a, b) => b.candidate.metadataCount - a.candidate.metadataCount },
    { name: "name", compare: (a, b) => compareNames(a.candidate.name, b.candidate.name) },
  ];

  /**
   * applies ordering stages in turn and reports which one decided the comparison
   * @param {Object} entryA first candidate with its redundancy measurement
   * @param {Object} entryB second candidate with its redundancy measurement
   * @param {Array<Object>} stages ordering stages to apply, in order
   * @returns {Object} the sort order and the name of the deciding stage
   */
  function compareByStages(entryA, entryB, stages) {
    for (const stage of stages) {
      const order = stage.compare(entryA, entryB);
      if (order !== 0) return { order, stage: stage.name };
    }
    return { order: 0, stage: null };
  }

  /**
   * compares repository names without locale-dependent collation
   * @param {string} nameA first repository name
   * @param {string} nameB second repository name
   * @returns {number} sort order
   */
  function compareNames(nameA, nameB) {
    if (nameA === nameB) return 0;
    return nameA < nameB ? -1 : 1;
  }

  /**
   * records why a repository entered the set, using only evidence the audit verified
   * @param {Object} candidate selected candidate
   * @param {Object} redundancy redundancy measurement at the moment of selection
   * @param {number} position zero-based position in the recommended set
   * @returns {Array<string>} selection reasons
   */
  function explainSelection(candidate, redundancy, position) {
    const reasons = [];

    if (candidate.label === "strong") {
      reasons.push("Classified Strong candidate: confirmed original work, active, with a verified README, a usable description, and topics.");
    } else {
      reasons.push("Classified Worth polishing, with no high-priority presentation finding open.");
    }

    if (candidate.originality === "fork") {
      reasons.push("GitHub identifies this repository as a fork, and GitProfileLens cannot determine how much of the implementation belongs to the profile owner.");
    } else if (candidate.originality === "unknown") {
      reasons.push("GitHub did not report fork status, so GitProfileLens cannot record this as confirmed original work.");
    }

    if (candidate.archived) {
      reasons.push("It is archived, so it is recommended below comparable active repositories.");
    }

    if (position > 0) reasons.push(...explainBreadth(candidate, redundancy));
    if (!candidate.archived && !candidate.maintenanceUnknown && candidate.maintenance >= 100) {
      reasons.push("Pushed to within the last year.");
    }
    if (candidate.homepage) reasons.push("Links a homepage or demo a visitor can open.");
    if (candidate.gaps.length > 0) {
      reasons.push(`Polish before featuring: ${joinClauses(candidate.gaps)}.`);
    }
    if (candidate.evidence.unknowns.length > 0) {
      reasons.push(`GitProfileLens could not verify ${joinClauses(candidate.evidence.unknowns)} for this repository.`);
    }

    return reasons;
  }

  /**
   * describes what a repository adds to, or repeats from, the set already selected
   *
   * The topic clause is stated only when topics are the evidence that earned the
   * repository its place, meaning the language did not. Repeating "its topics do
   * not overlap" under every entry would bury the clauses that actually decided
   * something.
   *
   * @param {Object} candidate selected candidate
   * @param {Object} redundancy redundancy measurement at the moment of selection
   * @returns {Array<string>} breadth reasons
   */
  function explainBreadth(candidate, redundancy) {
    const reasons = [];

    if (redundancy.addsLanguage) {
      reasons.push(`Adds ${candidate.language}, which no other recommended repository represents.`);
    } else if (redundancy.languageMatch) {
      reasons.push(`Shares its primary language, ${candidate.language}, with ${redundancy.languageMatch.name}.`);
    } else {
      reasons.push("GitHub did not report a primary language, so GitProfileLens cannot say whether it widens the set.");
    }

    if (redundancy.topicMatch) {
      reasons.push(
        `Shares the topics ${joinClauses(redundancy.topicMatch.shared)} with ${redundancy.topicMatch.repository.name}, ` +
        "so the two may read as one project story."
      );
    } else if (redundancy.addsTopics && !redundancy.addsLanguage) {
      reasons.push("Its topics do not overlap the repositories already recommended.");
    }

    return reasons;
  }

  /**
   * selects the recommended set one repository at a time
   *
   * Greedy selection is used because redundancy is measured against the set built
   * so far, so each decision depends on the previous ones. Every step re-measures
   * every remaining candidate and applies the same total order, which keeps the
   * outcome deterministic and independent of the order the audits arrived in.
   *
   * @param {Array<Object>} candidates eligible optimizer candidates
   * @param {number} limit maximum recommended repositories
   * @returns {Array<Object>} recommended entries in selection order
   */
  function selectSet(candidates, limit, options = {}) {
    const stages = options.stages || SELECTION_STAGES;
    const trace = options.trace ? [] : null;
    const remaining = [...candidates];
    const selected = [];

    while (selected.length < limit && remaining.length > 0) {
      const ranked = remaining
        .map((candidate) => ({ candidate, redundancy: measureRedundancy(candidate, selected) }))
        .sort((entryA, entryB) => compareByStages(entryA, entryB, stages).order);
      const best = ranked[0];

      if (trace) trace.push(describeSlot(selected.length, ranked, stages));

      selected.push(best.candidate);
      remaining.splice(remaining.indexOf(best.candidate), 1);
      best.candidate.selection = {
        redundancy: best.redundancy,
        reasons: explainSelection(best.candidate, best.redundancy, selected.length - 1),
      };
    }

    return { selected, trace };
  }

  /**
   * records which rule settled one greedy selection, and against whom
   *
   * The deciding stage of a slot is the stage on which the winner beat the
   * runner-up: the first rule that separated them. Every other remaining
   * candidate is reported with the stage on which it lost to the winner, so a
   * recommendation can be read as a sequence of named comparisons rather than a
   * final score whose components cannot be recovered. This is measurement only;
   * nothing here influences the selection.
   *
   * @param {number} slotIndex zero-based slot being filled
   * @param {Array<Object>} ranked remaining candidates already in selection order
   * @param {Array<Object>} stages ordering stages in use
   * @returns {Object} the slot's decision record
   */
  function describeSlot(slotIndex, ranked, stages) {
    const [winner, ...alternatives] = ranked;

    return {
      slot: slotIndex + 1,
      candidatesRemaining: ranked.length,
      winner: describeTracedCandidate(winner),
      decidingStage: alternatives.length
        ? compareByStages(winner, alternatives[0], stages).stage
        : null,
      alternatives: alternatives.map((entry) => ({
        ...describeTracedCandidate(entry),
        lostAt: compareByStages(winner, entry, stages).stage,
      })),
    };
  }

  /**
   * captures the facts every ordering stage reads, for one traced candidate
   * @param {Object} entry candidate with its redundancy measurement
   * @returns {Object} the candidate's stage inputs
   */
  function describeTracedCandidate(entry) {
    return {
      name: entry.candidate.name,
      label: entry.candidate.label,
      score: entry.candidate.score,
      language: entry.candidate.language,
      topics: entry.candidate.topics,
      originality: entry.candidate.originality,
      archived: entry.candidate.archived,
      maintenance: entry.candidate.maintenance,
      metadataCount: entry.candidate.metadataCount,
      addsLanguage: entry.redundancy.addsLanguage,
      addsTopics: entry.redundancy.addsTopics,
      redundancyTotal: entry.redundancy.total,
      languageMatch: entry.redundancy.languageMatch ? entry.redundancy.languageMatch.name : null,
      topicMatch: entry.redundancy.topicMatch
        ? { name: entry.redundancy.topicMatch.repository.name, shared: entry.redundancy.topicMatch.shared }
        : null,
    };
  }

  /**
   * builds the public shape of one recommended repository
   * @param {Object} candidate selected candidate
   * @param {number} index zero-based position in the set
   * @returns {Object} recommended repository entry
   */
  function describeRecommendation(candidate, index) {
    return {
      position: index + 1,
      name: candidate.name,
      url: candidate.url,
      label: candidate.label,
      title: candidate.title,
      qualifier: candidate.qualifier,
      score: candidate.score,
      language: candidate.language,
      archived: candidate.archived,
      originality: candidate.originality,
      gaps: candidate.gaps,
      // The breadth credits this repository earned against the repositories chosen
      // before it, recorded so evaluation can report the diversity evidence used
      // without re-deriving it.
      breadth: {
        addsLanguage: candidate.selection.redundancy.addsLanguage,
        addsTopics: candidate.selection.redundancy.addsTopics,
      },
      reasons: candidate.selection.reasons,
    };
  }

  /**
   * compares the current pinned repositories with the recommended set
   *
   * Current pin state is read here and nowhere else. It is the thing being
   * compared against, never evidence that a repository deserves selection, which
   * is what keeps the recommendation from reinforcing whatever is already pinned.
   *
   * @param {Array<Object>} recommended recommended repository entries
   * @param {Array<string>} currentPinned currently pinned repository names
   * @returns {Array<Object>} advisory changes
   */
  function compareWithCurrentPins(recommended, currentPinned) {
    const recommendedNames = new Set(recommended.map((entry) => entry.name));
    const pinnedNames = new Set(currentPinned);
    const changes = [];

    for (const entry of recommended) {
      if (!pinnedNames.has(entry.name)) continue;
      // "Polish first" is only honest when the audit actually named something to
      // polish. A repository can be Worth polishing for a reason no edit can fix,
      // such as a fork relationship, and telling its owner to polish it would be
      // advice with no action behind it.
      const action = entry.gaps.length > 0 ? "polish" : "keep";
      changes.push({
        action,
        title: ACTIONS[action],
        repository: entry.name,
        replacement: null,
        explanation: action === "keep"
          ? `${entry.name} is already pinned and stays in the recommended set. It is classified ${entry.title}.`
          : `${entry.name} is already pinned and stays in the recommended set as ${entry.title}. ${capitalize(joinClauses(entry.gaps))} would improve how it presents.`,
      });
    }

    const additions = recommended.filter((entry) => !pinnedNames.has(entry.name));
    const departures = currentPinned.filter((name) => !recommendedNames.has(name));

    for (const [index, name] of departures.entries()) {
      const replacement = additions[index] || null;
      changes.push({
        action: "replace",
        title: ACTIONS.replace,
        repository: name,
        replacement: replacement ? replacement.name : null,
        explanation: replacement
          ? `Consider replacing ${name} with ${replacement.name}. ${explainReplacement(name, replacement)}`
          : `${name} is pinned but is not in the recommended set. GitProfileLens has no comparable repository to suggest in its place, so consider whether it still represents the work you want visitors to see first.`,
      });
    }

    for (const entry of additions.slice(departures.length)) {
      changes.push({
        action: "add",
        title: ACTIONS.add,
        repository: entry.name,
        replacement: null,
        explanation:
          `${entry.name} is in the recommended set and is not currently pinned. ` +
          `It is classified ${entry.title}${describeDistinction(entry)}.`,
      });
    }

    return changes;
  }

  /**
   * names what separates a repository from the rest of the recommended set
   *
   * Prefers the breadth clause recorded at selection time, because it is the one
   * piece of evidence unique to this repository's place in the set. Falls back to
   * an empty clause rather than inventing a distinction that is not there.
   *
   * @param {Object} entry recommended repository entry
   * @returns {string} trailing clause, empty when nothing distinguishes it
   */
  function describeDistinction(entry) {
    const breadth = entry.reasons.find((reason) => reason.startsWith("Adds "));
    return breadth ? ` and ${lowercase(breadth).replace(/\.$/, "")}` : "";
  }

  /**
   * states the difference between a pinned repository and its suggested replacement
   *
   * The explanation names what the evidence actually shows, because "B is better"
   * is not something the available data supports on its own.
   *
   * @param {string} name currently pinned repository name
   * @param {Object} replacement recommended repository entry
   * @returns {string} comparative explanation
   */
  function explainReplacement(name, replacement) {
    return `${replacement.name} is classified ${replacement.title}${describeDistinction(replacement)}, ` +
      `while ${name} did not meet the recommendation criteria.`;
  }

  /**
   * summarizes the observable diversity evidence behind a recommended set
   * @param {Array<Object>} recommended recommended repository entries
   * @returns {Object} diversity evidence
   */
  function summarizeDiversity(recommended) {
    const languages = [];
    const unknownLanguage = recommended.filter((entry) => !entry.language).length;

    for (const entry of recommended) {
      if (entry.language && !languages.includes(entry.language)) languages.push(entry.language);
    }

    return {
      languages,
      unknownLanguage,
      // Homepage presence is recorded as set completeness, not as redundancy: two
      // repositories both linking a demo is not a portfolio story overlap.
      withHomepage: recommended.filter((entry) =>
        entry.reasons.some((reason) => reason.startsWith("Links a homepage"))).length,
      sharedTopicPairs: recommended.filter((entry) =>
        entry.reasons.some((reason) => reason.startsWith("Shares the topics"))).length,
    };
  }

  /**
   * explains why the optimizer stopped short of GitHub's pin limit
   * @param {Array<Object>} recommended recommended repository entries
   * @param {number} limit maximum recommended repositories
   * @param {number} auditedCount number of audited repositories
   * @returns {string|null} shortfall explanation, or null when the set is full
   */
  function explainShortfall(recommended, limit, auditedCount) {
    if (recommended.length >= limit) return null;
    if (auditedCount === 0) return "There are no audited repositories to recommend.";
    if (recommended.length === 0) {
      return "No audited repository currently meets the recommendation criteria. GitProfileLens does not recommend featuring repositories it cannot affirmatively support.";
    }
    const count = recommended.length === 1
      ? "one repository that currently meets"
      : `${recommended.length} repositories that currently meet`;
    return `GitProfileLens found ${count} the recommendation criteria. ` +
      "It does not recommend filling the remaining slots with weaker candidates solely to reach the maximum.";
  }

  /**
   * collects private repositories that present as strong work but cannot be pinned publicly
   *
   * Privacy is not a quality penalty. These repositories are reported so the owner
   * can see that the work reads well, and are kept out of the pinnable set because
   * a public profile cannot feature them. Nothing here suggests publishing them.
   *
   * @param {Array<Object>} audits repository audits
   * @returns {Array<Object>} private portfolio candidates
   */
  function collectPrivateCandidates(audits) {
    return audits
      .filter((repositoryAudit) => repositoryAudit.repository.private)
      .map(createCandidate)
      .filter((candidate) => candidate.label !== "deemphasize"
        && !(candidate.label === "polish" && candidate.evidence.highFindings > 0)
        && hasReadableEvidence(candidate.evidence))
      .sort((candidateA, candidateB) =>
        candidateA.tier - candidateB.tier
        || candidateB.score - candidateA.score
        || compareNames(candidateA.name, candidateB.name))
      .map((candidate) => ({
        name: candidate.name,
        url: candidate.url,
        label: candidate.label,
        title: candidate.title,
        score: candidate.score,
        language: candidate.language,
      }));
  }

  /**
   * reads the currently pinned repositories, distinguishing "none" from "unknown"
   *
   * `pinned` is a tri-state: true, false, or null when the supplemental metadata
   * endpoint could not be reached. If no audited repository reports a verified pin
   * state, the current set is unknown and the optimizer says so rather than
   * reporting an empty profile.
   *
   * @param {Array<Object>} audits repository audits
   * @returns {{known: boolean, names: Array<string>}} current pin state
   */
  function readCurrentPins(audits) {
    const verified = audits.filter((repositoryAudit) => repositoryAudit.repository.pinned !== null);
    if (audits.length > 0 && verified.length === 0) return { known: false, names: [] };

    const names = verified
      .filter((repositoryAudit) => repositoryAudit.repository.pinned === true)
      .sort((auditA, auditB) =>
        (auditA.repository.pinnedPosition ?? Number.MAX_SAFE_INTEGER)
        - (auditB.repository.pinnedPosition ?? Number.MAX_SAFE_INTEGER))
      .map((repositoryAudit) => repositoryAudit.repository.name);

    return { known: true, names };
  }

  /**
   * joins clauses into readable prose
   * @param {Array<string>} clauses clauses to join
   * @returns {string} joined clauses
   */
  function joinClauses(clauses) {
    if (clauses.length <= 1) return clauses.join("");
    if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
    return `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
  }

  /**
   * capitalizes the first letter of a sentence
   * @param {string} text sentence text
   * @returns {string} capitalized text
   */
  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /**
   * lowercases the first letter of a clause moved into the middle of a sentence
   * @param {string} text clause text
   * @returns {string} clause with a lowercase opening letter
   */
  function lowercase(text) {
    return text.charAt(0).toLowerCase() + text.slice(1);
  }

  /**
   * groups the repositories that could not enter the recommended set
   * @param {Array<Object>} entries excluded audits with their reasons
   * @returns {Array<Object>} one group per exclusion reason
   */
  function groupExclusions(entries) {
    const order = ["deemphasize", "unreadable", "highFindings", "private"];
    return order
      .map((reason) => ({
        reason,
        explanation: EXCLUSION_REASONS[reason],
        repositories: entries.filter((entry) => entry.reason === reason).map((entry) => entry.name),
      }))
      .filter((group) => group.repositories.length > 0);
  }

  /**
   * recommends a pinned repository set from finished repository audits
   *
   * The optimizer reads audits and never writes to them: no repository score,
   * category score, finding, or candidacy label is changed by running it. It also
   * deliberately ignores `scorePortfolioFocus`, whose curation bonus rewards
   * archived and forked repositories that candidacy treats as weaknesses. Feeding
   * a profile-level score back into a set selection built from repository-level
   * candidacy would make the two disagreements compound rather than resolve.
   *
   * @param {Array<Object>} audits repository audits produced by scoreRepository
   * @param {Object} options optional limit override for tests
   * @returns {Object} the recommended set, the current pins, and the difference
   */
  function optimizePinnedSet(audits, options = {}) {
    const limit = options.limit ?? MAXIMUM_PINNED_REPOSITORIES;
    const eligible = [];
    const excluded = [];

    // Audits are sorted by name before eligibility so that nothing downstream can
    // depend on the order GitHub happened to return repositories in.
    for (const repositoryAudit of [...audits].sort((auditA, auditB) =>
      compareNames(auditA.repository.name, auditB.repository.name))) {
      const outcome = classifyEligibility(repositoryAudit);
      if (outcome.eligible) eligible.push(createCandidate(repositoryAudit));
      else excluded.push({ name: repositoryAudit.repository.name, reason: outcome.reason });
    }

    const selection = selectSet(eligible, limit, {
      stages: options.stages,
      trace: options.trace,
    });
    const recommended = selection.selected.map(describeRecommendation);
    const currentPins = readCurrentPins(audits);
    const changes = currentPins.known ? compareWithCurrentPins(recommended, currentPins.names) : [];
    const alreadyOptimal = currentPins.known
      && recommended.length > 0
      && recommended.length === currentPins.names.length
      && recommended.every((entry) => currentPins.names.includes(entry.name));

    return {
      limit,
      auditedCount: audits.length,
      eligibleCount: eligible.length,
      recommended,
      excluded: groupExclusions(excluded),
      currentPinsKnown: currentPins.known,
      currentPinned: currentPins.names,
      changes,
      alreadyOptimal,
      shortfall: explainShortfall(recommended, limit, audits.length),
      diversity: summarizeDiversity(recommended),
      privateCandidates: collectPrivateCandidates(audits),
      // Diagnostics only, and absent unless asked for. The interface never reads it.
      ...(selection.trace ? { trace: selection.trace } : {}),
    };
  }

  return {
    ACTIONS,
    CANDIDACY_SCORE_BAND,
    COMPARABLE_SCORE_BAND,
    EXCLUSION_REASONS,
    MAXIMUM_PINNED_REPOSITORIES,
    SELECTION_STAGES,
    SHARED_TOPIC_THRESHOLD,
    getPinnedLimit,
    optimizePinnedSet,
  };
  }
);
