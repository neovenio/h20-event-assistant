# H20 interface and authentication update

The later redesign adds the supplied official logo, a black/white visual theme with #E1014B and #5FC2D2 accents, line icons and desktop/mobile navigation controls. Firebase Authentication was subsequently authorized: the web app and email/password provider are enabled in the development project. Firebase SDK dependencies, public runtime settings and the auth block in firebase.json are the intentional exceptions to the original configuration-preserving migration described below.

The redesigned app is not yet production-complete: n8n exports require import and live testing, staff claims need assigning by a trusted administrator, and no WhatsApp provider or appointment calendar has been supplied. The requirement checker reports these gaps rather than declaring them complete.

# Angular migration

The Google AI Studio ZIP has been adapted into the existing Angular application. There is no React runtime, Vite application, Tailwind installation, or second Express application.

The implementation follows the architecture in `01_Opdracht/1.docx`: Angular with HTML/CSS, Firebase Hosting, n8n webhooks and Data Tables, and Gemini called from n8n. The supplied pictures, Dutch content, catalogue and sample records remain available in an explicitly labelled local demo. These imported examples are not verified live H20 data.

## What is included

- Customer dashboard, venue catalogue and details, activities, catering and knowledge pages.
- Seven-step event builder with participant limits, time validation, room suggestions, additional rooms, activities, upgrades, catering, preferences and an indicative cost breakdown.
- Saved drafts, contact form, local demo requests, request details and printable concept offers. The browser print dialog can save these as PDF.
- Employee portal: requests, search/filter/CSV export, calendar, availability blocks, customer history, room and catalogue editing, source review, notes, proposal review and activity history.
- Assistant: local catalogue-based help in demo mode; Gemini via n8n in connected mode. The original secret chat code and hard-coded admin credentials were removed.
- Importable n8n workflows for official website scraping, catalogue and requests, structured Gemini proposal/planning generation, staff approval, and optional SMTP notifications.

## Existing project setup

The existing `angular.json`, all TypeScript configuration files, `package.json`, lockfile, application providers/routes, server entry point, Firebase files, Husky hooks, ESLint/Prettier configuration and GitHub Actions workflow are unchanged. No packages were added.

`src/index.html` now has a Dutch language attribute, a product title and a description. `src/app/app.spec.ts` now tests the real app instead of the generated Angular welcome screen.

The current Angular configuration prerenders every public route (`/`, `/plan`, `/my-proposals`, `/knowledge`, `/rooms`, `/activities`, `/catering`) and also builds a server bundle. The existing Firebase workflow deploys only the browser output. Therefore Firebase serves prerendered HTML; request-time SSR would require a server deployment change, which this migration does not make. Pages are Angular Router routes. `/admin/**` is client-rendered (it needs a signed-in staff session) and Firebase Hosting rewrites every path without a static file to `/index.csr.html`, so hard refreshes and deep links work.

## Running locally

Use a Node version supported by the installed Angular CLI. On this computer, `nvm use 24.22.2` selects a compatible version; the default Node 22.18.0 is too old.

```sh
nvm use 24.22.2
npm start
```

The application initially uses local demo mode. Demo data is stored only in this browser under `h20-angular-demo-v1`. Use fictitious contact details. Live credentials and staff tokens are never stored in this local demo database.

## Connecting n8n

See [the n8n setup guide](../backend/n8n/README.md). The workspace provided for this project is https://neovenio.app.n8n.cloud.

`public/h20-runtime.json` is a new application runtime setting, not an Angular/build/hosting configuration. Its empty `n8nWebhookBaseUrl` deliberately keeps the app usable until the workflows have been imported, configured and published. After setup, set it to:

```json
{
  "n8nWebhookBaseUrl": "https://neovenio.app.n8n.cloud/webhook/h20"
}
```

Preserve the existing `firebase` settings when adding this URL. Firebase web configuration contains a public API key; secret Gemini, SMTP or provider credentials must only be stored in n8n. In connected mode, a failing n8n request shows an error rather than pretending the booking succeeded. Live requests are stored by n8n. Customers must sign in to access their own requests; personal request links also require ownership. The employee webhook verifies Firebase identity and the administrator-assigned `staff` claim. The browser uses session-scoped Firebase sign-in persistence.

## Scope and differences

The original ZIP mixes demonstration payment states with real-looking confirmations. The migrated live backend handles concept requests and staff review. It does not take payments, process real refunds or guarantee reservations. Payment/refund history is retained for local demonstration only. Unknown prices remain “op aanvraag”; the server calculates known costs from its own catalogue rather than trusting browser totals.

The public catalogue in connected mode comes from reviewed scraped sources, not from the demo data. The scraper stages descriptions and image URLs from official H20 pages; staff review and publish entries through “Brongegevens”. Review unknown capacity and room identity before publishing. The H20 Event Zaal and Rabo Esports Stadium pages may describe the same physical venue.

The browser exports a printable concept offer rather than using a new PDF dependency. Email delivery requires workflow D, a verified sender and an SMTP credential. WhatsApp, payment providers and camera occupancy are not integrated.

## Validation commands

```sh
npm run build
npm run lint
npm run test:ci
npm run format:check
node --test backend/n8n/tests/domain.test.cjs
```

The n8n tests run the same domain logic embedded in the exported Code nodes, check workflow connections and syntax, and cover input validation, trusted prices, conflict checks, private request access, approval, retries, source staging and notification receipts. They do not replace importing and running the workflows in the actual n8n instance with its credentials.
