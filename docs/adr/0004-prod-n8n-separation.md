# ADR 0004: Isolated n8n Data Table and workflow imports for production

Status: accepted (issue #9)

## Context

The H20 Event Assistant uses Firebase Authentication and Hosting in two separate Firebase projects:

- **Development:** `h20-event-assistant-dev` (`https://h20-event-assistant-dev.web.app`), deployed on pushes to `dev`.
- **Production:** `h20-event-assistant-prod` (`https://h20-event-assistant-prod.web.app`), deployed on pushes to `main`.

In the n8n workspace (`https://neovenio.app.n8n.cloud`), the initial setup (issue #6) created a single Data Table (`h20_records`) and imported Workflows A–C bound to the development Firebase web API key (`Verify Firebase token` calling `identitytoolkit.googleapis.com/v1/accounts:lookup?key=<dev-api-key>`).

Before configuring `config/runtime/prod.json` (#9) and going live (#19), we must decide whether production shares the development Data Table and n8n workflows or runs an isolated production set inside the n8n workspace.

Sharing a single Data Table or webhook pair across `dev` and `prod` would cause severe operational and security problems:

1. **Identity mismatch:** Firebase ID tokens issued by `h20-event-assistant-prod` fail verification against the `h20-event-assistant-dev` `accounts:lookup` endpoint (and vice versa), unless a workflow explicitly targets the matching project's API key.
2. **Customer PII & test pollution:** Development test submissions would mix with real H20 customer enquiries, audit logs, and email notification queues (`D-email-notifications.json`), risking accidental test emails or false schedule conflicts on real event dates.
3. **Slot-claim & rate-limit interference:** Slot holds (`#14`, ADR 0001), room availability blocks, and webhook rate-limit buckets (`#10`) in dev testing could block real production dates or exhaust production quotas.
4. **Notification link mismatch:** Workflow D embeds `FRONTEND_ORIGIN` in customer receipt/approval links (`/#request=...&token=...`). Mixing dev and prod rows in one table would send production customers links pointing to the wrong environment.

## Decision

Production (`h20-event-assistant-prod`) is **strictly isolated** from development inside `neovenio.app.n8n.cloud`:

1. **Dedicated Data Table (`h20_records_prod`):**
   - Create a separate n8n Data Table named `h20_records_prod` with the three String columns `recordId`, `kind`, and `payload`.
   - Keep `h20_records` exclusively for development (`h20-event-assistant-dev`).
2. **Dedicated `[PROD]` workflow imports (A–D):**
   - Import a second set of Workflows A, B, C, and D named with a `[PROD]` prefix (`[PROD] H20 A — Official website scraper`, `[PROD] H20 B — Public catalogue and proposal generator`, `[PROD] H20 C — Employee review API`, `[PROD] H20 D — Request and approval notifications`).
   - Point every Data Table node in `[PROD]` A–D to `h20_records_prod`.
3. **Separate production webhook paths:**
   - Set `[PROD]` Workflow B's Webhook path to `h20-prod/public` and `[PROD]` Workflow C's Webhook path to `h20-prod/admin`.
   - Configure `config/runtime/prod.json` with `"n8nWebhookBaseUrl": "https://neovenio.app.n8n.cloud/webhook/h20-prod"`.
   - Keep `config/runtime/dev.json` (`public/h20-runtime.json`) pointing to `"https://neovenio.app.n8n.cloud/webhook/h20"`.
4. **Production Firebase token verification & CORS:**
   - In `[PROD]` Workflows B and C, set the `Verify Firebase token` HTTP Request URL `key=` parameter to the `h20-event-assistant-prod` web app `apiKey`.
   - Restrict `Allowed Origins (CORS)` on `[PROD]` Workflows B and C to `https://h20-event-assistant-prod.web.app` (plus any verified custom H20 production domain, e.g. `https://h20-event-assistant-prod.firebaseapp.com`), omitting `http://localhost:4200` and the dev Hosting origin.
5. **Production email origin:**
   - In `[PROD]` Workflow D's `Prepare mail` node, set `FRONTEND_ORIGIN` to `'https://h20-event-assistant-prod.web.app'` (or the final custom production domain) before activating the 5-minute schedule.

## Rejected alternatives

- **Shared Data Table and shared webhooks between dev and prod:** Rejected due to incompatible Firebase project token verification, mixing real customer PII with dev tests, cross-environment slot conflicts, and wrong `FRONTEND_ORIGIN` links in emails.
- **Separate n8n Cloud workspace/subscription for prod:** Provides even stronger tenant isolation, and remains compatible with this architecture if H20 provisions a dedicated n8n Cloud instance later, without requiring any frontend code change (only updating `n8nWebhookBaseUrl` in `config/runtime/prod.json`).

## Consequences

- Real customer bookings, staff reviews, rate-limit counters, and SMTP notifications in production are completely isolated from development testing.
- Curated catalogue entries (`room`, `activity`, `catering`, `upgrade`) must either be reviewed/published once in `[PROD]` after running `[PROD]` Workflow A or exported from `h20_records` (catalogue kinds only, never `booking` or `notification` rows) into `h20_records_prod`.
- Schema or workflow updates in `backend/n8n/workflows/` must be deliberately imported into dev first, verified, and then imported into the `[PROD]` workflows.
