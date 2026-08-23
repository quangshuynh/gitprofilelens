/**
 * Expected scoring outcomes for the evaluation corpus.
 *
 * These assertions describe what each persona's GitHub presentation should earn
 * and, just as importantly, what it should not be told to fix. Scores are
 * asserted as bands unless an exact value expresses a real contract, so that
 * legitimate scoring changes surface as a reviewable diff rather than a wall of
 * failing numbers. Corpus-wide changes are meant to be inspected with the
 * evaluation report; these tests exist to catch outcomes that should never move.
 *
 * Some assertions deliberately record behavior that is arguably wrong. Those are
 * marked "records current behavior" so that changing them is a decision rather
 * than an accident.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { CORPUS, getProfile } = require("./fixtures/index.js");
const { auditProfile, recommendationKeys } = require("./harness.js");
const {
  assertAdvice,
  assertNoAdvice,
  assertScoreInRange,
  assertScoresDescend,
  describeAdvice,
  findAdvice,
} = require("./expectations.js");

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Profiles exempt from the severity-ordering invariant.
 *
 * `prolific-account` crosses the hundred-repository boundary where
 * `severityWeight * 100 + affectedRepositories` lets widespread medium advice
 * outrank high-severity advice. That inversion is asserted explicitly in
 * "widespread advice outranks severe advice past a hundred repositories", so it
 * stays recorded rather than silently tolerated everywhere.
 */
const SEVERITY_ORDERING_EXCEPTIONS = new Set(["prolific-account"]);

const polished = auditProfile(getProfile("polished-professional"));
const forkDominated = auditProfile(getProfile("fork-dominated"));
const student = auditProfile(getProfile("student-coursework"));
const beginner = auditProfile(getProfile("beginner-account"));
const archiveHeavy = auditProfile(getProfile("archive-heavy"));
const ossMaintainer = auditProfile(getProfile("oss-maintainer"));
const prolific = auditProfile(getProfile("prolific-account"));
const flagship = auditProfile(getProfile("flagship-dominated"));
const strongWork = auditProfile(getProfile("strong-work-weak-presentation"));

test("presentation quality orders the corpus from curated to unpresented", () => {
  assertScoresDescend("overall profile score", [
    ["polished-professional", polished.profile.overall],
    ["fork-dominated", forkDominated.profile.overall],
    ["student-coursework", student.profile.overall],
    ["beginner-account", beginner.profile.overall],
  ]);
  assertScoreInRange("polished-professional overall", polished.profile.overall, 85, 100);
  assertScoreInRange("student-coursework overall", student.profile.overall, 60, 85);
  assertScoreInRange("beginner-account overall", beginner.profile.overall, 30, 60);
});

test("explanation categories separate explained work from unexplained work", () => {
  // Category weights are expected to be tuned over time, so these assert the
  // ordering the categories exist to express rather than the values they
  // currently produce. Value movement is reviewed with the evaluation report.
  assertScoresDescend("description category", [
    ["polished-professional", polished.profile.categories.descriptions],
    ["student-coursework", student.profile.categories.descriptions],
    ["beginner-account", beginner.profile.categories.descriptions],
  ]);
  assertScoresDescend("README category", [
    ["polished-professional", polished.profile.categories.readme],
    ["student-coursework", student.profile.categories.readme],
    ["beginner-account", beginner.profile.categories.readme],
  ]);
  assertScoresDescend("discoverability category", [
    ["polished-professional", polished.profile.categories.discoverability],
    ["student-coursework", student.profile.categories.discoverability],
    ["beginner-account", beginner.profile.categories.discoverability],
  ]);
});

test("a new account is never penalized for being new", () => {
  // Maintenance measures whether public work looks abandoned. Everything the
  // beginner persona owns was pushed within the year, so this must stay exact:
  // recency is the one presentation signal a new account can fully satisfy.
  assert.equal(
    beginner.profile.categories.maintenance,
    100,
    `beginner-account maintenance fell to ${beginner.profile.categories.maintenance}; recent pushes must score full marks regardless of any other weakness`
  );
  assert.equal(polished.profile.categories.maintenance, 100);
  assertScoreInRange("beginner-account presentation", beginner.profile.categories.presentation, 70, 90);
});

