# ADR 0002: Descope online payments for the initial release

Status: accepted (issue #15)

## Context

The original Google AI Studio prototype brief mentioned "secure online payments" and included local mock payment and refund states. However, the live H20 workflow (`backend/n8n/workflows/B-public-api-and-proposals.json` and `C-employee-api.json`) intentionally produces staff-reviewed concept proposals rather than binding paid reservations:

- Venue capacities, room availability across external H20 calendars, custom catering, and items without published website prices (`op aanvraag`) require explicit confirmation by H20 staff before a binding price or contract exists.
- Collecting an online payment or deposit at request submission would charge customers for unconfirmed slots or incomplete totals where `op aanvraag` items have not yet been quoted.
- Live bookings in the n8n backend explicitly initialize `financial.paymentMethod` to `'Nog geen offerte'` and `amountPaid: 0`, and staff approval publishes the reviewed concept explanation rather than issuing a payment demand.

## Decision

1. Online payment collection, deposits, payment provider webhooks, and automated refunds are formally **descoped** for this release.
2. Live requests remain non-binding concept proposals reviewed by H20 staff, followed by H20's existing formal quotation and invoicing process once availability and `op aanvraag` line items are confirmed.
3. Payment and refund fields present in local demo mode (`h20-angular-demo-v1`) remain clearly labelled as local demonstration data only and never represent real financial transactions.
4. `scripts/check-requirements.cjs` reports online payments as formally out of scope under this ADR (`BUITEN SCOPE (ADR): Online betalingen (docs/adr/0002-descope-online-payments.md)`).

## Post-go-live phase

If H20 decides to introduce online deposits or invoice settlement in a future phase after go-live:

- Integrate a Dutch payment service provider such as **Mollie (iDEAL)** owned directly by H20's merchant account.
- Trigger checkout **only after staff approval** and after final pricing for any `op aanvraag` items has been confirmed, never at initial concept submission.
- Verify payment status exclusively via signed server-to-server webhooks in n8n before updating `financial.amountPaid` or booking state, keeping refunds managed through the provider dashboard with explicit staff audit logging.

## Consequences

- Customers are never charged for unconfirmed availability or partial estimates.
- No PCI/PSD2 payment credentials, webhook secrets, or refund state machines are needed for go-live.
- Staff handle final quotation and invoicing outside the app after approving a concept proposal.
