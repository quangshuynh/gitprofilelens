# Scoring rationale

How the GitProfileLens score is calculated, what each part of it is claiming, what it
deliberately refuses to claim, and how to change it without breaking the claim.

Everything here is derived from [`audit.js`](../audit.js). Where a rule looks like it does
not match its apparent intent, this document says so rather than describing the intent as
if the code implemented it. Those cases are collected in
[Known limitations](#known-limitations-and-open-questions).

---

## What the score measures

**GitProfileLens measures how a GitHub profile presents itself to a visitor.** It scores
the metadata a person browsing the account can see without reading any code: repository
names, descriptions, README structure, topics, licenses, demo links, staleness, and how
coherent the visible portfolio looks.

**It does not measure developer ability, engineering skill, code quality, employability, or
intelligence.** No part of the pipeline reads source code, commit contents, test coverage,
issue discussion, or contribution history. It cannot form an opinion about those things,
and no change should give it one.

This is not a disclaimer bolted onto a general-purpose quality score. It is a structural
property of the implementation, and it is worth stating what enforces it:

- **The only inputs are presentation metadata.** `transformRepository` (audit.js:281)
  normalizes the GitHub REST repository payload plus optional README structure and pin
  metadata. Nothing else reaches the scorer.
- **Popularity is recorded but never scored.** `stars`, `forks`, and `openIssues` are
  normalized and exported for the repository explorer and the JSON report, and no scoring
  function reads them. A repository with 40,000 stars and no description scores exactly the
  same as an identical repository with zero stars. This is asserted by a corpus test that
  rebuilds a profile with every popularity number zeroed and requires byte-identical
  output.
- **Every finding is about something the owner can edit in the GitHub UI.** Add a
  description, add topics, write a README section, archive a dead repository, pick a
  license. None of them require writing better software.

Consequently a low score means "this profile is hard for a visitor to read", not "this
person is bad at their job". Treat any proposed rule that cannot be phrased that way as out
of scope.

---

## The pipeline

There is no single "score a profile" entry point. Callers assemble four pure functions:

```
raw GitHub REST repositories + supplemental metadata
  -> transformRepository(repository, supplemental)   audit.js:281
  -> scoreRepository(repository, now)                audit.js:363
  -> scoreProfile(audits)                            audit.js:434
  -> generateRecommendations(audits)                 audit.js:510
```

`supplemental` carries README structure and the pinned repository list from the serverless
metadata endpoint. It is `null` on deployments where that endpoint is unavailable, which is
a distinct state from "the repository has no README" — see
[Unknown is not the same as absent](#unknown-is-not-the-same-as-absent).

Every function is deterministic given its inputs and the injected `now`. `scoreRepository`
defaults `now` to `new Date()`, so production maintenance scores drift with wall-clock
time; the evaluation corpus pins the date instead.

---

## Repository scoring

`scoreRepository` produces five category scores and combines them:

| Category | Weight | Function |
|---|---|---|
| presentation | 0.15 | `scoreName` (audit.js:120) |
| descriptions | 0.25 | `scoreDescription` (audit.js:74) |
| readme | 0.25 | `scoreReadme` (audit.js:157) |
| discoverability | 0.20 | `scoreDiscoverability` (audit.js:215) |
| maintenance | 0.15 | `scoreMaintenance` (audit.js:243) |

Descriptions and READMEs carry half the weight between them. That is the implementation's
strongest editorial position: the two things a visitor reads first, before deciding whether
to open anything, matter more than everything else combined.

### presentation — the repository name

Starts at 100 and subtracts. Rewards short, lowercase, kebab-case, specific names.

| Condition | Penalty | Severity | Filed under |
|---|---|---|---|
| Name longer than 50 characters | −20 | medium | Repository presentation |
| Contains an underscore | −10 | low | Repository presentation |
| Contains an uppercase letter | −5 | low | Repository presentation |
| Matches `test`, `project`, `repo`, `demo`, `sample`, `hello-world`, … | −40 | high | Repository presentation |
| Contains `tutorial`, `practice`, `course`, `homework`, `assignment`, `lab2`, `test3` | −15 | low | **Portfolio focus** |

The name is a discoverability surface: it appears in search results, in the pinned grid, and
in every link to the project. A name that could belong to any repository tells a visitor
nothing.

Note the last row. The clutter penalty is subtracted from the **presentation** score, but
its finding is filed under the **Portfolio focus** category, because the advice is about
whether the repository belongs in the portfolio at all rather than about its name. This is
the one place where a category's score and its findings come from different places.

### descriptions — the one-line pitch

Starts at 100 and subtracts, except that a missing description short-circuits to zero.

| Condition | Result | Severity |
|---|---|---|
| Missing or whitespace-only | **score 0**, returns immediately | high |
| Exactly `test`, `todo`, `tbd`, `wip`, `sample`, `demo`, … | −55 | high |
| Otherwise matches a generic pattern (`a python app`, `web project`, …) | −35 | high |
| Fewer than 30 characters | −25 | medium |
| More than 160 characters | −15 | low |
| Begins with `(wip)`, `(broken)`, `(deprecated)`, `(archived)` | −15 | medium |
| Begins with a lowercase letter | −5 | low |

The placeholder and generic branches are mutually exclusive; every other penalty stacks. A
27-character lowercase description scores 70, not 100.

The zero for a missing description is the harshest single rule in the system — no other
condition short-circuits a category to 0. What it lines up with: the description is the only
text GitHub shows next to a repository in list views, search results, and the pinned grid.
With it empty, a visitor has the name and nothing else.

The status-label rule (`(WIP) Ledger sync`) is not a judgment about unfinished work. It
says GitHub already has dedicated mechanisms for that state — the archive flag and topics —
and spending the description on it costs the one line that could have explained the project.

### readme — depth of explanation

The only category whose branches return fixed scores rather than accumulating penalties.

| Condition | Score | Severity |
|---|---|---|
| `present === null` — README status unknown | 60 | info |
| `present === false` — no root README | 10 | high |
| Present, smaller than 500 bytes | 55 | medium |
| Present, ≥ 500 bytes, no section analysis available | 100 | — |
| Present, ≥ 500 bytes, analyzed | 35 + structure below | varies |

The analyzed path starts at 35 and adds:

| Signal | Points |
|---|---|
| Overview section | +15 |
| Installation or setup section | +15 |
| Usage section | +15 |
| Examples section | +10 |
| Contributing section | +5 |
| Contains a code block | +5 |
| Contains an image | +5 |
| Three or more headings | +5 |

Maximum 110, clamped to 100. The three core sections are worth 45 of the 75 points available
above the floor, so the weights answer *what is this*, *how do I run it*, and *how do I use
it* before anything else. Formatting polish — code block, image, heading count — is worth 15
combined.

An unverifiable README scores 60 with an `info` finding rather than being treated as
missing. `info` findings are filtered out of recommendations, so an unverified README never
produces advice — the tool does not tell you to fix something it could not check.

### discoverability — can this be found and reused

Starts at 100 and subtracts.

| Condition | Penalty | Severity |
|---|---|---|
| No topics | −40 | medium |
| No detected license | −25 | medium |
| Web-language project with no homepage, not archived | −15 | low |

Topics are the heaviest single penalty here because they are the only structured way GitHub
lets a repository be found by someone who was not already looking for it.

The homepage rule fires only when `language` is one of HTML, CSS, JavaScript, TypeScript,
Vue, or Svelte — the languages where a deployable demo is a reasonable expectation — and is
skipped for archived repositories, since a retired project is not expected to be hosted.

### maintenance — is this still alive

Fixed scores by staleness, measured from `pushedAt` falling back to `updatedAt`.

| Condition | Score | Severity |
|---|---|---|
| Archived | 85 | — (no finding) |
| Timestamp unusable | 60 | info |
| Not pushed in more than 3 years (1095 days) | 35 | medium |
| Not pushed in more than 2 years (730 days) | 65 | low |
| Not pushed in more than 1 year (365 days) | 85 | — (no finding) |
| Pushed within the last year | 100 | — |

Archiving is the intended way to say "this is finished". A repository archived on purpose
scores 85 and generates no maintenance advice, identical to a repository pushed eight months
ago. Silence is what is being penalized, not age: a project that has not moved in three
years with no signal about why leaves a visitor unable to tell finished from abandoned.

This is the only category that depends on the clock, and therefore the only one whose
production score changes without anyone touching the profile.

---

## Profile scoring

`scoreProfile` averages each repository category across **every** repository — forks and
archived repositories included — then adds a sixth category computed separately.

| Category | Weight |
|---|---|
| presentation | 0.15 |
| descriptions | 0.20 |
| readme | 0.20 |
| discoverability | 0.20 |
| maintenance | 0.15 |
| focus | 0.10 |

Three consequences worth being explicit about:

1. **The profile weights are not the repository weights.** Descriptions and readme drop
   from 0.25 to 0.20 each to make room for focus. A repository's own score is therefore not
   the same formula as its contribution to the profile score.
2. **The overall score is not the mean of the repository scores.** It is a weighted
   combination of category means, which is a different number.
3. **Averaging is flat.** Every repository counts equally regardless of pin status,
   popularity, or recency. One excellent project among seven neglected ones barely moves
   the profile — the `flagship-dominated` corpus persona exists to make that visible, and
   scores 50 with one repository at 100.

Flat averaging is consistent with the claim the score makes — it is about the portfolio a
visitor encounters, and a visitor scrolling an account sees all of it. Whether it is the
*intended* behavior is not recorded anywhere in the implementation, and `flagship-dominated`
exists so that any change to it is visible rather than incidental.

### focus — does the portfolio read as coherent

`scorePortfolioFocus` (audit.js:403) is the only profile category not derived from
repository audits:

```
active           = repositories that are neither archived nor forked
concentration    = largest single-language group among active / count of active
curationBonus    = min(15, (total - active) * 2)
focus            = 55 + concentration * 30 + curationBonus
```

The floor is 55 and the ceiling is 100, except that a profile with no repositories scores 0.

Language concentration is a proxy for a portfolio that reads as being *about* something. The
curation bonus rewards moving finished or borrowed work out of the active set, which is what
archiving is for.

The curation bonus counts archived **and** forked repositories, which means forking raises
focus. See [F2](#f2--forking-counts-as-curation).

---

## Recommendations

`generateRecommendations` turns per-repository findings into portfolio-level advice.

1. **Drop `info` findings.** Anything the tool could not verify produces no advice.
2. **Group by `category|action`.** Findings that recommend the same action merge into one
   recommendation carrying the list of affected repository names. The group keeps the first
   finding's `reason`, so a finding whose reason quotes its own measurements declares a
   plural-safe `groupReason` that is substituted once the group covers more than one
   repository.
3. **Append pin advice** after grouping, so portfolio advice never merges with per-repository
   advice.
4. **Rank** by `severityWeight * 100 + repositoryCount`, where high = 3, medium = 2, low = 1.
5. **Truncate to five.**

The cap is a hard limit, not a relevance threshold: advice ranked sixth is discarded, however
severe. See [F7](#f7--the-five-item-cap-can-hide-portfolio-advice).

### Pin advice

Two rules, both requiring verified pin metadata:

- **Weak pins** — any pinned repository scoring below 60 produces one `high` recommendation
  to improve or unpin them.
- **Pin candidates** — if fewer than 6 repositories are pinned, the three highest-scoring
  unpinned, non-archived, **non-private** repositories scoring ≥ 85 produce one `medium`
  recommendation. Private repositories are excluded because the suggestion names the work a
  visitor should notice first, and a visitor cannot see them.

Pinning is the single highest-leverage presentation control GitHub offers: it decides what a
visitor sees before they scroll. Six is GitHub's own limit.

---

## How the categories interact

- **A missing description costs twice.** It zeroes the repository's description score, and
  because profile categories are flat means, it pulls the profile's description average down
  by up to `100 / repositoryCount`.
- **Archiving is a trade.** It raises maintenance to 85 and adds up to 15 focus points, but
  removes the repository from the active set that determines language concentration. For a
  single-language account, archiving can lower focus even while raising maintenance.
- **Name clutter is scored in one category and reported in another.** See
  [presentation](#presentation--the-repository-name).
- **Repository count dampens everything.** Each repository contributes `1/n` to every
  category mean. On a 112-repository account, fixing one repository perfectly is
  arithmetically invisible.
- **Severity and breadth compete in ranking, and breadth can win.** See
  [F1](#f1--breadth-can-outrank-severity).
- **Forks are judged, counted, and averaged like original work.** A fork inherits the
  upstream project's description, README, topics, and license, so a fork-heavy account
  inherits that project's presentation quality as if it were its own.

---

## Assumptions

These are the beliefs the implementation is built on. They are defensible, not self-evident,
and are the right things to argue about when proposing a change.

1. **A visitor's first impression is formed from metadata, not code.** The entire scope
   follows from this.
2. **Every repository on an account is part of the portfolio.** Flat averaging, forks and
   archives included.
3. **Explicit status beats implicit status.** Archived scores well; three years of silence
   does not.
4. **Consistency is presentation.** Kebab-case naming is scored even though nothing
   functional depends on it.
5. **Language concentration signals coherence.** A defensible proxy for a portfolio with a
   theme, and unfair to people who work across many stacks by design.
6. **Advice should be finite and ranked.** Five items, most severe and most widespread first.
7. **Unknown is not absent.** Unverifiable data scores neutrally and stays silent.

### Unknown is not the same as absent

Three states, three behaviors:

| State | `readme.present` | Score | Advice |
|---|---|---|---|
| Verified present | `true` | 10–100 by structure | Structural advice |
| Verified absent | `false` | 10 | `high` — add a README |
| Not verifiable | `null` | 60 | `info` — filtered out |

The same distinction applies to pins: `repository.pinned` is `null` when metadata is
unavailable, and both pin rules require `true`/`false`, so a deployment without the metadata
endpoint produces no pin advice rather than wrong pin advice.

---

## Known limitations and open questions

Behavior that is arguably wrong. **None of these are bugs that have been fixed** — they are
recorded here and pinned by tests marked *records current behavior*, so that changing any of
them is a decision rather than an accident.

Each names the corpus profile that exposes it.

### F1 — Breadth can outrank severity
`severityWeight * 100 + repositoryCount` lets a medium finding on more than 100 repositories
outrank a high one. `prolific-account` ranks two medium × 106 findings above a high × 3.
Recorded via `SEVERITY_ORDERING_EXCEPTIONS` in `tests/scoring/personas.test.js`.

### F2 — Forking counts as curation
`curationBonus = min(15, archivedOrForked * 2)` treats forks as curated-away work.
`fork-dominated` scores focus 84, above `polished-professional` at 75.

### F3 — Recommendation order depends on audit order
`generateRecommendations` is order-dependent on ties: reversing the audit array swaps tied
recommendations, because grouping preserves first-encountered order. `scoreProfile` is
explicitly order-independent. Unit-level; no persona depends on it.

### F4 — README scoring cliff
`{present: true, size: 600}` scores 100 through the legacy no-`sections` path, but 35 once
analyzed with no recognized sections. Better metadata can lower the score by 65 points.
Unit-level.

### F5 — Nothing and nothing-good score alike
`scoreProfile([])` returns overall 0, so an account with nothing to present reads identically
to one presenting badly. Separately, profile READMEs are unmodeled: `username/username` is
scored as an ordinary repository. Exposed by `empty-account`.

### F6 — Pin candidates can be other people's work
`isStrongUnpinnedAudit` excludes archived repositories but not forks, so fork-heavy accounts
are advised to pin projects they did not write, as "the work you want visitors to notice
first". Exposed by `fork-dominated`.

### F7 — The five-item cap can hide portfolio advice
Portfolio-level advice competes with per-repository advice on a count-dominated scale.
`archive-heavy` has a clear pin candidate whose advice lands at rank 9 and is never shown.

### F8 — Archived repositories still get high-severity content advice
Description and README scoring never consult `archived`, so a repository archived in 2018 is
told at `high` severity to add a README. Exposed by `archive-heavy`.

### F9 — Private repositories are treated as unpinned — FIXED
The authenticated audit forces `pinnedRepositories: []`, so private repositories read as
explicitly unpinned and became pin candidates, advised as "the work you want visitors to
notice first" even though no visitor can see them.

Resolved: `isStrongUnpinnedAudit` now excludes private repositories. They are still scored
normally — privacy changes what the tool points a visitor at, never how it judges a
repository. Exposed by `private-audit-scope`.

**Still open in the same code path:** `script.js:261` builds the authenticated audit's
supplemental metadata with an empty pin list even though the real one was fetched into
`publicSupplemental` on line 246. Public repositories therefore read as unpinned in
authenticated mode even when they are pinned, so an already-pinned project can be suggested
as a pin candidate and the weak-pin rule can never fire. That is a browser-layer defect, not
a scoring rule, and the corpus cannot reach it.

### F10 — `NOASSERTION` passes as a license
GitHub returns `spdx_id: "NOASSERTION"` for a license file it cannot identify.
`scoreDiscoverability` only checks presence, so it passes with no finding. Exposed by
`unusual-metadata`.

### F11 — Merged advice displays one repository's specifics — FIXED
Findings group by `category|action`, and the group kept the **first** finding's `reason`,
which `script.js:731` renders directly above the affected repository list. Reasons that embed
per-repository numbers were therefore wrong for every repository after the first.

Resolved: a finding may now declare a plural-safe `groupReason`, and `summarizeRecommendation`
substitutes it once a group covers more than one repository. Repository-level findings keep
their specific reasons, which the category explanation panel counts individually.

---

## Changing scoring safely

### The one rule

**Never introduce a signal that measures ability rather than presentation.** Stars, forks,
followers, contribution streaks, commit counts, issue volume, language "difficulty",
account age as a proxy for experience — all out of scope, whatever they would do to the
numbers. If a proposed rule cannot be stated as "a visitor cannot easily tell X", it does
not belong.

### Before you change a weight or a penalty

1. **Say which behavior you are trying to change and for whom.** Weights are a ranking
   between categories; raising one lowers everything else in relative terms.
2. **Check the repository weights and the profile weights.** They are different sets and
   both may need to move.
3. **Run `npm run eval`** and read the corpus-wide movement before running the tests.
4. **Run `npm test`.** The corpus asserts bands, orderings, and advice identity — not exact
   values — so a deliberate change should move `npm run eval` output substantially while
   breaking few or no tests. That split is intentional.
5. **A broken test is a claim you invalidated.** Read its message before editing it. If the
   test name says *records current behavior*, changing it is fine, but say so in the commit.
6. **Re-record the baseline** with `npm run eval -- --update` and commit the baseline diff in
   the same commit as the scoring change, so review sees both.

### Before you add a new finding

- Give it an `action` that is constant across repositories. Grouping keys on
  `category|action`, so an action containing repository-specific text produces one
  recommendation per repository and floods the five-item cap.
- Keep repository-specific detail in `reason`. If that detail quotes the repository's own
  measurements, pass a plural-safe `groupReason` as well, so the recommendation stays true
  once several repositories are grouped under it.
- Use `info` severity for anything the tool cannot verify. `info` findings never become
  advice.
- Add a corpus fixture that triggers it, or extend an existing persona. Every fixture
  repository carries a `note` explaining why it exists.

### Things that are not scoring changes

Renaming an action string changes the recommendation's identity, because the evaluation
harness derives keys from `category|action`. A pure wording change will show in
`npm run eval` as one recommendation removed and one added. That is expected, and it is why
the key includes a hash of the full action text.

---

## The evaluation corpus

13 synthetic profiles, 185 repositories, under `tests/scoring/`. Each profile is a coherent
account modeling a recognizable set of presentation conditions — never a bag of triggers, and
never a claim about a kind of developer.

| File | Purpose |
|---|---|
| `fixtures/builders.js` | Expands compact fixtures into exact GitHub REST payloads; rejects malformed fixtures loudly |
| `fixtures/index.js` | `PERSONAS` (9), `EDGE_CASES` (4), `CORPUS`, `getProfile(id)` |
| `harness.js` | `auditProfile` runs the real pipeline at a frozen `EVALUATION_DATE` of 2026-08-21 |
| `expectations.js` | Band and advice assertions that print the full ranked advice list on failure |
| `harness.test.js` (9), `personas.test.js` (31), `edge-cases.test.js` (9), `report.test.js` (15) | 64 tests |

Fixtures are authored at the **raw REST payload** boundary, so `transformRepository` stays
inside the tested surface.

### Personas

| id | repos | overall | exercises |
|---|---|---|---|
| `oss-maintainer` | 9 | 95 | Six pins suppress pin advice; over-long description; old but active repository |
| `polished-professional` | 6 | 94 | Curated baseline; pin candidates ranked by score |
| `fork-dominated` | 9 | 86 | Forks inherit upstream presentation; fork curation bonus (F2, F6) |
| `archive-heavy` | 10 | 85 | Archived maintenance floor; highest focus in the corpus (F7, F8, F11) |
| `prolific-account` | 112 | 76 | Ranking past 100 repositories; README metadata limit (F1, F11) |
| `student-coursework` | 8 | 73 | Clutter names; a weak pinned repository |
| `strong-work-weak-presentation` | 5 | 62 | Popularity recorded but never scored |
| `flagship-dominated` | 8 | 50 | Flat averaging: one perfect repository barely lifts the profile |
| `beginner-account` | 3 | 48 | Generic names, missing descriptions and READMEs; maintenance still 100 |

### Edge cases

| id | repos | overall | exercises |
|---|---|---|---|
| `unusual-metadata` | 4 | 80 | `pushed_at: null`, `NOASSERTION` license, over-long name (F10) |
| `private-audit-scope` | 6 | 81 | Authenticated mode: 4 private, 2 public, forced-empty pin list; private work excluded from pin advice |
| `unverified-metadata` | 5 | 84 | `supplemental === null`, the static-deployment path |
| `empty-account` | 0 | 0 | Nothing to audit (F5) |

### Deliberately not covered

Organization-owned repositories (structurally unreachable: `?type=owner` publicly, an
owner-login filter privately; already covered at the API layer). Monorepos (no such concept
in the implementation). Duplicate repositories across scopes (`combineRepositoryScopes`
affects Markdown export only). README key collisions (unreachable while both fetch paths are
owner-scoped). Profile READMEs (unmodeled — no fixture implies otherwise).

---

## Running and reading the evaluation

```bash
npm run eval
```

Diffs the corpus against `evaluation/baseline.json`.

```bash
npm run eval -- --full
```

Prints current outcomes with no comparison: a score table, then each profile's ranked advice.

```bash
npm run eval -- --update
```

Rewrites the baseline. Review the resulting file diff before committing it.

The report is **not a gate**. It exits 0 whether or not outcomes moved; a non-zero exit means
the report itself failed to run. CI runs it as an informational step after the tests, so a
pull request that changes scoring carries the corpus-wide movement in its log.

The one thing the test suite does assert about the baseline is that it still lists the same
profiles and the same evaluation date as the corpus — never the recorded scores. Weight
tuning is meant to move scores without breaking a build.

### Reading a regression

A clean run:

```
Scoring evaluation: 13 profiles, 185 repositories, evaluated at 2026-08-21
Baseline: evaluation/baseline.json

No corpus outcome changed.
```

Diff lines mean:

| Marker | Meaning |
|---|---|
| `overall 85 -> 79 (-6)` | The profile's overall score moved |
| `readme  72 -> 58 (-14)` | A category mean moved |
| `+ rank 2 [high] …` | Advice that was not in the previous top five |
| `- was rank 4 [medium] …` | Advice that dropped out of the top five |
| `~ … (rank 3 -> 5)` | Same advice, different rank, severity, or affected repositories |

**A broad, shallow, same-direction move is a weight change.** Raising the missing-license
penalty from 25 to 45 produces:

```
oss-maintainer  overall 95 -> 94 (-1)
  discoverability 90 -> 86 (-4)
...
beginner-account  overall 48 -> 44 (-4)
  discoverability 25 -> 5 (-20)

12 of 13 profiles changed. Mean overall 70 -> 68 (-2).
```

One category moves everywhere, hardest on the profiles already weakest in it. Nothing here
is surprising — the question to ask is whether the new spread is the one you wanted.

**A single profile with advice changes and no score change is a rule change.** Excluding
forks from pin candidates produces:

```
fork-dominated  overall 86 -> 86 (0)
  ~ [medium] Discoverability: Add three to five specific topics…  (rank 5 -> 4)
  - was rank 4  [medium] Portfolio focus: Consider pinning these projects…  (3 repos)
  + rank 5  [medium] Discoverability: Add an appropriate license…  (2 repos)
```

No score moved because pin advice is not scored. One profile changed because only one
persona has fork pin candidates. The `+` line is not new advice — it is advice promoted into
the top five by the removal above it.

**Anything you cannot explain is the interesting result.** A profile moving when your change
should not have touched it, or a profile not moving when it should have, is worth
understanding before committing.