test("complete presentation metadata scores a repository perfectly", () => {
  // ledger-sync states a specific purpose, carries topics, a license, a demo
  // link, a comprehensive README, and a recent push. If a scoring change makes
  // a perfect presentation impossible, that is a decision worth reviewing.
  const ledgerSync = polished.audits.find((audit) => audit.repository.name === "ledger-sync");

  assert.equal(ledgerSync.score, 100, `ledger-sync scored ${ledgerSync.score} with complete presentation metadata`);
  assert.deepEqual(ledgerSync.findings, []);
});

test("a curated profile is told to polish, never to start over", () => {
  const severities = new Set(polished.recommendations.map((recommendation) => recommendation.severity));

  assert.equal(
    severities.has("high"),
    false,
    `polished-professional received high-severity advice.\n${describeAdvice(polished)}`
  );
  assertNoAdvice(polished, "README quality", /add a readme explaining/i, "Every repository has a README.");
  assertNoAdvice(polished, "Descriptions", /add one sentence stating/i, "Every repository has a description.");
  assertAdvice(polished, "Discoverability", /add an appropriate license/i, { repositories: ["dotfiles"] });
  assertAdvice(polished, "README quality", /expand it with purpose/i, { repositories: ["dotfiles"] });
});

test("pin suggestions rank the strongest unpinned repositories first", () => {
  assertAdvice(polished, "Portfolio focus", /consider pinning/i, {
    severity: "medium",
    repositories: ["receipt-ocr", "envelope"],
  });
  assertNoAdvice(polished, "Portfolio focus", /improve or unpin/i, "Every pinned repository scores well.");
});

test("an account with nothing strong to pin is not given pin advice", () => {
  assertNoAdvice(beginner, "Portfolio focus", /consider pinning/i, "No repository is strong enough to suggest.");
  assertNoAdvice(beginner, "Portfolio focus", /improve or unpin/i, "Nothing is pinned.");
});

test("a beginner profile is told what is missing, highest impact first", () => {
  assert.equal(
    beginner.recommendations[0].severity,
    "high",
    `beginner-account leads with ${beginner.recommendations[0].severity} advice.\n${describeAdvice(beginner)}`
  );
  assertAdvice(beginner, "Descriptions", /add one sentence stating/i, {
    severity: "high",
    repositories: ["hello-world", "calculator"],
  });
  assertAdvice(beginner, "README quality", /add a readme explaining/i, {
    severity: "high",
    repositories: ["hello-world", "calculator"],
  });
  assertAdvice(beginner, "Discoverability", /add three to five specific topics/i, {
    severity: "medium",
    repositories: ["hello-world", "My_First_Website", "calculator"],
  });
  assertAdvice(beginner, "Repository presentation", /choose a short, distinctive name/i, {
    repositories: ["hello-world"],
  });
});

test("a weak pinned repository is the loudest advice a coursework profile receives", () => {
  const weatherApp = student.audits.find((audit) => audit.repository.name === "weather-app");

  assertScoreInRange("weather-app repository score", weatherApp.score, 40, 59);
  assertAdvice(student, "Portfolio focus", /improve or unpin/i, {
    severity: "high",
    repositories: ["weather-app"],
  });
});

test("coursework naming is flagged as clutter without lowering the repository score category", () => {
  const clutterNames = ["cs261-lab-4", "data-structures-practice", "algorithms-course-notes"];

  for (const name of clutterNames) {
    const audit = student.audits.find((candidate) => candidate.repository.name === name);
    const clutter = audit.findings.find((finding) => /tutorial, class, or test repository/i.test(finding.reason));
    assert.ok(clutter, `${name} was expected to match the clutter-name heuristic`);
    assert.equal(clutter.category, "Portfolio focus");
    assert.equal(clutter.factual, false);
  }
  assertScoreInRange("student-coursework presentation", student.profile.categories.presentation, 85, 100);
});

test("license advice covers the coursework repositories and skips the forks", () => {
  const advice = assertAdvice(student, "Discoverability", /add an appropriate license/i, { severity: "medium" });

  assert.equal(advice.repositories.length, 6, `license advice covered ${advice.repositories.join(", ")}`);
  assert.equal(advice.repositories.includes("ml-teaching-notebooks"), false);
  assert.equal(advice.repositories.includes("webapp-starter"), false);
});

