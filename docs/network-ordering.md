# Network list ordering

GitProfileLens does **not** claim a newest-to-oldest *follow* order for
Followers, Following, or "Following who don't follow back", because GitHub does
not expose one. What it does instead is remember which relationships it has seen
before, on the reader's own device, and order the lists by **first observation**.

This document records the evidence for the first half of that sentence, so the
question does not have to be re-litigated, and then specifies the second half.

## The question

Can the Network lists truthfully be displayed newest follow first, oldest follow
last? That requires GitProfileLens to know *when* one account followed another.

## What GitProfileLens retrieves today

| Concern | Behavior |
| --- | --- |
| Endpoints | `GET /users/{username}` then `GET /users/{username}/followers` and `GET /users/{username}/following` |
| Pagination | Sequential pages at `per_page=100`, stopping on a short page, capped at 100 pages (10,000 accounts) |
| Normalization | Each entry is reduced to `{ login, profileUrl }` |
| Completeness | Every list carries an explicit `complete` flag; a partial list blocks both the derived list and the export |
| Non-follow-back | `following` minus `followers`, compared case-insensitively, preserving Following order |
| Ordering | By first local observation where history exists; otherwise the API's order, untouched |

## Evidence

### 1. REST exposes no relationship timestamp

`GET /users/{username}/followers` and `/following` return arrays of the "Simple
User" object: `login`, `id`, `node_id`, `avatar_url`, URL fields, `type`,
`site_admin`, `user_view_type`, and `starred_at`. There is no `followed_at`, no
relationship `created_at`, and no other field describing the follow event.

`starred_at` refers to starring a repository, not following an account.

A user's own `created_at` is account-creation time. It is not follow time and is
not used as one.

### 2. REST documents no ordering guarantee

GitHub's REST reference documents only `per_page` and `page` for these two
endpoints. No `sort` or `direction` parameter exists, and the documentation makes
no statement about the order of the returned array.

Observed behavior is not an API contract, so the response order cannot be
labelled "Newest" or "Oldest" on the strength of a probe.

### 3. Observed order is not follow order anyway

A probe of four separate lists on 2026-09-22 found the response order to be
strictly ascending by the *other account's* numeric user id:

| List | Accounts sampled | Ascending-id adjacent pairs |
| --- | --- | --- |
| `quangshuynh/followers` | 100 | 99 / 99 |
| `quangshuynh/following` | 100 | 99 / 99 |
| `torvalds/followers` | 100 | 99 / 99 |
| `defunkt/following` | 100 | 99 / 99 |

Repeating a request returned an identical order.

Ascending account id tracks when each *account was created on GitHub*, not when
the follow happened. So the current order is closer to "longest-registered
account first" than to any follow chronology. Labelling it "newest follows first"
would be not merely unsupported but backwards-sounding, and labelling it "oldest
follows first" would be equally wrong.

This probe is diagnostic only. It is not a documented guarantee and GitProfileLens
does not depend on it.

### 4. GraphQL exposes no relationship timestamp

Schema introspection against `api.github.com/graphql` on 2026-09-22:

```
FollowerConnection : edges, nodes, pageInfo, totalCount
UserEdge           : cursor, node
User.followers     : args after, before, first, last
User.following     : args after, before, first, last
```

The edge type carries only a pagination cursor and the user node. There is no
edge-level timestamp. Neither relationship field accepts an `orderBy` argument,
in contrast to fields such as `User.repositories`, where GitHub does expose one.

`User.createdAt` is account-creation time and does not count.

### 5. Events cannot reconstruct follow history

`FollowEvent` is not among the event types GitHub currently documents for the
Events API. Even for the event types that do exist, the API documents that "Only
events created within the past 30 days will be included" and that "The timeline
will include up to 300 events."

A 30-day, 300-event window cannot reconstruct the full follow history of an
arbitrary profile, so events are not a source of complete chronology. Partial
event data is not blended into an otherwise unordered list.

## Outcome for the API question

