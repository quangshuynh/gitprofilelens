# Managing who you follow

GitProfileLens can unfollow a GitHub account on your behalf. This document
records exactly what that capability is, what it is not, and what it costs,
because a feature that changes someone's GitHub account deserves to be written
down rather than discovered.

The short version:

- GitProfileLens **never unfollows anyone automatically**, on any schedule, in
  any batch, or as a side effect of anything else.
- Every unfollow is one account, chosen and confirmed by you, one at a time.
- There is no "Unfollow all", no selection, no queue, and no cleanup mode. These
  are deliberate non-goals, not features waiting to be built.
- The GitHub access token never reaches browser JavaScript. It never has, and
  this feature did not change that.

## What "Following who don't follow back" means

It means exactly one thing:

> You currently follow this account, and it was not in the followers list GitHub
> returned.

That is a relationship difference. It is not a judgement, and GitProfileLens
does not present it as one. GitProfileLens **cannot know why** an account does
not follow back and does not guess: there is no scoring, no ranking, no "fake
follower" classification, and no recommendation about who to unfollow.

The difference is only computed when **both** lists were retrieved completely.
An account missing from a partial followers list may simply sit on a page that
never arrived, and calling that account a non-follower would be unsound. The
manager inherits that rule and is withheld entirely when either retrieval is
incomplete — offering to end relationships on the strength of a guess is the
worst possible place to be approximate.

## The GitHub API contract

From GitHub's REST documentation for users and followers:

| Concern | Value |
| --- | --- |
| Unfollow | `DELETE /user/following/{username}` |
| Success | `204 No Content` |
| Documented failures | `304`, `401`, `403`, `404` |
| Check whether you follow someone | `GET /user/following/{username}` |
| Check result | `204` followed, `404` not followed |
| GitHub App permission | Account permission **Followers**, at **write** level for the `DELETE`, read for the `GET` |
| Classic OAuth equivalent | `user:follow` scope — not used by GitProfileLens |
| Acts as | The authenticated user, always |
| Primary rate limit | 5,000 requests per hour for an authenticated user |
| Secondary rate limit | Writes cost 5 points against 900 points per minute, and count against 80 content-generating requests per minute and 500 per hour |
| Rate-limit signals | `403` or `429`, with `retry-after` or an exhausted `x-ratelimit-remaining` |

GitHub's Acceptable Use Policies prohibit automated bulk activity and rank
abuse, including automated following. A tool that worked through a list of
accounts on the reader's behalf would be doing exactly that, whatever it was
called. This is the central reason the manager has no bulk action and performs
no retries of its own.

### Why the read happens before the write

`DELETE /user/following/{username}` answers `204` whether or not you were
following that account. Without a preceding read, "I just unfollowed them" and
"I had already stopped following them last week on github.com" are literally the
same response, and the interface would have to guess which it was.

So GitProfileLens reads first. The read:

- distinguishes a real unfollow from a page that went stale while you looked at
  it, which is reported honestly as *"You were no longer following @name."*;
- costs 1 rate-limit point against the 5 a write costs, and skips the write
  entirely when there is nothing to undo;
- surfaces a missing permission without changing anything.

## Permissions

GitProfileLens signs in with a **GitHub App user access token**. The rest of the
product is read-oriented: it reads public profiles, and with your authorization
reads repositories you selected. Changing who you follow is a different kind of
act, so it is gated separately.

### What GitHub's model allows, and what it does not

A GitHub App's user permissions are granted **as one set** at authorization
time. GitHub does not support asking for a subset later, and the `scope`
parameter is ignored for GitHub Apps. So GitProfileLens **cannot** narrow the
token at the GitHub level, and this document will not pretend otherwise.

What GitProfileLens does instead is refuse to *use* the permission until you
have passed through a separate authorization that exists only to say what it is
for:

1. The Network tab explains, in the interface: *"Managing follows requires
   permission to change who you follow. GitProfileLens never unfollows accounts
   automatically."*
2. Choosing **Allow managing follows** sends you to
   `/api/auth/github?manage=follows`, which marks the OAuth `state` it generates.