test("forks carry upstream presentation into the profile score", () => {
  // Records current behavior. Repository categories are averaged across forks
  // and original work alike, so seven well-presented forks and two unexplained
  // original repositories score close to a fully curated profile. Changing this
  // is a scoring decision, not a bug fix.
  const originals = ["scripts", "notes-app"];

  assertScoreInRange("fork-dominated overall", forkDominated.profile.overall, 80, 92);
  assertAdvice(forkDominated, "Descriptions", /add one sentence stating/i, { repositories: ["scripts"] });
  for (const recommendation of forkDominated.recommendations) {
    if (recommendation.category !== "Descriptions") continue;
    for (const name of recommendation.repositories) {
      assert.ok(
        originals.includes(name),
        `fork-dominated asked for a description on ${name}, which inherits one upstream.\n${describeAdvice(forkDominated)}`
      );
    }
  }
});

test("portfolio focus rewards forking as curation", () => {
  // Records current behavior. scorePortfolioFocus grants two points per archived
  // or forked repository, so an account of seven forks scores higher on focus
  // than a curated account of six original projects. Flagged as a scoring
  // question; pinned here so any change to it is deliberate.
  assert.ok(
    forkDominated.profile.categories.focus > polished.profile.categories.focus,
    `the fork curation bonus no longer outweighs a curated original portfolio: ` +
    `fork-dominated=${forkDominated.profile.categories.focus}, polished-professional=${polished.profile.categories.focus}`
  );
  assertScoreInRange("fork-dominated focus", forkDominated.profile.categories.focus, 78, 90);
  assertScoreInRange("polished-professional focus", polished.profile.categories.focus, 70, 82);
});

test("pin suggestions treat forks as pinnable work", () => {
  // Records current behavior. isStrongUnpinnedAudit excludes archived
  // repositories but not forks, so a fork-heavy account is advised to pin
  // projects it did not write.
  const advice = assertAdvice(forkDominated, "Portfolio focus", /consider pinning/i);
  const forks = new Set(
    forkDominated.repositories.filter((repository) => repository.fork).map((repository) => repository.name)
  );

  assert.equal(advice.repositories.length, 3);
  for (const name of advice.repositories) {
    assert.ok(forks.has(name), `pin advice named ${name}, which is not a fork; the fork exclusion may have changed`);
  }
});

test("popularity is recorded but never scored", () => {
  // The clearest statement of what this tool measures. Stars, forks, and open
  // issues are carried through normalization for display and export, and they
  // must never move a presentation score in either direction.
  const profile = getProfile("strong-work-weak-presentation");
  const unpopular = auditProfile({
    ...profile,
    repositories: profile.repositories.map((repository) => ({
      ...repository,
      stargazers_count: 0,
      forks_count: 0,
      open_issues_count: 0,
    })),
  });

  assert.deepEqual(
    unpopular.profile,
    strongWork.profile,
    "removing every star, fork, and open issue changed the presentation score"
  );
  assert.deepEqual(recommendationKeys(unpopular), recommendationKeys(strongWork));
});

test("heavily used projects still score badly when nothing explains them", () => {
  const stars = strongWork.repositories.reduce((total, repository) => total + repository.stars, 0);

  assert.ok(stars > 5000, "the persona should carry substantial traction");
  assertScoresDescend("presentation over popularity", [
    ["polished-professional", polished.profile.overall],
    ["strong-work-weak-presentation", strongWork.profile.overall],
  ]);
  assertScoreInRange("strong-work-weak-presentation overall", strongWork.profile.overall, 50, 70);
  assertScoreInRange("strong-work-weak-presentation maintenance", strongWork.profile.categories.maintenance, 100, 100);
});

test("archiving holds maintenance steady no matter how old the work is", () => {
  // Archiving states that a project is finished. Age after that point is not
  // neglect, so every archived repository scores the same regardless of when it
  // was retired.
  const archived = archiveHeavy.audits.filter((audit) => audit.repository.archived);
  const oldest = archived.find((audit) => audit.repository.name === "first-startup-backend");
  const newest = archived.find((audit) => audit.repository.name === "deprecated-cli");

  assert.equal(archived.length, 6);
  for (const audit of archived) {
    assert.equal(
      audit.categoryScores.maintenance,
      85,
      `${audit.repository.name} scored ${audit.categoryScores.maintenance} for maintenance while archived`
    );
  }
  assert.equal(oldest.categoryScores.maintenance, newest.categoryScores.maintenance);
});

