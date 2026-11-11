# ADR 0001: Race-safe slot claims on the n8n Data Table

Status: accepted (issue #14)

## Context

The public event-request path read all rows, checked overlap, called Gemini (several seconds) and only then upserted the booking. Two overlapping requests inside that window were both saved as `pending_review`, so two customers held a receipt for the same slot and staff approval then failed with 409 for both. The staff `add-block` action had the same read, check, write gap. The Data Table has no transactions or locks, but every row gets an auto-generated integer `id` system column.

## Decision

1. A `pending_review` request is a soft hold. Active claims (not rejected, cancelled, refunded or draft; the `hasConflict` rule) never coexist when they overlap in date, time and any shared room including `additionalRooms`.
2. Reserve first, then verify. After validation and before Gemini the claim row is inserted. All rows are then re-read. Among the active overlapping claims (including ours) the lowest Data Table row `id` wins. A loser deletes its own row and returns 409 with the existing overlap message.
3. If Gemini fails, the hold is kept. The booking is saved `held` with `aiStatus: 'failed'` and no explanation, the customer gets the normal receipt, and staff see "AI-uitleg ontbreekt" and supply the text through the existing `review` action (which sets `aiStatus` back to `ok`). Staff cannot approve such a booking before text exists.
4. Bookings and staff blocks are both slot claims and share one function: `resolveClaim(rows, claim) -> { won, winnerId }` (pure) wrapped by `settleClaim`. The first claim wins in either direction.
5. Lifecycle: claims are inserted with `claimStatus: 'claiming'` and set to `'held'` by the winner's final write (for blocks, right after verification). A retry with the same `requestId` that finds a `claiming` row re-runs verification instead of returning it. Claims still `claiming` after 10 minutes are shown in the staff list as "Onvolledige aanvraag" (by Data Table `createdAt`) and can be rejected with the existing reject action. The conflict check keeps counting `claiming` rows (cautious). Legacy rows without the new fields count as `held` / `ok`.
6. Staff approval keeps its conflict re-check as a safety net. Staff cannot change a booking's date, time or room, so approval needs no lock.

Implementation notes: `parseRows` keeps `rowId` and `rowCreatedAt` next to the payload. Each claim has a unique `recordId` (`booking:<requestId>`; blocks get a random suffix) so the insert always creates a new row. The delete-on-loss node filters on that `recordId`, which identifies exactly our own row. `publicBooking` strips `claimStatus` and `aiStatus`. The mail workflow skips `claiming` bookings so a receipt email is never sent for a claim that may still lose.

## Rejected alternatives

- n8n concurrency = 1 on the workflow: n8n Cloud has no per-workflow concurrency limit, and it would serialise all requests including slow Gemini calls.
- Firestore transactions: a second datastore next to the Data Table, with its own sync and access rules, for one feature.
- A scheduled cleanup workflow for abandoned claims: another moving part to deploy and monitor. Staff reject stale claims by hand; the cautious conflict check makes this safe.

## Consequences

- Two overlapping requests can no longer both be saved. A losing customer may briefly see a 409 even though the winner later fails; staff then reject the incomplete claim.
- A crash between insert and final write leaves a `claiming` row that blocks the slot until a retry or staff rejection.
- Live behaviour of the Data Table `insert`, `get` and `deleteRows` nodes (including `id` in the get output) is verified in #7, not here.
