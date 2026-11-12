# Scripts

## staff-claim.cjs

Grants, revokes or shows the Firebase custom claim `staff` (required for staff access). Run it locally as an administrator, never from the browser. `firebase-admin` is a devDependency and is not part of the Angular bundle.

Credentials: Application Default Credentials (`gcloud auth application-default login`) or `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account key outside the repo. Never commit key files.

```bash
node scripts/staff-claim.cjs --project <firebaseProjectId> --email person@example.com --grant
node scripts/staff-claim.cjs --project <firebaseProjectId> --uid <uid> --revoke
node scripts/staff-claim.cjs --project <firebaseProjectId> --email person@example.com --show
```

Other custom claims are preserved. `--revoke` also revokes refresh tokens. The user must sign out and back in (or refresh their ID token) before a change takes effect.

Tests: `npm run test:scripts` (no network or credentials needed; also run by `npm run test:ci`).