test("archiving is the curation signal portfolio focus is meant to reward", () => {
  const scores = CORPUS.map((profile) => auditProfile(profile).profile.categories.focus);

  assert.equal(
    archiveHeavy.profile.categories.focus,
    Math.max(...scores),
    `archive-heavy no longer leads the corpus on focus (${archiveHeavy.profile.categories.focus})`
  );
  assert.ok(archiveHeavy.profile.categories.focus > polished.profile.categories.focus);
});

test("archived repositories are never offered as pin candidates", () => {
  // Asserted across the corpus rather than on archive-heavy alone: that persona
  // generates enough repository-level advice to push its pin suggestion past
  // the five-recommendation cap, so the invariant is checked wherever pin
  // advice actually surfaces.
  let checked = 0;

  for (const profile of CORPUS) {
    const result = auditProfile(profile);
    const advice = findAdvice(result, "Portfolio focus", /consider pinning/i);
    if (!advice) continue;
    checked += 1;
    const archived = new Set(
      result.repositories.filter((repository) => repository.archived).map((repository) => repository.name)
    );
    for (const name of advice.repositories) {
      assert.equal(
        archived.has(name),
        false,
        `${result.id} suggested pinning ${name}, which is archived.\n${describeAdvice(result)}`
      );
    }
  }

  assert.ok(checked >= 3, `only ${checked} profiles produced pin suggestions to check`);
});

test("archived repositories still receive advice about work their owner retired", () => {
  // Records current behavior. Description and README scoring do not consider
  // `archived`, so a repository retired in 2018 is still told to add a README.
  // Flagged as a scoring question rather than changed here.
  assertAdvice(archiveHeavy, "README quality", /add a readme explaining/i, {
    severity: "high",
    repositories: ["first-startup-backend"],
  });
  assertAdvice(archiveHeavy, "Descriptions", /add one sentence stating/i, {
    severity: "high",
    repositories: ["first-startup-backend"],
  });
});

test("a full set of six pins suppresses further pin suggestions", () => {
  const rfcs = ossMaintainer.audits.find((audit) => audit.repository.name === "hexline-rfcs");
  const pinned = ossMaintainer.repositories.filter((repository) => repository.pinned);

  assert.equal(pinned.length, 6);
  assert.equal(rfcs.repository.pinned, false);
  assert.ok(rfcs.score >= 85, `hexline-rfcs scored ${rfcs.score} and would otherwise be a pin candidate`);
  assertNoAdvice(
    ossMaintainer,
    "Portfolio focus",
    /consider pinning/i,
    "All six pin slots are already in use."
  );
});

test("a long-lived repository is not treated as stale while it is still pushed", () => {
  const hexline = ossMaintainer.audits.find((audit) => audit.repository.name === "hexline");

  assert.equal(hexline.repository.createdAt, "2016-04-02T00:00:00Z");
  assert.equal(
    hexline.categoryScores.maintenance,
    100,
    "maintenance must measure time since the last push, not repository age"
  );
});

test("a description too long to scan is flagged without being treated as missing", () => {
  const hexline = ossMaintainer.audits.find((audit) => audit.repository.name === "hexline");

  assert.ok(hexline.repository.description.length > 160);
  assertAdvice(ossMaintainer, "Descriptions", /condense it to one focused sentence/i, {
    severity: "low",
    repositories: ["hexline"],
  });
  assertScoreInRange("hexline description score", hexline.categoryScores.descriptions, 80, 95);
});

test("one exceptional repository does not carry an otherwise unpresented profile", () => {
  const promptkit = flagship.audits.find((audit) => audit.repository.name === "promptkit");

  assert.equal(promptkit.score, 100);
  assert.equal(promptkit.repository.pinned, true);
  assert.ok(promptkit.repository.stars > 8000);
  assertScoreInRange("flagship-dominated overall", flagship.profile.overall, 40, 60);
  assertScoresDescend("a flagship adds no weight of its own", [
    ["strong-work-weak-presentation", strongWork.profile.overall],
    ["flagship-dominated", flagship.profile.overall],
  ]);
  assertNoAdvice(flagship, "Portfolio focus", /consider pinning/i, "Nothing unpinned is strong enough to suggest.");
  assertNoAdvice(flagship, "Portfolio focus", /improve or unpin/i, "The only pinned repository scores 100.");
});