Outcome C: GitHub provides no authoritative chronology.

> GitHub does not expose sufficient relationship-time evidence for GitProfileLens
> to claim newest-to-oldest follow ordering.

Nothing above changed. The sections below describe a *different* claim, built on
evidence GitProfileLens gathers itself.

## Locally observed relationship history

`network-history.js` records, per audited profile and per relationship list, when
GitProfileLens first and last observed each account **in this browser**. It is not
a follow timestamp and is never named as one.

### What a recorded time means

| Field | Meaning |
| --- | --- |
| `firstObservedAt` | The first time *this browser* completed a retrieval that contained this account. It is an upper bound on the follow: the follow happened at or before it, by an unknown amount. |
| `lastObservedAt` | The most recent complete retrieval that contained the account. For an account that has gone, it is frozen at its last positive sighting. |
| `currentlyPresent` | Whether the most recent **complete** retrieval contained the account. |
| `reappearedAt` | Present only when an account went absent and was later seen again. |

The names `followedAt`, `followTimestamp`, and `followDate` appear nowhere in the
shipped source, and `tests/network-history.test.js` scans for them.

### Cohorts, and why a baseline has no order

An observation establishes a set, not a sequence. Seeing 131 followers in one
retrieval proves that all 131 existed by that moment and proves nothing about
their order relative to each other.

Every account first seen in the same observation therefore receives the *same*
`firstObservedAt` and forms one **cohort**. Using a per-account insertion time
would turn loop iteration order into apparent chronology, which is the specific
failure mode this design exists to prevent.

The first observation of a list is the **baseline cohort**: one cohort containing
everything, carrying no internal order. Each later observation adds at most one
new cohort, containing exactly the accounts that were not there before.

```
observation 1:  alice bob carol            -> baseline cohort  (order unknown)
observation 2:  alice bob carol dave erin   -> cohort 2: dave, erin
```

Lists sort by cohort, newest cohort first, and **stably** within a cohort, so the
accounts inside one cohort keep the neutral order GitHub returned them in.

```
dave erin | alice bob carol
  newer   |  baseline, order unknown
```

The interface and the export both say "Most recently observed first" and explain
the limitation. Neither ever says "newest follows".

### Incomplete retrievals

Completeness is respected **per list**. A list whose retrieval hit the pagination
cap, failed mid-pagination, or returned an unusable entry is not merged at all:

- no account is marked `currentlyPresent: false`, because a missing account may
  simply sit on a page that never arrived;
- no new cohort is created, because a partial page is not an observation of the
  set;
- prior history is left exactly as it was;
- the list is displayed in GitHub's order rather than ordered by history that
  deliberately excludes the current retrieval.

### Removal and reappearance

A complete retrieval that no longer contains a previously seen account records
`currentlyPresent: false` and freezes `lastObservedAt` at the last positive
sighting.

If the account is seen again, `firstObservedAt` is **not** rewritten — the first
observation really did happen then — and `reappearedAt` plus an `absences` count
record the interruption. Relationship episodes are deliberately not modelled: the
simplest model that does not lie is one first observation plus an explicit record
that the relationship was interrupted. The limitation this leaves is real and
stated here: a re-followed account keeps its original position in the order.

### Non-follow-back

"Following who don't follow back" is `following` minus `followers`, compared
case-insensitively. It is derived from the **already ordered** Following list, so
it inherits that order and never grows a chronology of its own.

### Storage

