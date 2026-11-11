# H20 Event Assistant

An AI event-planning and booking assistant for H20 Event Location in Purmerend. Visitors describe their event, get a suggested plan and price, and submit a booking request. Staff review and approve requests before the customer sees the generated explanation.

## Architecture

- **Frontend:** Angular 22 with SSR/prerender (`src/`).
- **Auth and hosting:** Firebase Authentication and Firebase Hosting (`firebase.json`, `.firebaserc`).
- **Backend:** n8n webhooks plus an n8n Data Table (`backend/n8n/`).
- **AI:** Gemini is called from n8n, never from the browser.

## Demo vs connected mode

The app reads a public runtime JSON file (today `public/h20-runtime.json`). If `n8nWebhookBaseUrl` is empty, the app runs in demo mode with local sample data. If it points at the n8n webhook base URL, the app runs in connected mode. This file is public: never put secrets in it.

## Run locally

The Angular CLI 22 needs Node `^22.22.3 || ^24.15.0 || >=26`. The repo pins `24.15.0` in `.nvmrc`.

```bash
nvm use
npm ci
npm start
```

## Validation

```bash
npm run build
npm run lint
npm run test:ci
npm run format:check
node --test backend/n8n/tests/domain.test.cjs
```

## Deployment

CI (`.github/workflows/ci-cd.yml`) runs format, lint, test and build. Pushing to `main` deploys production; pushing to `dev` deploys the dev environment.

## More documentation

- [Angular migration notes](docs/ANGULAR-MIGRATION.md)
- [n8n backend README](backend/n8n/README.md)
- [Issue tracker contract](docs/agents/issue-tracker.md)
