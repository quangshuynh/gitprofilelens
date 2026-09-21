# Scoring rationale

How the GitProfileLens score is calculated, what each part of it is claiming, what it deliberately refuses to claim, and how to change it without breaking the claim.

Everything here is derived from [`audit.js`](../audit.js). Where a rule looks like it does not match its apparent intent, this document says so rather than describing the intent as if the code implemented it. Those cases are collected in [Known limitations and open questions](#known-limitations-and-open-questions).

---

## What the score measures

**GitProfileLens measures how a GitHub profile presents itself to a visitor.** It scores the metadata a person browsing the account can see without reading any code: repository names, descriptions, README structure, topics, licenses, demo links, staleness, and how coherent the visible portfolio looks.

**It does not measure developer ability, engineering skill, code quality, employability, or intelligence.** No part of the pipeline reads source code, commit contents, test coverage, issue discussion, or contribution history. It cannot form an opinion about those things, and no change should give it one.

This is not a disclaimer bolted onto a general-purpose quality score. It is a structural property of the implementation, and it is worth stating what enforces it:

* **The only inputs are presentation metadata.** `transformRepository` (audit.js:298) normalizes the GitHub REST repository payload plus optional README structure and pin metadata. Nothing else reaches the scorer.
* **Popularity is recorded but never scored.** `stars`, `forks`, and `openIssues` are normalized and exported for the repository explorer and the JSON report, and no scoring function reads them. A repository with 40,000 stars and no description scores exactly the same as an identical repository with zero stars. This is asserted by a corpus test that rebuilds a profile with every popularity number zeroed and requires byte-identical output.
* **Every finding is about something the owner can edit in the GitHub UI.** Add a description, add topics, write a README section, archive a dead repository, pick a license. None of them require writing better software.

Consequently a low score means "this profile is hard for a visitor to read", not "this person is bad at their job". Treat any proposed rule that cannot be phrased that way as out of scope.

---

## The pipeline

There is no single "score a profile" entry point. Callers assemble four pure functions:

```text
raw GitHub REST repositories + supplemental metadata
  -> transformRepository(repository, supplemental)   audit.js:298
  -> scoreRepository(repository, now)                audit.js:380
  -> scoreProfile(audits)                            audit.js:451
  -> generateRecommendations(audits)                 audit.js:527
```

`scoreRepository` also attaches a portfolio candidate classification to each audit. It is derived from the finished audit and never changes it. See [Portfolio candidacy](#portfolio-candidacy).

The interface adds a fifth step that is not part of scoring:

```text
  -> optimizePinnedSet(audits)                       pinned-optimizer.js
```

It reads finished audits and writes to none of them. See [Pinned repository optimization](#pinned-repository-optimization).

`supplemental` carries README structure and the pinned repository list from the serverless metadata endpoint. It is `null` on deployments where that endpoint is unavailable, which is a distinct state from "the repository has no README". See [Unknown is not the same as absent](#unknown-is-not-the-same-as-absent).

Every function is deterministic given its inputs and the injected `now`. `scoreRepository` defaults `now` to `new Date()`, so production maintenance scores drift with wall-clock time; the evaluation corpus pins the date instead.

---

## Repository scoring

`scoreRepository` produces five category scores and combines them:

| Category        | Weight | Function                              |
| --------------- | -----: | ------------------------------------- |
| presentation    |   0.15 | `scoreName` (audit.js:133)            |
| descriptions    |   0.25 | `scoreDescription` (audit.js:80)      |
| readme          |   0.25 | `scoreReadme` (audit.js:171)          |
| discoverability |   0.20 | `scoreDiscoverability` (audit.js:232) |
| maintenance     |   0.15 | `scoreMaintenance` (audit.js:260)     |

Descriptions and READMEs carry half the weight between them. That is the implementation's strongest editorial position: the two things a visitor reads first, before deciding whether to open anything, matter more than everything else combined.

### presentation: the repository name

Starts at 100 and subtracts. Rewards short, lowercase, kebab-case, specific names.

| Condition                                                                            | Penalty | Severity | Filed under             |
| ------------------------------------------------------------------------------------ | ------: | -------- | ----------------------- |
| Name longer than 50 characters                                                       |     -20 | medium   | Repository presentation |
| Contains an underscore                                                               |     -10 | low      | Repository presentation |
| Contains an uppercase letter                                                         |      -5 | low      | Repository presentation |
| Matches `test`, `project`, `repo`, `demo`, `sample`, `hello-world`, ...              |     -40 | high     | Repository presentation |
| Contains `tutorial`, `practice`, `course`, `homework`, `assignment`, `lab2`, `test3` |     -15 | low      | **Portfolio focus**     |

The name is a discoverability surface: it appears in search results, in the pinned grid, and in every link to the project. A name that could belong to any repository tells a visitor nothing.

Note the last row. The clutter penalty is subtracted from the **presentation** score, but its finding is filed under the **Portfolio focus** category, because the advice is about whether the repository belongs in the portfolio at all rather than about its name. This is the one place where a category's score and its findings come from different places.

### descriptions: the one-line pitch

Starts at 100 and subtracts, except that a missing description short-circuits to zero.

| Condition                                                                | Result                           | Severity                   |
| ------------------------------------------------------------------------ | -------------------------------- | -------------------------- |
| Missing or whitespace-only                                               | **score 0**, returns immediately | high, or low when archived |
| Exactly `test`, `todo`, `tbd`, `wip`, `sample`, `demo`, ...              | -55                              | high                       |
| Otherwise matches a generic pattern (`a python app`, `web project`, ...) | -35                              | high                       |
| Fewer than 30 characters                                                 | -25                              | medium                     |
| More than 160 characters                                                 | -15                              | low                        |
| Begins with `(wip)`, `(broken)`, `(deprecated)`, `(archived)`            | -15                              | medium                     |
| Begins with a lowercase letter                                           | -5                               | low                        |

The placeholder and generic branches are mutually exclusive; every other penalty stacks. A 27-character lowercase description scores 70, not 100.

The zero for a missing description is the harshest single rule in the system. No other condition short-circuits a category to 0. What it lines up with: the description is the only text GitHub shows next to a repository in list views, search results, and the pinned grid. With it empty, a visitor has the name and nothing else.

The status-label rule (`(WIP) Ledger sync`) is not a judgment about unfinished work. It says GitHub already has dedicated mechanisms for that state, such as the archive flag and topics, and spending the description on it costs the one line that could have explained the project.

### readme: depth of explanation

The only category whose branches return fixed scores rather than accumulating penalties.

| Condition                                                  |                Score | Severity                   |
| ---------------------------------------------------------- | -------------------: | -------------------------- |
| `present === null`: README status unknown                  |                   60 | info                       |
| `present === false`: no root README                        |                   10 | high, or low when archived |
| Present, smaller than 500 bytes                            |                   55 | medium                     |
| Present, at least 500 bytes, no section analysis available |                  100 | none                       |
| Present, at least 500 bytes, analyzed                      | 35 + structure below | varies                     |

The analyzed path starts at 35 and adds:

| Signal                        | Points |
| ----------------------------- | -----: |
| Overview section              |    +15 |
| Installation or setup section |    +15 |
| Usage section                 |    +15 |
| Examples section              |    +10 |
| Contributing section          |     +5 |
| Contains a code block         |     +5 |
| Contains an image             |     +5 |
| Three or more headings        |     +5 |

Maximum 110, clamped to 100. The three core sections are worth 45 of the 75 points available above the floor, so the weights answer *what is this*, *how do I run it*, and *how do I use it* before anything else. Formatting polish, including a code block, image, and heading count, is worth 15 combined.

An unverifiable README scores 60 with an `info` finding rather than being treated as missing. `info` findings are filtered out of recommendations, so an unverified README never produces advice. The tool does not tell you to fix something it could not check.

The fixed score of 60 is itself an open question because unverifiable repositories still participate in the profile README mean. See [F12](#f12-unverified-readmes-impute-a-fixed-score).

### discoverability: can this be found and reused

Starts at 100 and subtracts.

| Condition                                           | Penalty | Severity |
| --------------------------------------------------- | ------: | -------- |
| No topics                                           |     -40 | medium   |
| No detected license                                 |     -25 | medium   |
| Web-language project with no homepage, not archived |     -15 | low      |

Topics are the heaviest single penalty here because they are the only structured way GitHub lets a repository be found by someone who was not already looking for it.

The homepage rule fires only when `language` is one of HTML, CSS, JavaScript, TypeScript, Vue, or Svelte. These are languages where a deployable demo is a reasonable expectation. It is skipped for archived repositories, since a retired project is not expected to be hosted.

### maintenance: is this still alive

Fixed scores by staleness, measured from `pushedAt` falling back to `updatedAt`.

| Condition                                   | Score | Severity |
| ------------------------------------------- | ----: | -------- |
| Archived                                    |    85 | none     |
| Timestamp unusable                          |    60 | info     |
| Not pushed in more than 3 years (1095 days) |    35 | medium   |
| Not pushed in more than 2 years (730 days)  |    65 | low      |
| Not pushed in more than 1 year (365 days)   |    85 | none     |
| Pushed within the last year                 |   100 | none     |

Archiving is the intended way to say "this is finished". A repository archived on purpose scores 85 and generates no maintenance advice, identical to a repository pushed eight months ago. Silence is what is being penalized, not age: a project that has not moved in three years with no signal about why leaves a visitor unable to tell finished from abandoned.

This is the only category that depends on the clock, and therefore the only one whose production score changes without anyone touching the profile.

---

## Profile scoring

`scoreProfile` averages each repository category across **every** repository, forks and archived repositories included, then adds a sixth category computed separately.

| Category        | Weight |
| --------------- | -----: |
| presentation    |   0.15 |
| descriptions    |   0.20 |
| readme          |   0.20 |
| discoverability |   0.20 |
| maintenance     |   0.15 |
| focus           |   0.10 |

Three consequences worth being explicit about:

1. **The profile weights are not the repository weights.** Descriptions and readme drop from 0.25 to 0.20 each to make room for focus. A repository's own score is therefore not the same formula as its contribution to the profile score.
2. **The overall score is not the mean of the repository scores.** It is a weighted combination of category means, which is a different number.
3. **Averaging is flat.** Every repository counts equally regardless of pin status, popularity, or recency. One excellent project among seven neglected ones barely moves the profile. The `flagship-dominated` corpus persona exists to make that visible and scores 50 with one repository at 100.

Flat averaging is consistent with the claim the score makes. It is about the portfolio a visitor encounters, and a visitor scrolling an account sees all of it. Whether it is the *intended* behavior is not recorded anywhere in the implementation, and `flagship-dominated` exists so that any change to it is visible rather than incidental.

### focus: does the portfolio read as coherent

`scorePortfolioFocus` (audit.js:420) is the only profile category not derived from repository audits:

```text
active           = repositories that are neither archived nor forked
concentration    = largest single-language group among active / count of active
curationBonus    = min(15, (total - active) * 2)
focus            = 55 + concentration * 30 + curationBonus
```

The floor is 55 and the ceiling is 100, except that a profile with no repositories scores 0.

Language concentration is a proxy for a portfolio that reads as being *about* something. The curation bonus rewards moving finished or borrowed work out of the active set, which is what archiving is for.

The curation bonus counts archived **and** forked repositories, which means forking raises focus. See [F2](#f2-forking-counts-as-curation).

---

## Recommendations

`generateRecommendations` turns per-repository findings into portfolio-level advice.

1. **Drop `info` findings.** Anything the tool could not verify produces no advice.
2. **Group by `category|action`.** Findings that recommend the same action merge into one recommendation carrying the list of affected repository names. The group keeps the first finding's `reason`, so a finding whose reason quotes its own measurements declares a plural-safe `groupReason` that is substituted once the group covers more than one repository.
3. **Append pin advice** after grouping, so portfolio advice never merges with per-repository advice.
4. **Rank** by `severityWeight * 100 + repositoryCount`, where high = 3, medium = 2, low = 1.
5. **Truncate to five.**

The cap is a hard limit, not a relevance threshold. Advice ranked sixth is discarded, however severe. See [F7](#f7-the-five-item-cap-can-hide-portfolio-advice).

### Pin advice

Two rules, both requiring verified pin metadata:

* **Weak pins:** any pinned repository scoring below 60 produces one `high` recommendation to improve or unpin them.
* **Pin candidates:** if fewer than 6 repositories are pinned, the three highest-scoring unpinned repositories scoring at least 85 produce one `medium` recommendation. Archived, private, and forked repositories are excluded. The suggestion names the work a visitor should notice first, and retired work is not what a profile leads with, private work is invisible to that visitor, and a fork's qualifying score measures its upstream author's presentation.

Pinning is the single highest-leverage presentation control GitHub offers: it decides what a visitor sees before they scroll. Six is GitHub's own limit.

This advice is separate from, and unchanged by, the [pinned repository optimizer](#pinned-repository-optimization). Pin advice ranks individual repositories by score inside the recommendation list; the optimizer selects a whole set from candidacy and factual evidence. Where they disagree, they are answering different questions, and neither was rewritten to agree with the other.

---

## Portfolio candidacy

The score and the candidate label answer different questions, and they are allowed to disagree.

| | Repository score | Portfolio candidacy |
| --- | --- | --- |
| Question | How well does this repository present itself? | Is this a good repository to feature prominently? |
| Output | 0–100 | `Strong candidate`, `Worth polishing`, `De-emphasize` |
| Reads | name, description, README, topics, license, demo, recency | the finished audit, plus fork status, archive status, and which evidence was verifiable |
| Computed by | `scoreRepository` (audit.js) | `classifyPortfolioCandidate` (audit.js) |

`scoreRepository` attaches `candidate` to the audit it returns. Candidacy reads the finished audit and adds a field; it never feeds back into `score`, `categoryScores`, or `findings`. Introducing it moved no corpus score.

### Why candidacy cannot be a score band

A band would carry no information the score does not already carry. The corpus contains repositories where the two orderings invert:

| Repository | Score | Candidacy |
| ---------- | ----: | --------- |
| `render-kit` (fork, complete upstream metadata) | 100 | Worth polishing |
| `legacy-api-gateway` (archived, comprehensive README) | 98 | Worth polishing |
| `tinyhttp` (fork, three years silent) | 88 | De-emphasize |
| `My_First_Website` (original, short README, no topics) | 63 | Worth polishing |

`tinyhttp` outscores `My_First_Website` by 25 points and is the weaker candidate. That is the behavior candidacy exists to express.

### Signals

Everything is derived from evidence the audit already holds. Nothing reads source code, commit ownership, upstream divergence, or contribution share.

```text
originality  = fork === false ? original : fork === true ? fork : unknown
readmeState  = formatReadmeStatus(repository.readme)
description  = categoryScores.descriptions
maintenance  = categoryScores.maintenance
plus archived, private, topics, license, homepage, and finding counts by severity
```

`pinned` is deliberately excluded. Pinning is the outcome of a candidacy decision rather than evidence for one, so reading it would make the label partly circular.

### Strong candidate

An affirmative claim about a specific repository, so every gate must be met by evidence that was actually verified:

1. `originality === original` — confirmed `fork: false`
2. Not archived
3. README verified present and substantive (`present` or `comprehensive`)
4. Description scoring at least 70
5. At least one topic
6. Maintenance at least 85, meaning pushed within roughly two years
7. No `high` findings and at most one `medium` finding
8. Score at least 75

Gate 8 is a backstop, not a band. Gates 1 through 7 already imply a score in the low eighties, so the threshold never decides a case on its own.

### De-emphasize

No score term appears in this decision. A repository is de-emphasized because of what is known about it, not because of where its score lands.

Weaknesses:

| | Condition |
| --- | --- |
| W1 | README verified absent |
| W2 | Description scoring below 70: missing, placeholder, or generic |
| W3 | Neither topics nor a license |
| W4 | Not archived and not pushed in more than three years |
| W5 | Archived |
| W6 | Confirmed fork |

De-emphasize when any of: two or more `high` findings; `W1 && W2`; `W4`; two or more weaknesses.

Everything else is **Worth polishing**, which is the honest default: a repository with a real foundation and named, fixable gaps.

### Forks

A confirmed fork can never be a Strong candidate, however well it presents. This is not a claim that forks are bad or that the owner wrote none of the code. GitHub's `fork` flag is the only authorship signal available, and it says only that a fork relationship exists. The explanation states exactly that limit:

> GitHub identifies this repository as a fork, and GitProfileLens cannot determine how much of the implementation belongs to the profile owner.

A fork with otherwise complete presentation is Worth polishing. A fork carrying a second weakness, such as three years of silence, is De-emphasize. The tool never asserts that a fork contains no original work, because it has no way to know.

This matches the reasoning already recorded in [F6](#f6-pin-candidates-can-be-other-peoples-work-fixed), which excluded forks from pin candidacy for the same reason.

### Archived repositories

Archived repositories are not hidden and not automatically de-emphasized. Archiving is an explicit statement that work is finished, and the score already treats it as better than silence. Candidacy treats it the same way: archival is one weakness, so a well-presented archive lands at Worth polishing with the reason stated plainly.

> It is archived, which makes it a weaker choice for prominent portfolio placement.

An archive carrying a second weakness is De-emphasize. Note the asymmetry with W4: an unexplained three-year gap de-emphasizes on its own, while a deliberate archive does not.

### Private repositories

Private repositories run through exactly the same rules. Privacy is not an input and cannot raise or lower a label. A strong private original project is a Strong candidate, and the explanation frames publishing as the owner's choice rather than an instruction:

> Privacy does not count against the work; this is a strong candidate if you intend to publish or showcase the project.

Nothing in candidacy suggests exposing private repository details, and private classifications appear only in the authenticated view.

### Unknown evidence

Unavailable data is never a weakness and never a failure. It cannot push a repository toward De-emphasize, and no explanation describes unverifiable data as absent. An unverified README produces no README clause at all, so the tool never says a README is missing when it could not check.

What it does do is block the affirmative Strong candidate claim, because a claim that specific cannot rest on evidence that was never verified. Such a repository lands at Worth polishing and carries an evidence qualifier:

> Some metadata unavailable

Three conditions set it: `readme.present === null`, `fork === null`, and an unusable update timestamp. The explanation names which one.

There is no numeric confidence score. The qualifier is a binary statement about whether every input was verifiable, which is the only thing the available evidence supports.

### Tension with portfolio focus

`scorePortfolioFocus` awards a curation bonus for archived and forked repositories ([F2](#f2-forking-counts-as-curation)), while candidacy counts both as weaknesses. This is a real disagreement and it is intended:

> Portfolio-focus scoring rewards profile curation — moving finished or borrowed work out of the active set. Candidate classification evaluates whether an individual repository is suitable for prominent portfolio presentation. A fork can raise profile focus and still not be a strong candidate.

The two operate at different levels. Focus asks whether the account as a whole reads as curated; candidacy asks whether one repository deserves to lead. Neither formula was changed to resolve this, and F2 remains open on its own terms.

### Changing candidacy safely

* Candidacy must stay derivable from the existing audit. A rule needing a new GitHub permission, a clone, or commit inspection is out of scope.
* Never let unknown evidence act as a weakness. That is the difference between "we could not check" and "it is not there", and the whole design depends on it.
* Every explanation clause must be backed by a signal that is true for that repository. `tests/audit.test.js` enforces this with a claim-to-evidence table; add a row when adding a clause.
* Candidacy is not recorded in `evaluation/baseline.json`, so `npm run eval` will not show a candidacy change. `tests/scoring/candidates.test.js` is the only corpus-wide guard. Update it deliberately.

---

## Pinned repository optimization

The optimizer answers a third question, distinct from the two above it.

| | Repository score | Portfolio candidacy | Pinned optimizer |
| --- | --- | --- | --- |
| Question | How well does this repository present itself? | Is this a good repository to feature prominently? | Which combination of repositories forms the strongest set? |
| Scope | One repository | One repository | The whole set |
| Output | 0–100 | `Strong candidate`, `Worth polishing`, `De-emphasize` | Up to six repositories, with the reason each entered |
| Computed by | `scoreRepository` (audit.js) | `classifyPortfolioCandidate` (audit.js) | `optimizePinnedSet` (pinned-optimizer.js) |

**The optimizer is not another repository score.** It reads finished audits and writes to none of them. No repository score, category score, finding, or candidacy label moves when it runs, which is asserted for every constructed fixture and for every corpus profile.

**GitProfileLens recommends a portfolio set from observable repository presentation and metadata. It does not measure engineering ability and does not determine how much code a profile owner authored within a fork.**

### The pin limit

GitHub's profile documentation states the limit directly: "Select up to six repositories and gists, combined." Six is therefore the invariant, and the product already encoded it in three places before this feature existed — `pinnedItems(first: 6)` in `api/github-metadata.js`, the `pinnedAudits.length < 6` gate in pin advice, and `MAXIMUM_PINNED_REPOSITORIES` in the corpus fixture builder. `pinned-optimizer.js` now carries the same constant with the documentation quoted beside it.

The optimizer recommends **up to** six, never exactly six. A profile with three repositories that meet the criteria is told so and is not offered three weak ones to fill the remaining slots.

### Eligibility

Eligibility is decided before any ranking, from candidacy and fact. A numeric score never makes a repository eligible.

| | Rule | Why |
| --- | --- | --- |
| E1 | Not classified `De-emphasize` | The label already states that this repository is a weak choice for prominent placement. No edge case in the corpus overrides it; the optimizer prefers recommending fewer. |
| E2 | Something verified that a visitor can read: a description scoring at least 70, or a README verified `present` or `comprehensive` | A pin is an affirmative claim that a visitor should look here first, and that claim needs something they can actually read. |
| E3 | No open `high` presentation finding on a `Worth polishing` repository | "Polish first" is only useful advice when the gap is minor. A high-severity gap is not. |
| E4 | Public | A private repository cannot be featured on a public profile. See [Private repositories](#private-repositories-in-the-optimizer). |

Rules are evaluated in that order, so each repository is reported under the reason that explains the most about it. Excluded repositories are listed in the interface with their reason, never silently dropped.

Note what is **not** an eligibility rule: archive status, fork status, and presentation score. Archived and forked repositories are eligible and are handled by ranking instead.

### Selection

Selection is greedy and lexicographic. There is **no internal utility score**: no weighted sum, no tuned coefficients, nothing that produces a number a user could mistake for a second repository score. Each step re-measures every remaining candidate against the set built so far and applies one total order:

1. **Candidacy tier.** Every `Strong candidate` is considered before any `Worth polishing` repository.
2. **Originality.** Confirmed original, then unreported fork status, then GitHub-identified fork.
3. **Archive status.** Active before archived.
4. **Redundancy.** Fewer earned breadth credits last; see below.
5. **Presentation score**, highest first.
6. **Maintenance score**, highest first.
7. **Verified metadata count**: topics, license, homepage, a comprehensive README, a description scoring 100.
8. **Repository name**, ascending, compared without locale collation.

Rule 8 makes the order total, so the recommendation never depends on the order GitHub returned repositories in. Reversing the audit array changes nothing, which is asserted across the whole corpus.

Because redundancy sits at rule 4, breadth can never promote a lower candidacy tier, a fork over an original, or an archive over an active repository. It only chooses among repositories that rules 1 through 3 already consider equally suitable.

### Redundancy and diversity

Only signals GitHub reports directly are compared. **GitProfileLens has no reliable project or domain categories, so it does not invent any.** There is no "backend", "mobile", or "DevOps" inference from README prose, and adding one would need an explicit, testable categorization step that does not exist yet.

Two signals are used:

* **Primary language.** A repository earns a breadth credit when it declares a language no already-selected repository declares.
* **Topics.** A repository earns a breadth credit when it declares topics and shares fewer than two of them with any already-selected repository. Two is deliberately conservative: GitHub topics are author-chosen keywords, not a taxonomy, and one shared topic such as `python` says very little.

Breadth is a **credit earned by verified distinctness**, never by absent data. A repository with no reported language and one with no topics earn no credit, because neither can demonstrate that it widens the set — the same rule candidacy applies to unknown evidence. It is not a penalty either: an unknown signal ranks exactly with a repeated one, never below it.

Homepage presence is recorded but is **not** a redundancy dimension. Two repositories both linking a demo is not a portfolio story overlap, so a homepage counts toward verified metadata at rule 7 and appears in an entry's reasons, and nothing more.

Language diversity is supporting evidence, not the goal. Six repositories in one language are not automatically a worse set than six in six languages, and the tie-break order above is what stops breadth from displacing substantially better-supported work.

### Forks

A GitHub-identified fork is eligible and is ranked below confirmed original work. It is never penalized in its presentation score, and the optimizer never claims the owner did no work in it. Every fork that enters a set carries the same sentence candidacy uses:

> GitHub identifies this repository as a fork, and GitProfileLens cannot determine how much of the implementation belongs to the profile owner.

A fork therefore cannot displace a confirmed original of comparable standing on score alone, which is what rule 2 exists for. It can still fill a set when nothing else is eligible: `fork-dominated` has no eligible original repositories at all, and receives six forks, each stating that limit.

Unreported fork status (`fork: null`) sits between the two. It is not recorded as confirmed original work and is not treated as a confirmed fork.

### Archived repositories

Archived repositories are eligible, are ranked below active ones, and keep their scores exactly as computed — archiving still raises maintenance to 85. An entry that made the set says so:

> It is archived, so it is recommended below comparable active repositories.

In `archive-heavy`, `legacy-api-gateway` scores above the active `bench-suite` and is recommended after it, which is the whole point of rule 3.

### Private repositories in the optimizer

Privacy is not a quality judgment and is not a candidacy input. A private repository can be a `Strong candidate`, and the optimizer keeps that judgment intact while separating two different statements:

* **Recommended portfolio project** — the work reads well.
* **Currently pinnable on a public GitHub profile** — a visitor can actually see it.

Private repositories are excluded from the recommended set and reported in their own section as strong work a public profile cannot pin. Nothing suggests publishing them. This section can only appear in the authenticated audit, because a public audit never sees a private repository.

### Missing evidence

Unknown evidence stays neutral, exactly as in candidacy. An unverified README is not a missing README and never pushes a repository out of the set on its own. What it does do is prevent affirmative claims: an entry with unverifiable evidence carries the `Some metadata unavailable` qualifier and a reason naming what could not be verified.

Pin state is a tri-state. When the supplemental metadata endpoint is unavailable, no repository reports a verified pin state, and the optimizer reports the current set as **unknown** rather than as empty. No comparison is offered, and the recommendation is unaffected. `unverified-metadata` covers this path.

### Current versus recommended

The useful output is the difference, not a list of six names. Four advisory actions are used, and none of them is phrased as an instruction or a verdict on the work:

| Action | When |
| --- | --- |
| `Keep` | Pinned and in the recommended set, with no named gaps |
| `Polish first` | Pinned and in the recommended set, with gaps the audit actually named |
| `Consider adding` | Recommended, not pinned, with nothing to replace |
| `Consider replacing` | Pinned, not recommended |

A replacement states the difference rather than asserting that one repository is better:

> Consider replacing legacy-notes with rust-engine. rust-engine is classified Strong candidate and adds Rust, which no other recommended repository represents, while legacy-notes did not meet the recommendation criteria.

When a pinned repository has no comparable suggestion to take its place, that is said plainly instead of inventing one. When the current pins already match the recommendation, as in `oss-maintainer`, the interface says so and produces no changes. Pin **order** is never treated as a difference: GitHub pin order is the owner's own arrangement, so the two sets are compared as sets.

### No circularity

Current pin state is read in exactly one place, `readCurrentPins`, and used for exactly one purpose: the comparison. It is never evidence that a repository deserves to be recommended, which is what would otherwise make a recommendation self-reinforcing once acted on. Candidacy excludes pin state for the same reason and continues to.

This is asserted behaviorally rather than by inspection: for every corpus profile, re-running the optimizer with every repository pinned, and again with none pinned, must produce the identical recommended set.

### Relationship to portfolio focus (F2)

The optimizer does **not** read `scorePortfolioFocus`, `scoreProfile`, or any profile-level score. [F2](#f2-forking-counts-as-curation) records that focus awards a curation bonus for archived and forked repositories while candidacy counts both as weaknesses. Feeding a profile-level score that rewards those two flags into a set selection built from repository-level candidacy that penalizes them would make the disagreement compound instead of resolve. F2 is unchanged and remains open on its own terms; the optimizer simply is not one of its consumers.

### Limitations

* **No project or domain categories.** Set-level reasoning is limited to language and topic overlap. A later interval could introduce explicit, deterministic project categorization; until then, the tool does not guess at one.
* **Topics are author-chosen.** Topic overlap is a hint about how two repositories read, not a statement about what they do.
* **Primary language is GitHub's own byte-count heuristic.** A polyglot repository reports one language, and the optimizer inherits that simplification.
* **Nothing is known about goals.** The tool cannot know which work someone wants to be known for, which is why every output is advisory.
* **Markdown export is untouched.** The optimizer is a UI feature in this interval. Exporting the recommended set is a possible later enhancement and was deliberately left out rather than bolted onto the existing repository export.

### Changing the optimizer safely

* Keep it lexicographic. If a weighted utility value ever becomes necessary, it must have documented components, a test per component, and must not be shown as a score.
* Never let unknown evidence earn a breadth credit or act as a weakness.
* Never read pin state outside the comparison.
* Never read a profile-level score.
* Run `npm run eval:pins` and inspect every changed line before recording a new baseline. Recommendations are not scoring outcomes, so `npm run eval` will not show them.

---

## How the categories interact

* **A missing description costs twice.** It zeroes the repository's description score, and because profile categories are flat means, it pulls the profile's description average down by up to `100 / repositoryCount`.
* **Archiving is a trade.** It raises maintenance to 85 and adds up to 15 focus points, but removes the repository from the active set that determines language concentration. For a single-language account, archiving can lower focus even while raising maintenance.
* **Name clutter is scored in one category and reported in another.** See [presentation](#presentation-the-repository-name).
* **Repository count dampens everything.** Each repository contributes `1/n` to every category mean. On a 112-repository account, fixing one repository perfectly is arithmetically invisible.
* **Severity and breadth compete in ranking, and breadth can win.** See [F1](#f1-breadth-can-outrank-severity).
* **Forks are judged, counted, and averaged like original work.** A fork inherits the upstream project's description, README, topics, and license, so a fork-heavy account inherits that project's presentation quality as if it were its own.
* **Unverified README metadata still affects the profile README mean.** See [F12](#f12-unverified-readmes-impute-a-fixed-score).
* **Profile focus and repository candidacy disagree about forks and archives, on purpose.** Focus rewards curating them out of the active set; candidacy counts them against featuring that repository first. See [Tension with portfolio focus](#tension-with-portfolio-focus).

---

## Assumptions

These are the beliefs the implementation is built on. They are defensible, not self-evident, and are the right things to argue about when proposing a change.

1. **A visitor's first impression is formed from metadata, not code.** The entire scope follows from this.
2. **Every repository on an account is part of the portfolio.** Flat averaging, forks and archives included.
3. **Explicit status beats implicit status.** Archived scores well; three years of silence does not.
4. **Consistency is presentation.** Kebab-case naming is scored even though nothing functional depends on it.
5. **Language concentration signals coherence.** A defensible proxy for a portfolio with a theme, and unfair to people who work across many stacks by design.
6. **Advice should be finite and ranked.** Five items, most severe and most widespread first.
7. **Unknown is not absent.** Unverifiable data stays silent in recommendations, though its current score treatment remains an open question.

### Unknown is not the same as absent

Three states, three behaviors:

| State            | `readme.present` |                  Score | Advice               |
| ---------------- | ---------------- | ---------------------: | -------------------- |
| Verified present | `true`           | 10 to 100 by structure | Structural advice    |
| Verified absent  | `false`          |                     10 | `high`: add a README |
| Not verifiable   | `null`           |                     60 | `info`: filtered out |

The same distinction applies to pins: `repository.pinned` is `null` when metadata is unavailable, and both pin rules require `true` or `false`, so a deployment without the metadata endpoint produces no pin advice rather than wrong pin advice.

In authenticated mode, public pin state comes from the public supplemental metadata fetch, while README metadata comes from the authorized repository fetch. This preserves the distinction between verified pin state and unavailable pin metadata without discarding private-repository README information.

---

## Known limitations and open questions

Behavior that is arguably wrong or still requires a design decision is recorded here and, where practical, pinned by tests marked *records current behavior*. Fixed findings remain documented because they explain why certain implementation constraints and regression tests exist.

Each finding names the corpus profile or test surface that exposed it.

### F1: Breadth can outrank severity

`severityWeight * 100 + repositoryCount` lets a medium finding on more than 100 repositories outrank a high one. `prolific-account` ranks two medium x 106 findings above a high x 3. Recorded via `SEVERITY_ORDERING_EXCEPTIONS` in `tests/scoring/personas.test.js`.

### F2: Forking counts as curation

`curationBonus = min(15, archivedOrForked * 2)` treats forks as curated-away work. `fork-dominated` scores focus 84, above `polished-professional` at 75.

Portfolio candidacy reads the same two flags in the opposite direction, which is documented and deliberate rather than a contradiction. See [Tension with portfolio focus](#tension-with-portfolio-focus). The focus formula is unchanged.

### F3: Recommendation order depends on audit order

`generateRecommendations` is order-dependent on ties: reversing the audit array swaps tied recommendations because grouping preserves first-encountered order. `scoreProfile` is explicitly order-independent. Unit-level; no persona depends on it.

### F4: README scoring cliff

`{present: true, size: 600}` scores 100 through the legacy no-`sections` path, but 35 once analyzed with no recognized sections. Better metadata can lower the score by 65 points. Unit-level.

### F5: Nothing and nothing-good score alike

`scoreProfile([])` returns overall 0, so an account with nothing to present reads identically to one presenting badly. Separately, profile READMEs are unmodeled: `username/username` is scored as an ordinary repository. Exposed by `empty-account`.

### F6: Pin candidates can be other people's work [FIXED]

`isStrongUnpinnedAudit` excluded archived repositories but not forks, so fork-heavy accounts were advised to pin projects they did not write as "the work you want visitors to notice first".

Resolved: forks are excluded from pin candidacy. A fork inherits its description, README, topics, and license from upstream, so the score qualifying it is not a measure of this account's presentation.

**This is the most arguable of the fixes.** GitHub does let you pin a fork, and people do legitimately showcase forks they maintain. The implementation has no divergence signal to tell a maintained fork from a one-click copy, so the rule is binary. The consequence, visible on `fork-dominated`, is that an account whose only strong repositories are forks now receives no pin suggestion at all. Reversing this is one line. Exposed by `fork-dominated`.

### F7: The five-item cap can hide portfolio advice

Portfolio-level advice competes with per-repository advice on a count-dominated scale. `archive-heavy` has a clear pin candidate whose advice lands around rank 9 and is never shown.

This behavior is documented but not currently asserted by a dedicated test. A ranking change could therefore cause the advice to surface without failing the suite.

### F8: Archived repositories still get high-severity content advice [FIXED]

Description and README scoring never consulted `archived`, so a repository archived in 2018 was told at `high` severity to add a README, ahead of the same gap on active projects.

Resolved: `scoreDescription` and `scoreReadme` take the archived flag. A missing description or README on retired work is reported at `low` severity with its own action text. The **scores are unchanged** because an archived repository is still listed on the profile, so the gap still costs presentation. Only the priority claim changed.

The separate action text is load-bearing. Recommendations group by `category|action` and keep the first finding's severity, so sharing an action between retired and active advice would make one group report a single severity for both. Exposed by `archive-heavy`.

### F9: Private and authenticated pin state could produce invalid pin metadata [FIXED]

Two related defects existed around authenticated audits.

First, private repositories were eligible for pin candidacy because `isStrongUnpinnedAudit` did not exclude them. A private repository can be scored normally, but it cannot be part of the public first impression that pin advice is intended to improve.

Resolved: private repositories are excluded from pin candidacy. Privacy changes what the tool points a visitor at, never how the repository itself is judged. Exposed by `private-audit-scope`.

Second, the browser-layer authenticated audit discarded the real public pin list by assembling supplemental metadata with `pinnedRepositories: []` even though the public pin list had already been fetched. This caused pinned public repositories in authenticated audit state to be represented as explicitly unpinned.

Resolved: authenticated audit assembly now reuses the public profile's verified pin list while retaining README metadata from the authorized fetch.

This second defect was **latent rather than user-visible at the time it was fixed**. Private mode does not currently render recommendation or pin surfaces, so the incorrect pin state did not produce live pin suggestions or suppress weak-pin advice. Browser-level coverage asserts the assembled authenticated audit state so the defect cannot become user-visible if those surfaces are later enabled.

### F10: `NOASSERTION` passes as a license

GitHub returns `spdx_id: "NOASSERTION"` for a license file it cannot identify. `scoreDiscoverability` only checks presence, so it passes with no finding. Exposed by `unusual-metadata`.

### F11: Merged advice displays one repository's specifics [FIXED]

Findings group by `category|action`, and the group kept the **first** finding's `reason`, which the UI renders directly above the affected repository list. Reasons that embed per-repository numbers were therefore wrong for every repository after the first.

Resolved: a finding may now declare a plural-safe `groupReason`, and `summarizeRecommendation` substitutes it once a group covers more than one repository. Repository-level findings keep their specific reasons, which the category explanation panel counts individually.

### F12: Unverified READMEs impute a fixed score

An unverifiable README receives a fixed score of 60. Public README metadata is only available for the repositories covered by the supplemental metadata query, so sufficiently large accounts can contain repositories whose README state is unknown because of the tool's own retrieval boundary rather than because of anything the profile owner did.

On `prolific-account`, 12 repositories are unverifiable. The verified repositories have a README mean of 88, while including the fixed 60 values lowers the profile README mean to 85.

The fixed score is therefore not neutral relative to the account. It penalizes an otherwise strong README set and can reward an otherwise weak one.

A likely alternative is to exclude unverifiable repositories from the profile README mean rather than imputing a score. That requires a separate decision for the all-unverifiable case represented by `unverified-metadata`, so the behavior remains unchanged for now.

---

## Changing scoring safely

### The one rule

**Never introduce a signal that measures ability rather than presentation.** Stars, forks, followers, contribution streaks, commit counts, issue volume, language "difficulty", and account age as a proxy for experience are all out of scope, whatever they would do to the numbers. If a proposed rule cannot be stated as "a visitor cannot easily tell X", it does not belong.

### Before you change a weight or a penalty

1. **Say which behavior you are trying to change and for whom.** Weights are a ranking between categories; raising one lowers everything else in relative terms.
2. **Check the repository weights and the profile weights.** They are different sets and both may need to move.
3. **Run `npm run eval`** and read the corpus-wide movement before running the tests.
4. **Run `npm test`.** The corpus asserts bands, orderings, and advice identity, not exact values, so a deliberate change should move `npm run eval` output substantially while breaking few or no tests. That split is intentional.
5. **A broken test is a claim you invalidated.** Read its message before editing it. If the test name says *records current behavior*, changing it is fine, but say so in the commit.
6. **Re-record the baseline** with `npm run eval -- --update` and commit the baseline diff in the same commit as the scoring change, so review sees both.

### Before you add a new finding

* Give it an `action` that is constant across repositories. Grouping keys on `category|action`, so an action containing repository-specific text produces one recommendation per repository and floods the five-item cap.
* Keep repository-specific detail in `reason`. If that detail quotes the repository's own measurements, pass a plural-safe `groupReason` as well, so the recommendation stays true once several repositories are grouped under it.
* Use `info` severity for anything the tool cannot verify. `info` findings never become advice.
* Add a corpus fixture that triggers it, or extend an existing persona. Every fixture repository carries a `note` explaining why it exists.

### Things that are not scoring changes

Renaming an action string changes the recommendation's identity because the evaluation harness derives keys from `category|action`. A pure wording change will show in `npm run eval` as one recommendation removed and one added. That is expected, and it is why the key includes a hash of the full action text.

---

## The evaluation corpus

13 synthetic profiles, 185 repositories, under `tests/scoring/`. Each profile is a coherent account modeling a recognizable set of presentation conditions, never a bag of triggers and never a claim about a kind of developer.

| File                                                                                            | Purpose                                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `fixtures/builders.js`                                                                          | Expands compact fixtures into exact GitHub REST payloads; rejects malformed fixtures loudly |
| `fixtures/index.js`                                                                             | `PERSONAS` (9), `EDGE_CASES` (4), `CORPUS`, `getProfile(id)`                                |
| `harness.js`                                                                                    | `auditProfile` runs the real pipeline at a frozen `EVALUATION_DATE` of 2026-08-21           |
| `expectations.js`                                                                               | Band and advice assertions that print the full ranked advice list on failure                |
| `harness.test.js` (9), `personas.test.js` (32), `edge-cases.test.js` (9), `report.test.js` (15) | 65 scoring tests                                                                            |
| `candidates.test.js` (10)                                                                       | Portfolio candidacy across the corpus, including the fork, archive, private, and unverified falsification cases |
| `pinned-sets.test.js` (12)                                                                      | Pinned optimizer across the corpus: de-emphasize, private, fork, archive, shortfall, already-optimal, determinism, and the no-circularity property |

Fixtures are authored at the **raw REST payload** boundary, so `transformRepository` stays inside the tested surface.

The complete project test suite currently includes additional API and browser coverage outside this scoring corpus. The authenticated pin-state regression is covered at the browser layer because it occurs while authenticated audit data is assembled, before the pure scoring pipeline receives it.

### Personas

| id                              | repos | overall | exercises                                                                                           |
| ------------------------------- | ----: | ------: | --------------------------------------------------------------------------------------------------- |
| `oss-maintainer`                |     9 |      95 | Six pins suppress pin advice; over-long description; old but active repository                      |
| `polished-professional`         |     6 |      94 | Curated baseline; pin candidates ranked by score                                                    |
| `fork-dominated`                |     9 |      86 | Forks inherit upstream presentation; fork curation bonus; forks excluded from pin advice (F2)       |
| `archive-heavy`                 |    10 |      85 | Archived maintenance floor; highest focus in the corpus; retired work scored but deprioritized (F7) |
| `prolific-account`              |   112 |      76 | Ranking past 100 repositories; README metadata limit (F1, F11, F12)                                 |
| `student-coursework`            |     8 |      73 | Clutter names; a weak pinned repository                                                             |
| `strong-work-weak-presentation` |     5 |      62 | Popularity recorded but never scored                                                                |
| `flagship-dominated`            |     8 |      50 | Flat averaging: one perfect repository barely lifts the profile                                     |
| `beginner-account`              |     3 |      48 | Generic names, missing descriptions and READMEs; maintenance still 100                              |

### Edge cases

| id                    | repos | overall | exercises                                                                                  |
| --------------------- | ----: | ------: | ------------------------------------------------------------------------------------------ |
| `unusual-metadata`    |     4 |      80 | `pushed_at: null`, `NOASSERTION` license, over-long name (F10)                             |
| `private-audit-scope` |     6 |      81 | Authenticated scope: 4 private, 2 public; private work excluded from public pin advice     |
| `unverified-metadata` |     5 |      84 | `supplemental === null`, the static-deployment path and all-unverifiable README case (F12) |
| `empty-account`       |     0 |       0 | Nothing to audit (F5)                                                                      |

### Deliberately not covered

Organization-owned repositories are structurally unreachable through the audited paths: `?type=owner` publicly and an owner-login filter privately, already covered at the API layer. Monorepos have no such concept in the implementation. Duplicate repositories across scopes affect `combineRepositoryScopes` and Markdown export rather than scoring. README key collisions are unreachable while both fetch paths are owner-scoped. Profile READMEs are unmodeled, so no fixture implies otherwise.

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

The report is **not a gate**. It exits 0 whether or not outcomes moved; a non-zero exit means the report itself failed to run. CI runs it as an informational step after the tests, so a pull request that changes scoring carries the corpus-wide movement in its log.

The one thing the test suite does assert about the baseline is that it still lists the same profiles and the same evaluation date as the corpus, never the recorded scores. Weight tuning is meant to move scores without breaking a build.

### Reading a regression

A clean run:

```text
Scoring evaluation: 13 profiles, 185 repositories, evaluated at 2026-08-21
Baseline: evaluation/baseline.json

No corpus outcome changed.
```

Diff lines mean:

| Marker                      | Meaning                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `overall 85 -> 79 (-6)`     | The profile's overall score moved                               |
| `readme 72 -> 58 (-14)`     | A category mean moved                                           |
| `+ rank 2 [high] ...`       | Advice that was not in the previous top five                    |
| `- was rank 4 [medium] ...` | Advice that dropped out of the top five                         |
| `~ ... (rank 3 -> 5)`       | Same advice, different rank, severity, or affected repositories |

**A broad, shallow, same-direction move is a weight change.** Raising the missing-license penalty from 25 to 45 produces:

```text
oss-maintainer  overall 95 -> 94 (-1)
  discoverability 90 -> 86 (-4)
...
beginner-account  overall 48 -> 44 (-4)
  discoverability 25 -> 5 (-20)

12 of 13 profiles changed. Mean overall 70 -> 68 (-2).
```

One category moves everywhere, hardest on the profiles already weakest in it. Nothing here is surprising. The question to ask is whether the new spread is the one you wanted.

**A single profile with advice changes and no score change is a rule change.** Excluding forks from pin candidates produces:

```text
fork-dominated  overall 86 -> 86 (0)
  ~ [medium] Discoverability: Add three to five specific topics... (rank 5 -> 4)
  - was rank 4 [medium] Portfolio focus: Consider pinning these projects... (3 repos)
  + rank 5 [medium] Discoverability: Add an appropriate license... (2 repos)
```

No score moved because pin advice is not scored. One profile changed because only one persona has fork pin candidates. The `+` line is not new advice. It is advice promoted into the top five by the removal above it.

**Anything you cannot explain is the interesting result.** A profile moving when your change should not have touched it, or a profile not moving when it should have, is worth understanding before committing.

### Evaluating pinned recommendations

```bash
npm run eval:pins
```

Diffs the corpus recommendations against `evaluation/pinned-baseline.json`, with `--full` and `--update` behaving as above.

This is a **separate** report on purpose. `npm run eval` records scoring outcomes, and a pinned recommendation is not a scoring outcome: the optimizer reads finished audits and changes none of them. Keeping them apart means a selection change cannot read as a scoring regression, and cannot tempt anyone into recording a new scoring baseline to settle a recommendation question.

For each profile it records the eligible count, the recommended names and their candidacy labels, the current pinned overlap, any forks, archived, or `Worth polishing` repositories selected, the diversity evidence each selection earned, the exclusion counts by reason, and the advisory changes. `De-emphasize` selections are recorded too, and the corpus asserts that the list is always empty.

Before recording a new baseline, run `--full`, read every recommendation, and account for anything surprising: an optimizer bug, a candidacy limitation, a corpus limitation, or evidence the corpus does not carry. Do not snapshot a recommendation you cannot explain.