3. The marker travels in the `state` GitHub echoes back. The callback verifies
   the state against the `HttpOnly` cookie **first**, then reads the marker from
   that verified cookie — never from the query string, which a browser could
   have edited.
4. Only then does the sealed session carry `manageFollows: true`.

An ordinary sign-in leaves it `false`, and an older session sealed before this
feature existed has no such field, which is also `false`. The unfollow endpoint
refuses both before making any GitHub request.

This is an application-level gate, not a token-level one. It makes the moment
explicit and auditable; it does not and cannot shrink what the token could do if
the server chose to misuse it.

### What the browser learns

`GET /api/auth/session` reports `can_manage_follows` as a boolean. That is a
capability, not a credential. The browser receives no token, no refresh token,
and no session secret, and it never has.

## The mutation path

```text
browser
  -> POST /api/unfollow   { "login": "octocat" }
     -> sealed HttpOnly session supplies the acting identity and the token
        -> GET    https://api.github.com/user/following/octocat
        -> DELETE https://api.github.com/user/following/octocat
```

The request body may name **only** who to unfollow. `actingUser`,
`authenticatedLogin`, `token` and anything else in the body are ignored, not
trusted. There is no path parameter, no token parameter and no batch form, so
the endpoint cannot be turned into a general GitHub proxy by anyone who has the
URL. It implements exactly one bounded operation.

The server checks, in order: the method is `POST`; the `Origin`, when present,
matches the host; the target login is syntactically valid; the session is valid
and unexpired; the session carries the follow-management permission; and the
target is not the signed-in account itself. The session cookie is already
`SameSite=Lax`, so the `Origin` check is a second lock rather than the only one.

A write is **never retried**. GitHub counts one against a secondary limit of 80
content-generating requests per minute, and a retry nobody asked for is the
automated follow activity this feature exists not to be. You retry, or nothing
does.

## What the interface guarantees

| Guarantee | How |
| --- | --- |
| Nothing changes before GitHub confirms | There is no optimistic removal, so a failure has nothing to roll back and cannot leave the page claiming an unfollow that did not happen |
| Only your own account | The audited profile must equal the signed-in login, compared case-insensitively as GitHub compares logins |
| One at a time | One request may be in flight across the whole manager; a double click, a held Enter key, or a second press finds it pending and does nothing |
| No automatic anything | There is no queue, no schedule, and no background work; every request follows a deliberate confirmation |
| Failures are visible | Every refusal is stated in words, keeps the account in its current state, and stays retryable where retrying makes sense |

### Confirmation

Activating **Unfollow** arms an inline confirmation — *"Unfollow @name?"* with
**Unfollow** and **Keep** — and Escape backs out of it. This is the same
two-stage pattern that already guards deleting observation history, chosen over
a modal dialog because the manager is built for someone working down a list:
nothing has to be typed, it costs one extra keystroke, and Tab, Enter, Enter
works. A modal per account would be correct and unbearable at a hundred
repetitions.

### Focus and announcements

The primary button is relabelled through *Unfollow*, *Unfollowing…* and
*Unfollowed* rather than replaced, so focus never moves out from under you. An
acted-on row is **marked in place rather than removed**, because pulling a row
out from under the cursor would shift every row below it mid-task. A single
polite live region announces pending, success and failure; per-row outcomes are
associated with their button through `aria-describedby`. No state is carried by
colour alone.

The row with a request in flight is marked `aria-disabled` rather than
`disabled`, because a disabled button drops out of the tab order and takes your
place in the list with it. The rest of the manager stays usable.

### When authorization goes away mid-task

If the session ends or the permission is withdrawn while the manager is open,
the manager **stays on screen**. That is precisely the moment you most need to
see which accounts were changed and which were not. Its remaining offers are
withdrawn, labelled *Unavailable*, and a notice says why.

## Observation history after a mutation

[docs/network-ordering.md](network-ordering.md) describes the browser-local
observation history: what GitProfileLens has *seen*, on this device, never when
a follow actually happened.

