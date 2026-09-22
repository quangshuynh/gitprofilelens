# Network list ordering

GitProfileLens shows Followers, Following, and "Following who don't follow back"
in the order GitHub's API returned them, and says so in both the interface and
the Markdown export. It does **not** claim a newest-to-oldest follow order.

This document records why, so the question does not have to be re-litigated.

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
| Ordering | Untouched — the API's order is never re-sorted |

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

## Outcome

Outcome C: GitHub provides no authoritative chronology.

> GitHub does not expose sufficient relationship-time evidence for GitProfileLens
> to claim newest-to-oldest follow ordering.

The API order is preserved and described neutrally. The same sentence appears in
the interface and in the Markdown export, so the two can never disagree.

## Possible future work: locally observed history

GitProfileLens could record snapshots of a profile's network over time and detect
that a relationship first appeared between two observations:

```
Seen following @alice on Sep 22
Not present in the Sep 15 snapshot
→ first observed between Sep 15 and Sep 22
```

This is feasible in principle but is **not** a follow timestamp. It is bounded by
when GitProfileLens first observed the profile, it says nothing about follows that
predate the first snapshot, and it cannot distinguish a new follow from a re-follow.

If it is ever built, the terminology must be `first observed`, never `followed at`,
and an ordering derived from it must not be presented as a follow chronology.

Nothing persistent is stored today: network state lives only in memory for the
current profile, so this remains a documented possibility rather than a partial
implementation.
