# ADR 0007: Race-safe rate limits with insert-first rate hits

Status: accepted (issue #46, builds on #10 and ADR 0001)

## Context

The #10 limiter kept one row per action (`ratelimit:<action>`) with rolling timestamp arrays. Workflow B read it, checked the limits, and upserted a full replacement row before Gemini. Requests running at the same moment read the same row, each passed, and the last upsert won, so timestamps were lost and a burst could exceed the per-client and global limits. The Data Table has no transactions or locks, but every row gets an auto-generated integer `id`, which ADR 0001 already uses to make slot claims race-safe.

## Decision

1. **One row per limited request.** After cheap validation (an empty chat message, `validateRequest` for event requests) a request inserts a `ratehit` row: `recordId: ratehit:<action>:<random id>`, payload `{ data: { action, keys, at } }`. `keys` are the SHA-256 hashed Firebase uid and the hashed caller IP (`resolveClientKeys`, unchanged); raw values are never stored. The random id only keeps the insert from matching an existing row; ranking never depends on its uniqueness. `buildRateHit(action, keys, nowMs, id)` takes the id as an argument and stays pure.
2. **Insert first, count after.** All rows are re-read. `decideRateHit(rows, action, ownRowId, nowMs) -> { allowed, deleteRowIds }` is pure and order independent. Our hit is allowed when, for each of its keys, fewer than `perClient` live hits sharing that key rank before it, and fewer than `global` live hits for the action rank before it. Rank is the Data Table row id, lowest first. A live hit is one for the same action whose `at` is inside the window. Every present live hit counts, whatever the outcome of its own request (a hit still waiting for its delete under-admits, which is the safe side). Raw rows are counted, never `dedupe()`d.
3. **Fail closed on ids.** Our own hit without a usable row id is denied. A rival hit without one ranks first, the same as `rivalRank` in `resolveClaim`.
4. **Denied hits delete themselves**, by system `id`, and the request answers 429 with the existing message. A denied attempt therefore uses no quota once the delete lands.
5. **Pruning.** `decideRateHit` also returns up to 50 ids of `ratehit` rows whose `at` is outside the window (oldest ids first). An allowed request deletes them in a best-effort branch. There is no scheduled cleanup workflow.
6. **event-request** counts its hit once. `Write claim` emits the slot claim and the hit as two items of one insert; `Settle claim` finds each returned id by `recordId`; only if the insert output carries no `recordId` at all (system columns only) and has exactly one item per written row does it fall back to item order, and a mixed output fails closed, and `settleClaim(context, rows, ownRowId, ownHitRowId, nowMs)` decides both from the single re-read. Losing the slot answers 409 and deletes the claim and the hit. Winning the slot but being rate limited answers 429 and deletes the claim, the hit and the expired ids. A retry that returns an existing `held` booking inserts no hit. A retry that finds the claim still `claiming` counts as a new hit through the hit route.
7. **chat and the `claiming` retry** use a `route: 'hit'` path: `Needs hit -> Write hit -> Insert hit -> Re-read records after hit -> Decide hit`. `Decide hit` (`decideHit`) returns `route: 'gemini'` (with `pruneRowIds`) or `route: 'lost'` with 429 and `deleteRowIds`. Gemini is only reachable from `Needs Gemini`, which is only fed by the two decision nodes.
8. **Errors.** An insert or re-read error answers 503 and never calls Gemini. A failed delete of our own row still answers 429 or 409 (a leftover row only over-counts until it expires). Prune deletes are best effort: they run only after `Respond` has answered the webhook, their errors are ignored, and they never block, delay or 503 a request.
9. **Multi-row deletes.** Results carry `deleteRowIds: number[]`. A Code node (`Lost claim ids`) emits one item per id, `Delete lost claim` filters on `id = {{ $json.id }}`, and `After lost claim` runs once, so the webhook is answered exactly once. An empty list becomes a single sentinel id `0` (matches no row) so an answer is always produced. Workflow C uses the same path.
10. **Legacy rows.** Existing `ratelimit:*` rows are ignored from now on. They stay in the Data Table, are never read, and can be deleted by hand. No migration. `ratehit` rows are excluded from the staff snapshot.

## Rejected alternatives

- A single counter row (the #10 design): read-modify-write, the race this ADR removes.
- n8n concurrency = 1 on the workflow: n8n Cloud has no per-workflow concurrency limit, and it would serialise slow Gemini calls.
- An external store (Redis, Firestore counters): a second datastore with its own credentials and sync, for one feature. The Data Table row id already gives a total order.

## Consequences

- Per key, at most `perClient` of N simultaneous requests are allowed, and at most `global` per action, in any evaluation order (domain tests).
- The Data Table holds up to roughly `global` live hits per action plus unpruned expired ones. Every request reads them all, so the table grows only until the next allowed request prunes up to 50.
- A burst can briefly under-admit: denied hits still waiting for their delete count against later requests.
- Live behaviour of the Data Table `insert` (returning `id` and the inserted columns, one row per item), `get` and `deleteRows` nodes is verified in #7, not here.

## Residual risk

Same as ADR 0001: on a Postgres-backed Data Table, sequence ids can become visible out of order, so a lower id may commit after a higher id's re-read and two requests could each miss the other. The window is tiny and the overshoot is bounded by the number of such requests. The hard Google Cloud Gemini quota and budget caps remain the real backstop. Live check for #7: commit and visibility ordering of Data Table ids under concurrent inserts.