| Concern | Decision |
| --- | --- |
| Mechanism | `localStorage`, one JSON value under `gitprofilelens.network-history.v1` |
| Why | The product is a static page plus stateless functions: no account system, no database, no per-reader server state to extend. Observation history is per-device evidence, so uploading it would need infrastructure that does not exist and would turn a local note into a server-side record of whose followers someone looked at. |
| Schema evolution | Versioned. A version this build does not know is **not** migrated; it is discarded and a fresh baseline starts, because guessing at an unknown shape would manufacture history. |
| Corruption | Entries missing a usable `firstObservedAt` are dropped rather than repaired, for the same reason. |
| Profile separation | Keyed by normalized login. One profile's history can never order another's. |
| Bounds | At most 20 profiles; the least recently observed are dropped first, and the profile just observed always survives. |
| Writes | One read and at most one write per observation, never per relationship. An observation that changes nothing is not written at all. |
| Reset | An explicit two-step control in the Network tab, and nowhere else. History is never cleared as a side effect of clearing anything else. |
| Cross-device | History is per browser. A different browser, device, or profile starts its own baseline. |

#### Size, measured

An earlier version of this document claimed the bounded profile count kept the
snapshot "well inside a typical 5 MB origin quota". **That was wrong**, and it
was asserted rather than measured. The real figures, from
`tests/network-history.test.js`:

| Case | Relationships | Serialized |
| --- | --- | --- |
| One live-sized profile (147 followers, 396 following) | 543 | ~84 KB |
| One profile at the pagination caps | 20,000 | ~3.1 MB |
| 20 profiles at the pagination caps | 400,000 | **~59 MB** |

About 154 bytes per relationship, dominated by two ISO timestamps and the login.
Browsers commonly charge `localStorage` per UTF-16 code unit, so a browser may
count roughly twice those figures against its quota.

There is no portable quota to design against: the commonly cited 5 MB is a
convention, not a standard, and implementations differ. So the worst case is
**not** claimed to fit. A single profile at the pagination caps already exceeds a
5 MB budget on its own, and the 20-profile worst case exceeds it by more than an
order of magnitude.

What *does* hold is that ordinary use is comfortably inside any plausible quota —
twenty live-sized profiles come to roughly 1.7 MB serialized — and that exceeding
it is handled rather than hoped against.

#### When storage refuses the write

`localStorage` can refuse for reasons the page cannot predict: a full origin
quota, a blocked-storage privacy setting, a private window. All of them surface
as a thrown `setItem`, and all are treated the same way.

1. **The retrieval is never affected.** Followers, Following, non-follow-back and
   the Markdown export are built from the network that was just retrieved, not
   from history. A browser test drives a real `QuotaExceededError` through the
   real `Storage` interface and asserts the Network tab is unchanged.
2. **Prior history is never damaged.** A `setItem` that throws does not modify the
   existing entry, so whatever was stored before is still stored after.
3. **The session does not run ahead of what was stored.** This was a genuine bug
   in the first implementation: the in-memory snapshot was adopted *before* the
   write was attempted, so a refused write left the page ordering by a cohort that
   existed nowhere on disk and silently reverting on the next reload. A feature
   whose entire purpose is to avoid claiming more than the evidence supports
   cannot also display an order its own storage rejected. The snapshot is now
   adopted only once the write succeeds, and a refused write reports the history
   that is actually stored.
4. **The profile in view is preferred over the others.** A single large network
   can exceed the quota by itself. When the full snapshot is refused, the write is
   retried with only the profile being observed — the history most likely to be
   wanted, and the only one this observation can improve. If even that is refused,
   nothing is written and prior history stands.
5. **It is said out loud.** The Network tab reports that storage is full and this
   visit could not be added, or that other profiles' history was released to make
   room. A count that quietly stops advancing would be worse than either.

### What this still cannot do

- It says nothing about follows that predate the first observation, which for an
  established profile is almost all of them.
- It cannot distinguish a new follow from a re-follow, only a new *observation*
  from a repeat one.
- The interval between two observations bounds the resolution: two accounts
  followed a month apart are indistinguishable if both were first seen in the
  same retrieval.
- It is not portable between devices and is not a backup.
- It is not guaranteed to be stored at all. A network at the pagination caps
  exceeds any plausible `localStorage` quota on its own, and a browser may refuse
  the write for reasons the page cannot see. When that happens the lists are shown
  in GitHub's order and the interface says so, rather than ordering by history it
  could not keep.