A confirmed unfollow is stronger evidence than an observation — GitHub was asked
to end the relationship and answered that it had — so it is recorded immediately
rather than left for the next retrieval to notice. Waiting would leave the
history asserting a relationship GitProfileLens knows first-hand is over.

It is recorded **distinctly**:

| Field | Meaning |
| --- | --- |
| `currentlyPresent: false` | The relationship is not in place |
| `unfollowConfirmedAt` | GitProfileLens performed this unfollow and GitHub confirmed it |
| `absences` | Times the account did not turn up in a complete retrieval — **not** incremented by a mutation |
| `firstObservedAt` | Untouched. An unfollow says nothing about when the follow began |
| `lastObservedAt` | Untouched, freezing at the last positive sighting, exactly as an observed absence does |

The distinction matters: `absences` counts times an account failed to appear,
and this account did not fail to appear — it was removed. An account with no
stored history is not invented, because doing so would require guessing a
`firstObservedAt`.

None of this is a follow date. History remains browser-local, is never sent
anywhere, and can be deleted from the Network tab at any time.

## Reconciliation

After GitHub confirms, these move together from the one authoritative answer:
the Following count and list, the non-follow-back count and list, the manager,
the Network Markdown export, the cached network state, and the observation
history. No surface is left claiming a relationship that has ended.

GitProfileLens does **not** re-run the audit or refetch the network. The
retrieved network differs from the current one by exactly one account; spending
four more GitHub requests to rediscover that would be slower, would risk the
unauthenticated rate limit, and would replace the ordering history established.

Removing one account cannot change the relative order of the rest, so the
display order is filtered rather than derived again. That keeps working through
a hundred accounts linear rather than quadratic.

## Measured cost

From `npm run eval:performance`, a synthetic manager:

| Accounts | Rows on open | Open | Show 25 more | Show all | Filter | Reconcile one |
| --- | --- | --- | --- | --- | --- | --- |
| 25 | 25 | 0.9ms | 0.1ms | 0.0ms | 0.2ms | 0.1ms |
| 250 | 25 | 0.6ms | 0.5ms | 4.1ms | 0.6ms | 0.0ms |
| 1,000 | 25 | 0.6ms | 0.5ms | 20.1ms | 0.7ms | 0.2ms |
| 10,000 | 25 | 0.5ms | 0.5ms | 205.0ms | 1.1ms | 2.4ms |

Opening the manager costs the same at the retrieval cap as at one page. The only
figure that grows is **Show all**, which is the cost of the thing you explicitly
asked for. Nothing here argues for virtualization, so none was added.

The manager itself issues **no GitHub requests**. Rows are built from the avatar
and login already present in the relationship response; fetching a profile per
row would have been hundreds of requests spent on decoration. The filter narrows
already-loaded accounts and asks GitHub nothing per keystroke.

## Diagnostics

Server logs for a failed unfollow record the component, event, request id,
target login, GitHub status and elapsed time. The target login is public and is
kept, because a failure nobody can attribute to an account is not diagnosable.
Never logged: access tokens, refresh tokens, session cookies, authorization
headers, OAuth codes or the session secret.

## Non-goals

Not implemented, and not planned here:

```text
Unfollow all
Select all / bulk selection
Bulk unfollow
Automatically unfollow non-followers
Scheduled or background cleanup
Follow-back automation
Follow automation or growth automation
Engagement scoring
"Bad follower" classification
```

This is a management tool for deliberate individual decisions. It is not a
follower-growth tool, and describing it as one would misrepresent both what it
does and what GitHub permits.

## Limits

- The permission gate is application-level. GitHub grants a GitHub App's user
  permissions as one set, so signing in grants the token what the App declares;
  GitProfileLens simply refuses to use it without the explicit authorization.
- GitProfileLens cannot know why an account does not follow back, and does not
  guess.
- The manager is unavailable when either relationship retrieval is incomplete,
  including above the 10,000-account retrieval cap.
- Observation history lives in this browser only. A different browser or device
  starts a new baseline, and the ordering falls back to GitHub's own.
- Unfollowing is possible only for the account you are signed in as.
