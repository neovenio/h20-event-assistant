# Firebase Authentication update

De nieuwe exports verifiëren Firebase ID-tokens vóór toegang tot beschermde gegevens. Importeer B en C opnieuw; eerdere gedeelde toegangscodes worden niet meer gebruikt. Klanten halen alleen aanvragen met hun eigen Firebase UID op. Medewerkers hebben de door een beheerder ingestelde custom claim `staff: true` nodig. Stel die claim uitsluitend in met de Firebase Admin SDK in een vertrouwde beheeromgeving, nooit vanuit Angular. Nieuwe accounts krijgen geen medewerkerrechten. De Firebase-webapp en e-mail/wachtwoord-provider zijn aangemaakt in `h20-event-assistant-dev`. Productie is niet gewijzigd.

De onderstaande oorspronkelijke setupbeschrijving is historisch voor de demo; gedeelde Header Auth-stappen zijn vervangen door deze Firebase-tokenverificatie. Live n8n-import en tests zijn nog noodzakelijk.

# H20 n8n backend

This folder replaces the AI Studio Express/JSON-file backend with n8n webhooks and Data Tables. The Angular app already has a matching client. Your n8n workspace is [neovenio.app.n8n.cloud](https://neovenio.app.n8n.cloud).

The workflows are prepared for import and start inactive. No live workflow, credential, email or booking has been created by this migration.

## Setup in your workspace

1. Create a Data Table called `h20_records` in the same n8n project as the workflows. Add three **String** columns: `recordId`, `kind`, `payload`. n8n supplies its own numeric row ID and timestamps; do not replace those. `payload` holds JSON because Data Tables do not provide nested object columns.
2. Import the four JSON files from `workflows/` using **Import from File**. In every Data Table node, select the real `h20_records` table instead of `REPLACE_WITH_H20_DATA_TABLE_ID` (in workflow B this includes `Read records`, `Insert claim`, `Re-read records after claim`, `Delete lost claim`, `Record rate limit`, and `Save record`). There are read, claim, rate-limit, save, staging and notification receipt nodes across the workflows.
3. In workflow B's `Gemini` and `Gemini fallback` HTTP Request nodes, create/select a generic **Header Auth** credential with header name `x-goog-api-key` and your Gemini API key as its value. The primary model is `gemini-3.8-flash`, matching the project document; when it fails or takes longer than 25 s (it can stall or answer `503 UNAVAILABLE` under load), the request is retried once on `gemini-3.5-flash` (20 s). AI failures answer `503`, never `502`/`504`: n8n Cloud replaces those statuses with its own response without CORS headers, which the browser only reports as "Failed to fetch". Keep this credential in n8n only, restrict the API key to `generativelanguage.googleapis.com`, and configure a Google Cloud Gemini API quota cap and billing budget alert (see **Abuse protection & Gemini cost controls** below).
4. Workflow B/C verifiëren Firebase-tokens via de **Verify Firebase token**-node. Alleen `catalogue` op workflow B is publiek zonder login; `chat`, `event-request`, `my-requests` en `lookup` vereisen een geldig Firebase ID-token. Gebruik geen gedeelde Header Auth-code meer. Klanten loggen in met Firebase; medewerkers hebben de beheerdersclaim `staff: true` nodig. Deze claim kan uitsluitend via de Firebase Admin SDK door een bevoegde beheerder worden ingesteld.
5. Review the two Webhook nodes' **Allowed Origins (CORS)**. Defaults include the supplied dev/prod Firebase project hostnames and `http://localhost:4200`. Add your actual preview/custom-domain origin if different. For local preview on port 4201, add `http://127.0.0.1:4201`. CORS is not authentication; keep the Firebase identity gate intact.
6. Execute workflow A manually. It uses HTTP Request → HTML extraction → JavaScript normalization → Data Table upsert. Review node outputs if a page's markup has changed. The workflow fails rather than storing empty pages. It stages source rows, preserving any existing staff-reviewed catalogue entries.
7. Publish workflows B and C. Their production URLs are `https://neovenio.app.n8n.cloud/webhook/h20/public` and `/webhook/h20/admin`. Test URLs under `/webhook-test/` are temporary and must not be used for the app's permanent configuration.
8. Set `public/h20-runtime.json` in Angular to `{"n8nWebhookBaseUrl":"https://neovenio.app.n8n.cloud/webhook/h20"}`. Rebuild/preview as usual. Sign in with an account assigned the Firebase staff claim, open **Brongegevens**, review each source and publish suitable entries. Then use **Zaalbeheer** to confirm capacity/facilities. The two stadium detail pages can refer to the same physical room: do not publish duplicate bookable capacity. Prices absent from sources stay unknown.
9. Test a customer request with your own test contact details. Check that the Data Table contains a booking with `requestStatus: pending_review`, a generated explanation and a provisional staff planning. Open the receipt link: the generated explanation should appear only after staff approval; staff notes/planning must never appear in the public response.
10. Optionally configure workflow D: select an SMTP credential, replace `REPLACE_WITH_VERIFIED_SENDER`, and verify `FRONTEND_ORIGIN` in **Prepare mail** (`'https://h20-event-assistant-dev.web.app'` by default for dev; set `FRONTEND_ORIGIN` to `'https://h20-event-assistant-prod.web.app'` in the `[PROD]` workflow import — see `docs/adr/0004-prod-n8n-separation.md`). Execute manually using your own test address first. Publish it only when you want real email delivery. It sends receipt and approval messages on a five-minute schedule, skips in-flight `claiming` bookings, and records successful deliveries. It does not send WhatsApp messages.

Do not put any API key or staff token in a Git-tracked file or in the public runtime JSON.

## Workflow responsibilities

**A — Official website scraper** fetches official H20 pages, extracts page text/title/image URLs, normalizes JSON and upserts source records. It has a manual trigger for reviewable setup. Add a Schedule Trigger later if desired. Add more official detail URLs in Sources to expand the catalogue. Source URLs and timestamps are retained, while prices and unconfirmed capacities are not invented. The initial activity and catering pages are staged as overview entries; staff can refine these into individual catalogue items.

**B — Public API and proposal generator** accepts POST actions `catalogue`, `chat`, `event-request`, `my-requests`, and `lookup`. Only `catalogue` runs unauthenticated; all other actions require a verified Firebase ID token. AI actions (`chat` and `event-request`) enforce rolling 1-hour per-client (SHA-256 hashed caller IP, falling back to hashed UID) and global rate limits stored in `h20_records` (`ratelimit:chat`: 20/client/hr, 120/global/hr; `ratelimit:event-request`: 5/client/hr, 30/global/hr) and return HTTP `429` before calling Gemini when exceeded. For `event-request`, it validates request fields, verifies selected catalogue entries, computes known prices from stored data, checks schedule overlaps, then claims the slot (insert claim row, re-read, lowest row id wins; a loser deletes its row and answers 409). The winner upserts the updated rate-limit window, asks Gemini for a structured explanation/planning, validates its room IDs/names and time ranges, then saves `pending_review` as `held` (a Gemini failure keeps the hold with `aiStatus: 'failed'`). The HTTP response is sent after persistence succeeds. The browser supplies a random request ID and private customer token so retries of an already-held request return an existing receipt without consuming rate-limit quota or making another AI request.

**C — Employee API** requires a verified Firebase ID token and a staff claim before any data is read. It serves `session` and `snapshot`, plus `booking-status`, `booking-note`, `review`, `save-catalogue`, `delete-catalogue`, `add-block`, and `delete-block`. Approving publishes the concept explanation to the customer; editing it returns it to pending review. Approval does not make a definitive reservation or payment. Internal planning, notes and audit data stay on the staff endpoint.

**D — Email notifications** reads submitted/approved requests, skips those with matching delivery receipts, sends text-only email and writes a receipt only after SMTP success. A crash between sending and recording the receipt can cause a duplicate email. It is deliberately inactive until configured.

## Data contract

Each row has a `recordId` such as `room:stadium` or `booking:<uuid>`, a `kind`, and a JSON `payload` containing `data` and optional internal metadata. Supported kinds are `room`, `catering`, `upgrade`, `activity`, `source`, `booking`, `block`, `notification` and `ratelimit`. `ratelimit` rows (`ratelimit:chat`, `ratelimit:event-request`) store pruned rolling 1-hour timestamp arrays keyed by SHA-256 hashed caller IPs (never raw IPs, for GDPR compliance) and are excluded from public catalogue and staff snapshot responses.

Catalogue rows follow the Angular types in `src/app/event-assistant/models.ts` and `data/initial-data.ts`. Booking payloads also contain a private customer token and audit trail. Public catalogue results contain only catalogue data. Customer lookup requires the matching token and strips staff data and unpublished explanation text.

The proposal generator does not trust submitted room prices, add-on prices or a submitted total. Unknown rates stay unknown and budget overruns become review notes. Gemini receives event preferences and catalogue data, but not the customer's contact or billing fields. Generated text is rendered as text, not HTML.

## Prototype limitations

- Slot claims are race-safe through a reserve-first protocol, not a lock (see `docs/adr/0001-slot-claims.md`). Workflow B (event requests) and workflow C (`add-block`) insert a claim row (`claimStatus: 'claiming'`) after validation and before Gemini, re-read all rows, and the active overlapping claim with the lowest Data Table row `id` wins. A loser deletes its own row (by system `id`) and answers 409. A winner is saved as `held`; a Gemini failure keeps the hold with `aiStatus: 'failed'` and staff add the text through the review action. A retry that finds a `claiming` row verifies again. Claims still `claiming` after 10 minutes show up in the staff list as "Onvolledige aanvraag" and can be rejected; there is no cleanup workflow. The remaining limits: live behaviour of the Data Table `insert`, `get` and `deleteRows` nodes is only verified in #7, and this is still a concept-planning prototype, not a payment or confirmed-reservation system.
- Workflow B enforces Firebase sign-in and Data Table hourly rate limits (`chat`: 20/IP/hr, 120/global/hr; `event-request`: 5/IP/hr, 30/global/hr) before calling Gemini. Because Data Table reads and upserts are not atomic across simultaneous executions, extreme parallel bursts can slightly overshoot the soft counter by a few requests; pair this with a hard Google Cloud Gemini API quota cap and ingress rate limiting (see below) before broad public traffic.

## Abuse protection & Gemini cost controls

In addition to Firebase Authentication and the in-workflow Data Table rate limiter (`Record rate limit`), configure hard Google Cloud guardrails on the project that owns the Gemini API key:

1. **Restrict the Gemini API key**:
   - Open **Google Cloud Console → APIs & Services → Credentials**.
   - Select the API key used by n8n's `x-goog-api-key` credential.
   - Under **API restrictions**, select **Restrict key** and allow **Generative Language API** (`generativelanguage.googleapis.com`) only.
2. **Set hard Gemini API quota caps**:
   - Open **Google Cloud Console → IAM & Admin → Quotas & System Limits**.
   - Filter by **Service: Generative Language API** (`generativelanguage.googleapis.com`).
   - Edit **GenerateContent request limit per minute** (e.g. `15` RPM) and **GenerateContent request limit per day** (e.g. `500` RPD, or lower for dev/staging) so unexpected loops or bursts fail closed at Google Cloud with `429` before incurring material cost.
3. **Configure a Google Cloud Billing budget alert**:
   - Open **Google Cloud Console → Billing → Budgets & alerts → Create budget**.
   - Scope the budget to the H20 project and **Generative Language API** service.
   - Set a monthly target amount (for example `€15` for dev / `€50` for prod) and alert thresholds at **50%**, **80%**, and **100%** of actual and forecasted spend, routed to project owners.

- Workflow exports disable saving successful/failed production execution data and manual executions by default to reduce stored contact data. Review workspace execution retention and user access as well.
- A personal receipt URL grants access to that request. It uses a high-entropy random token in the URL fragment. Treat it as private. There is no full customer account system.
- Email is at-least-once delivery. Verify SMTP and recipient handling with test records before activating the schedule.
- Live import/runtime testing requires the real Data Table ID and n8n credentials. The local tests cannot verify those external resources.

## Editing and tests

Edit the reusable JavaScript in `code/`, then regenerate the importable workflows:

```sh
node backend/n8n/generate-workflows.cjs
npx prettier --write backend/n8n
node --test backend/n8n/tests/domain.test.cjs
```

Regeneration changes files locally only; it never contacts n8n or publishes a workflow. Re-import revised exports deliberately rather than creating duplicate active webhooks.

## References checked during implementation

- [n8n Webhook and authentication](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [n8n Data Table operations](https://github.com/n8n-io/skills/blob/main/skills/n8n-data-tables-official/references/OPERATIONS.md)
- [n8n HTML extraction](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.html/)
- [Gemini models](https://aistudio.google.com/docs/models)
- [Gemini structured outputs](https://aistudio.google.com/docs/structured-output)
