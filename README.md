<p align="center">
  <img src="docs/images/logo.png" alt="GitProfileLens logo" width="280" />
</p>

# GitProfileLens

[![CI](https://github.com/quangshuynh/gitprofilelens/actions/workflows/ci.yml/badge.svg)](https://github.com/quangshuynh/gitprofilelens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/Live-Demo-238636)](https://gitprofilelens.vercel.app/)

## What's your GitHub portfolio score?

GitProfileLens turns a public GitHub profile into a transparent 0–100 presentation score with actionable recommendations. Public audits require no login. An optional GitHub App connection can also audit authorized private repositories and identify projects worth preparing for a public portfolio.

GitProfileLens evaluates presentation and discoverability, not developer ability, employability, code quality, or engineering skill.

### [Try the live audit →](https://gitprofilelens.vercel.app/)

![Completed GitProfileLens audit showing an overall portfolio score, category scores, and prioritized recommendations](docs/images/gitprofilelens-audit.png)

## Two deliberately separate modes

### Public Portfolio Audit

Enter any GitHub username without signing in. The public audit:

- Fetches every public repository owned by the account.
- Calculates the public GitHub Profile Score and six explainable categories.
- Audits names, descriptions, READMEs, topics, licenses, demos, and maintenance.
- Ranks actionable portfolio recommendations.
- Classifies each repository as a portfolio candidate, separately from its score.
- Supports shareable `?user=USERNAME` links and downloadable score cards.
- Explores public repository metadata and exports it to Markdown.
- Provides the public JSON endpoint `GET /api/report?user=USERNAME`.

### Private Repository Audit

Sign in with GitHub and install the GitHub App on all or selected repositories. The private audit:

- Retrieves only repositories available to both the signed-in user and the app installation.
- Focuses on repositories owned by the signed-in account.
- Reuses the deterministic repository presentation checks.
- Labels each repository as Private or Public.
- Applies the same portfolio candidacy classification used by the public audit, so private work can be evaluated as a potential portfolio project.
- Exports Markdown containing public repositories, authorized private repositories, or both.

Private repositories never affect the public GitHub Profile Score. Private identifiers are not included in public URLs, score cards, public metadata endpoints, or `/api/report`. Private details enter Markdown only when the authenticated user explicitly selects a private or combined export.

## Followers / Following export

A separate utility, reachable from the **Followers / Following** link on the homepage and in the audit header, or directly at `?tool=network`. Enter a GitHub username and it exports that account's public follower and following lists as Markdown.

- It reads only publicly accessible follower and following data from GitHub's public REST API.
- It runs independently of repository auditing. No audit is required first, and running it does not change an existing audit, score, candidacy, repository selection, or repository Markdown export. When an audit is already loaded, its username is prefilled as a convenience.
- Both lists are paginated at 100 accounts per request until GitHub returns a short page, so the export is not limited to the first 30 or 100 accounts.
- **Copy Markdown** and **Download .md** appear only after both lists are retrieved completely. If a later page fails, the partial list is shown for diagnosis and clearly labeled incomplete, and no export is produced.
- GitHub relationship data can change while an export is being generated. When the profile's reported counts disagree with the retrieved lists, the export uses the accounts GitHub actually returned, never invented ones, and states the difference.
- Accounts are listed in the order GitHub returned them; they are not re-sorted.
- This is an export utility only. GitProfileLens does not score, rank, or recommend followers, does not suggest who to follow or unfollow, and never follows or unfollows anyone.

The downloaded file is generated in the browser from a sanitized username, for example `quangshuynh-followers-following.md`. Nothing is sent to another server to produce it.

## How scoring works

The deterministic scoring engine lives in `audit.js` and is shared by the browser, serverless routes, and tests. Each repository receives scores for:

- Repository presentation: name clarity and consistency.
- Descriptions: specificity, useful length, placeholder text, and basic polish.
- README quality: presence, useful length, overview, setup, usage, examples, code samples, visuals, and contribution guidance.
- Discoverability: topics, license, and a demo link where useful.
- Maintenance: push recency while treating archived projects as intentionally complete.

The public profile score aggregates those repository results and adds portfolio focus. Every finding includes a severity, reason, suggested action, and a factual or advisory classification. Unknown README data receives a neutral score and is marked unverified.

Fork status comes directly from GitHub's repository metadata: `fork: true` means GitHub identifies the repository as a fork. GitProfileLens does not infer fork status or estimate how much work the profile owner contributed. Forks remain auditable and are not given an automatic quality penalty; their presentation score describes repository metadata and README quality, not authorship of inherited content.

## Portfolio candidacy

Alongside the score, every audited repository receives a deterministic candidacy label answering a different question: **is this a good repository to feature prominently?**

| Label | Meaning |
| --- | --- |
| **Strong candidate** | Confirmed original work, verified and substantive README, meaningful description, discoverable, reasonably current, no major presentation findings |
| **Worth polishing** | A real foundation with named, fixable gaps, or a repository whose candidacy cannot be asserted outright |
| **De-emphasize** | Severe presentation gaps, unexplained abandonment, or several weaknesses together |

The label is **not** a score band. A fork can score 100 and still be Worth polishing; an original repository scoring 63 can be Worth polishing too. Each label carries a one-line explanation derived from that repository's own evidence.

- **Forks.** A GitHub-identified fork is never a Strong candidate on presentation alone. GitProfileLens cannot determine how much of the implementation belongs to the profile owner, so it says exactly that rather than claiming the owner did no work. Forks are not called bad and are not hidden.
- **Archived repositories.** Not hidden and not automatically de-emphasized. A well-presented archive is classified honestly, with archival status named as the reason it is a weaker choice to lead with.
- **Private repositories.** Judged by identical rules. Privacy never counts against a project, and a strong private original project can be a Strong candidate for future public presentation. GitProfileLens does not suggest exposing private details.
- **Unavailable metadata.** Unknown is never treated as missing. An unverified README is never described as absent, and unavailable evidence cannot push a repository toward De-emphasize. It does prevent an outright Strong claim, which is shown as `Some metadata unavailable`.

Candidacy is derived from the finished audit and never changes the score. Classification does not read source code, commit ownership, upstream divergence, or contribution share, and requires no additional GitHub permissions.

[docs/scoring.md](docs/scoring.md) documents every rule and weight, the full candidacy rules, what the score intentionally does not measure, known limitations, and how to change scoring safely.

## Privacy and authentication

GitProfileLens uses the GitHub App web authorization flow and requests read-only repository access. Users choose which repositories the app may access through GitHub's installation interface.

- GitHub access and refresh tokens are encrypted with AES-256-GCM inside an `HttpOnly`, same-site session cookie.
- Production cookies use `Secure` and expire after eight hours.
- OAuth requests use unpredictable, short-lived state values that are verified before callback processing.
- Authenticated endpoints send private, no-store cache headers and are not eligible for shared CDN caching.
- Browser JavaScript receives only safe sign-in identity data, never raw tokens or session secrets.
- Private repository responses are processed for the current request and are not permanently stored by GitProfileLens.
- Private Markdown reports are generated locally in the browser and cleared from page state on logout.
- Logout clears the GitProfileLens session cookie. It does not sign the user out of GitHub.

The server necessarily receives authorized GitHub API responses while producing an audit. Avoid granting the GitHub App access to repositories you do not want GitProfileLens to process.

## JSON report API

The JSON API remains public-only:

```text
GET /api/report?user=quangshuynh
```

It returns normalized public repository metadata and never uses the signed-in browser session to add private data. The endpoint requires the server-side `GITHUB_TOKEN`.

The response distinguishes repositories owned by the requested account from external contributed repositories:

- `repositories` contains public repositories owned by the account. `public_repositories` is always the length of this array.
- `pinned_repositories` contains only profile pins from those owned repositories.
- `contributed_repositories` contains public repositories owned by someone else where GitHub attributes at least one merged pull request to the requested account.

External contributions are informational. They are not added to owned repositories or pins, exported as owned work, or included in the portfolio score because the contributor may not control the repository's presentation and maintenance. Discovery uses authored public pull requests, groups them by repository, and reports both total authored and merged counts; v1 requires at least one merged pull request for inclusion. It does not infer contributions from membership, stars, watches, or forks.

Only normalized public fields are returned. Private repository and pull-request details are excluded. Contribution discovery is bounded to GitHub Search's first 1,000 results and may be incomplete for unusually prolific accounts or when GitHub Search indexing lags. If this supplemental lookup fails or is rate-limited, the owned-repository report remains available with `contributed_repositories: []`.

Example contribution entry:

```json
{
  "owner": "hymical",
  "name": "forms",
  "full_name": "hymical/forms",
  "url": "https://github.com/hymical/forms",
  "description": "Repository description",
  "primary_language": "Python",
  "stars": 0,
  "forks": 0,
  "contribution": {
    "pull_requests": 4,
    "merged_pull_requests": 4
  }
}
```

## Local setup

The anonymous public experience has no client build step:

```bash
git clone https://github.com/quangshuynh/gitprofilelens.git
cd gitprofilelens
python -m http.server 8000
```

Open `http://localhost:8000`. README and pinned-repository checks are marked unverified when the Vercel functions are unavailable.

### Full local setup

Install the Vercel CLI, create `.env.local`, and run `vercel dev`:

```text
GITHUB_TOKEN=your_public_metadata_token
GITHUB_APP_CLIENT_ID=your_github_app_client_id
GITHUB_APP_CLIENT_SECRET=your_github_app_client_secret
GITHUB_APP_CALLBACK_URL=http://localhost:3000/api/auth/callback
GITHUB_APP_INSTALL_URL=https://github.com/apps/YOUR_APP_SLUG/installations/new
SESSION_SECRET=at_least_32_random_characters
```

```bash
vercel dev
```

Add `http://localhost:3000/api/auth/callback` as an additional callback URL in the GitHub App while testing locally. The value of `GITHUB_APP_CALLBACK_URL` must exactly match the callback used by that environment.

Never commit `.env.local`, client secrets, access tokens, refresh tokens, or session secrets. Local environment files and `.vercel` are ignored by Git.

## GitHub App configuration

Create a GitHub App in GitHub Settings under Developer settings, then use these values:

| Setting | Value |
| --- | --- |
| GitHub App name | `GitProfileLens`, or another available name |
| Homepage URL | `https://gitprofilelens.vercel.app/` |
| Callback URL | `https://gitprofilelens.vercel.app/api/auth/callback` |
| Callback wildcard matching | Disabled |
| Request user authorization during installation | Disabled |
| Setup URL | `https://gitprofilelens.vercel.app/` |
| Redirect on update | Enabled |
| Webhook | Disabled |
| Where can this GitHub App be installed? | Any account for a public app, or only your account for personal testing |

Repository permissions:

- **Metadata:** Read-only. GitHub may apply this automatically.
- **Contents:** Read-only. This is required to retrieve root README content.
- Every other repository and organization permission: **No access**.
- Subscribe to no webhook events.

Under the GitHub App's Optional Features, keep **User-to-server token expiration** enabled. GitHub's expiring access tokens last eight hours and can be refreshed by the server.

After creating the app:

1. Generate a client secret.
2. Copy the Client ID, not the numeric App ID, into `GITHUB_APP_CLIENT_ID`.
3. Set `GITHUB_APP_INSTALL_URL` to `https://github.com/apps/YOUR_APP_SLUG/installations/new`.
4. Install the app and select either all repositories or only selected repositories.
5. Do not generate or upload a private key. This feature uses user access tokens and does not authenticate as the app installation itself.

## Vercel environment variables

Configure these in the Vercel project settings for Production:

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Existing server-only token for public pin and README enrichment |
| `GITHUB_APP_CLIENT_ID` | GitHub App Client ID |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App client secret |
| `GITHUB_APP_CALLBACK_URL` | `https://gitprofilelens.vercel.app/api/auth/callback` |
| `GITHUB_APP_INSTALL_URL` | `https://github.com/apps/YOUR_APP_SLUG/installations/new` |
| `SESSION_SECRET` | Random secret of at least 32 characters used to derive the session-encryption key |

Redeploy after changing environment variables. Preview deployments need their own exact callback URL registered with GitHub, so use the stable production domain for routine authentication testing.

## Architecture

```text
gitprofilelens/
|-- api/
|   |-- auth/
|   |   |-- authenticated-session.js # decrypts and refreshes server-side session material
|   |   |-- callback.js              # verifies state and completes GitHub authorization
|   |   |-- github.js                # starts GitHub authorization
|   |   |-- logout.js                # clears authentication cookies
|   |   |-- session-crypto.js        # authenticated encryption and cookie helpers
|   |   `-- session.js               # safe browser authentication state
|   |-- github-metadata.js           # public GraphQL enrichment and README analysis
|   |-- pinned-repositories.js       # public supplemental metadata endpoint
|   |-- private-repositories.js      # authenticated authorized-repository endpoint
|   `-- report.js                    # public-only JSON report endpoint
|-- tests/                            # unit, API, security, and browser tests
|-- audit.js                          # deterministic scoring and normalization
|-- index.html                        # accessible application structure
|-- network-export.js                 # public follower and following retrieval and Markdown
|-- share.js                          # pure sharing and score-card helpers
|-- script.js                         # browser state, fetching, rendering, and isolation
|-- styles.css                        # responsive visual system
`-- package.json                      # test and syntax-check scripts
```

The public supplemental endpoints may cache successful public responses briefly. Authentication and private repository endpoints use `private, no-store` responses. The application has no database, saved audit history, repository cloning, source-code analysis, webhooks, or background jobs.

## Tests

```bash
npm test
npm run check
npm run test:browser
```

Tests cover deterministic scoring, portfolio candidacy classification, public report isolation, OAuth state verification, encrypted session behavior, logout, authorized-repository pagination, owner filtering, README analysis, safe GitHub errors, private cache headers, three-scope Markdown export, follower and following pagination with partial-failure and stale-response handling, and browser-level isolation from public scoring, sharing, score cards, and URLs.

## Deployment options

### Vercel

Vercel is required for the full public metadata and private GitHub App features. Configure all documented environment variables before deployment.

### GitHub Pages

GitHub Pages can host only the static public client. Public repository fetching, basic auditing, sharing, and Markdown export work, but serverless README enrichment, the JSON API, and private repository authentication do not.

## Limitations

- Unauthenticated public REST requests have a lower GitHub rate limit.
- The public GraphQL README query covers the first 100 public repositories and common root README filenames.
- Private auditing retrieves the preferred root README but does not clone repositories or analyze source code.
- The private view currently focuses on repositories owned by the signed-in user, not organization administration.
- Private report APIs, saved audits, and combined public/private scores are intentionally excluded. Private Markdown export is available only through the authenticated browser view.
- README structure and size are presentation signals and cannot determine writing or implementation quality.
- A public share URL re-fetches current public data; no audit snapshot is stored.
- The Followers / Following export sees only what GitHub's public API returns. Accounts GitHub does not expose publicly are not retrievable, and lists can change between the profile request and the last page.
- The Followers / Following export retrieves at most 10,000 accounts per list; a larger network is reported as incomplete rather than silently truncated.

## Contributing

Think a scoring rule should work differently? [Start a discussion](https://github.com/quangshuynh/gitprofilelens/discussions) or [open an issue](https://github.com/quangshuynh/gitprofilelens/issues) with a concrete example and rationale.

1. Create a focused branch.
2. Keep scoring changes deterministic and document their rationale.
3. Add or update behavior-focused tests.
4. Run `npm test`, `npm run check`, and `npm run test:browser`.
5. Open a pull request describing user-facing changes and tradeoffs.

## License

Feel free to use, modify, and build on this project under the [MIT License](LICENSE).