test("a placeholder description scores below a short but genuine one", () => {
  const placeholder = flagship.audits.find((audit) => audit.repository.name === "chatbot-demo");
  const brief = flagship.audits.find((audit) => audit.repository.name === "resume");

  assertScoresDescend("description quality", [
    ["resume", brief.categoryScores.descriptions],
    ["chatbot-demo", placeholder.categoryScores.descriptions],
  ]);
  assertAdvice(flagship, "Descriptions", /replace it with the project's purpose/i, {
    severity: "high",
    repositories: ["chatbot-demo"],
  });
});

test("README status beyond the metadata limit is unverified rather than missing", () => {
  // The public GraphQL query returns README data for the first 100
  // repositories. The remainder must score neutrally and must never produce
  // advice, because the tool does not know whether those READMEs exist.
  const unverified = prolific.audits.filter((audit) => audit.repository.readme.present === null);
  const readmeAdvice = prolific.recommendations.filter((item) => item.category === "README quality");

  assert.equal(prolific.repositories.length, 112);
  assert.equal(unverified.length, 12);
  for (const audit of unverified) {
    assert.equal(audit.categoryScores.readme, 60, `${audit.repository.name} did not receive the neutral unverified score`);
    assert.ok(audit.findings.some((finding) => finding.severity === "info" && /could not be verified/i.test(finding.reason)));
  }
  for (const advice of readmeAdvice) {
    for (const name of advice.repositories) {
      assert.equal(
        unverified.some((audit) => audit.repository.name === name),
        false,
        `README advice named ${name}, whose README status is unknown`
      );
    }
  }
});

test("widespread advice outranks severe advice past a hundred repositories", () => {
  // Records current behavior. Recommendations rank on
  // `severityWeight * 100 + affectedRepositories`, so once a medium-severity
  // issue affects more than a hundred repositories it overtakes high-severity
  // advice. Only a profile this large can reach the boundary. Flagged as a
  // scoring question; asserted here so any fix is a deliberate change.
  const topics = prolific.recommendations.findIndex((item) => /add three to five specific topics/i.test(item.action));
  const missingReadme = prolific.recommendations.findIndex((item) => /add a readme explaining/i.test(item.action));

  assert.ok(topics >= 0 && missingReadme >= 0, describeAdvice(prolific));
  assert.equal(prolific.recommendations[topics].severity, "medium");
  assert.equal(prolific.recommendations[missingReadme].severity, "high");
  assert.ok(prolific.recommendations[topics].repositories.length > 100);
  assert.ok(
    topics < missingReadme,
    `the ranking inversion is gone; medium advice no longer outranks high advice.\n${describeAdvice(prolific)}`
  );
});

test("every corpus recommendation is actionable, attributed, and ranked by severity", () => {
  for (const profile of CORPUS) {
    const result = auditProfile(profile);
    const owned = new Set(result.repositories.map((repository) => repository.name));

    for (const recommendation of result.recommendations) {
      assert.notEqual(recommendation.severity, "info", `${result.id} surfaced unverifiable advice.\n${describeAdvice(result)}`);
      assert.ok(recommendation.repositories.length > 0, `${result.id} produced advice affecting no repository.\n${describeAdvice(result)}`);
      assert.ok(recommendation.action.length > 0);
      for (const name of recommendation.repositories) {
        assert.ok(owned.has(name), `${result.id} attributed advice to ${name}, which it does not own`);
      }
    }

    if (SEVERITY_ORDERING_EXCEPTIONS.has(result.id)) continue;
    for (let index = 1; index < result.recommendations.length; index += 1) {
      assert.ok(
        SEVERITY_RANK[result.recommendations[index - 1].severity] >= SEVERITY_RANK[result.recommendations[index].severity],
        `${result.id} ranked lower-severity advice above higher-severity advice.\n${describeAdvice(result)}`
      );
    }
  }
});
