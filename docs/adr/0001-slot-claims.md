# ADR 0001: Race-safe slot claims on the n8n Data Table

Status: accepted (issue #14)

## Context

The public `event-request` path read all rows, ran the overlap check, called Gemini (several seconds) and only then saved the booking. Two overlapping requests inside that window could both be saved as `pending_review`; staff approval re-checks conflicts, so both then failed with 409 until one was rejected by hand. Staff `add-block` had the same read/check/write gap. The n8n Data Table offers no transaction, lock or unique constraint.

## Decisions

1. **A `pending_review` request is a soft hold.** Overlapping active claims never coexist. Active means not rejected, cancelled, refunded or draft (the `hasConflict` rule).
2. **Reserve first, then verify.** After validation and before Gemini, the claim row is inserted. All rows are then re-read. Among active claims that overlap ours (same date, overlapping time, any shared room including `additionalRooms`) the one with the lowest Data Table row `id` wins. A loser deletes its own row and returns 409 with the existing overlap message. Because ids are assigned by the table at insert time, every participant that re-reads after its own insert sees the same ordering, so at most one of any overlapping set wins.
3. **If Gemini fails, keep the hold.** The booking is saved `pending_review` with `aiStatus: 'failed'` and no explanation. The customer gets the normal receipt, and staff see "AI-uitleg ontbreekt" and supply the text through the existing `review` action. A successful result sets `aiStatus: 'ok'`.
4. **Bookings and staff blocks are both slot claims**, using one shared function `resolveClaim(rows, claim) -> { won, winnerId }`. The first claim wins in either direction.
5. **Claim lifecycle.** Claims are inserted as `claimStatus: 'claiming'` and become `'held'` in the winner's final write (Gemini result or `aiStatus: 'failed'` save; for blocks right after verification). A retry that finds a `'claiming'` row for its `requestId` re-runs verification instead of returning it. Claims `'claiming'` for more than 10 minutes appear in the staff list as "Onvolledige aanvraag" and can be rejected with the existing reject action. The conflict check keeps counting `'claiming'` rows (cautious). No scheduled cleanup. Rows without the new fields are treated as `held`/`ok`.
6. **Staff approval keeps its conflict re-check** as a safety net. Staff cannot change date, time or room, so approval needs no lock.

## Rejected alternatives

- **n8n concurrency = 1.** Serialising executions would remove the race, but n8n Cloud has no per-workflow concurrency limit; only an instance-wide setting exists, which would serialise every workflow including slow Gemini calls.
- **Firestore transactions.** Would give real atomicity but introduces a second datastore next to the Data Table, with duplicated data and a new failure mode.
- **A cleanup job.** A scheduled workflow to purge stale `claiming` rows adds another moving part (and a window in which it could delete a live claim). Stale claims stay visible and staff reject them explicitly.

## Consequences

- A request can be rejected after its customer-visible pre-check passed; the browser receives 409 and may retry with different times.
- A crash between insert and final write leaves a `claiming` row that blocks the slot until the customer retries (re-verify) or staff reject it.
- Both the winner and an unlucky concurrent loser may briefly coexist in the table before the loser deletes its row; nothing outside the claim path treats a row as final until `held`.
- Block ids now carry a random suffix, because deleted blocks keep their row and a reused recordId would collide on the final upsert.
- Staff cannot approve a `claiming` booking or one without an explanation.
- Not verified against live n8n (tracked in #7): insert returning the `id`, `deleteRows` by `id`, and real concurrent behaviour.
