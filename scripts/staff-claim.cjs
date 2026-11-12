#!/usr/bin/env node
/* Grant/revoke/show the Firebase `staff` custom claim. See scripts/README.md. */

function applyStaffClaim(existing, action) {
  const claims = { ...(existing || {}) };
  if (action === 'grant') claims.staff = true;
  else if (action === 'revoke') delete claims.staff;
  else throw new Error(`Unknown action "${action}" (expected grant or revoke).`);
  return claims;
}

const USAGE =
  'Usage: node scripts/staff-claim.cjs --project <id> (--email <addr> | --uid <uid>) (--grant | --revoke | --show)';

class UsageError extends Error {}

function parseArgs(argv) {
  const values = {};
  const actions = [];
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    if (['--grant', '--revoke', '--show'].includes(arg)) {
      actions.push(arg.slice(2));
    } else if (['--project', '--email', '--uid'].includes(arg)) {
      const value = inline ?? argv[++i];
      if (!value || value.startsWith('--')) throw new UsageError(`Missing value for ${arg}.`);
      if (values[arg] !== undefined) throw new UsageError(`Duplicate flag ${arg}.`);
      values[arg] = value;
    } else {
      throw new UsageError(`Unknown argument "${arg}".`);
    }
  }
  if (!values['--project']) throw new UsageError('--project <firebaseProjectId> is required.');
  if (!!values['--email'] === !!values['--uid']) {
    throw new UsageError('Provide exactly one of --email or --uid.');
  }
  if (actions.length !== 1) {
    throw new UsageError('Provide exactly one of --grant, --revoke or --show.');
  }
  return {
    project: values['--project'],
    email: values['--email'],
    uid: values['--uid'],
    action: actions[0],
  };
}

async function main(argv) {
  const opts = parseArgs(argv);
  // Lazy require: keeps argument parsing and tests free of firebase-admin / credentials.
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  initializeApp({ credential: applicationDefault(), projectId: opts.project });
  const auth = getAuth();

  let user;
  try {
    user = opts.email ? await auth.getUserByEmail(opts.email) : await auth.getUser(opts.uid);
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') {
      throw new Error(`No user found for ${opts.email ?? opts.uid} in project ${opts.project}.`);
    }
    throw error;
  }

  let claims = user.customClaims || {};
  if (opts.action !== 'show') {
    claims = applyStaffClaim(claims, opts.action);
    await auth.setCustomUserClaims(user.uid, claims);
    if (opts.action === 'revoke') await auth.revokeRefreshTokens(user.uid);
  }
  console.log(`User ${user.email ?? user.uid} (${user.uid}) claims: ${JSON.stringify(claims)}`);
  if (opts.action !== 'show') {
    console.log(
      'The user must sign out and back in (or refresh their ID token) for this to apply.',
    );
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Error: ${error.message}`);
    if (error instanceof UsageError) console.error(USAGE);
    process.exit(1);
  });
}

module.exports = { applyStaffClaim, parseArgs };
