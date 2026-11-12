# H20 Event Assistant

Angular 22 app (SSR/prerender) with Firebase Auth/Hosting and an n8n backend exported under `backend/n8n/`. See `README.md` for the overview.

## Setup

Use the Node version in `.nvmrc` (`nvm use`), then `npm ci`.

## Commands

- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test:ci`
- Format check: `npm run format:check` (fix with `npm run format`)
- n8n domain tests: `node --test backend/n8n/tests/domain.test.cjs`

## n8n edit flow

Never hand-edit `backend/n8n/workflows/*.json`. Instead:

1. Edit the shared modules in `backend/n8n/code/`.
2. `node backend/n8n/generate-workflows.cjs`
3. `npx prettier --write backend/n8n`
4. `node --test backend/n8n/tests/domain.test.cjs`

## Rules

- Never put secrets in the public runtime JSON (`public/h20-runtime.json` today) or commit secrets anywhere.
- Pushing to `main` deploys prod; pushing to `dev` deploys dev. Use PRs.
- Issue workflow: see `docs/agents/issue-tracker.md`.
