const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyStaffClaim, parseArgs } = require('../staff-claim.cjs');

test('grant on empty claims', () => {
  assert.deepEqual(applyStaffClaim(undefined, 'grant'), { staff: true });
  assert.deepEqual(applyStaffClaim({}, 'grant'), { staff: true });
});
test('grant preserves other claims and does not mutate input', () => {
  const existing = { admin: false, tier: 'x' };
  assert.deepEqual(applyStaffClaim(existing, 'grant'), { admin: false, tier: 'x', staff: true });
  assert.deepEqual(existing, { admin: false, tier: 'x' });
});
test('revoke removes only staff', () => {
  assert.deepEqual(applyStaffClaim({ staff: true, tier: 'x' }, 'revoke'), { tier: 'x' });
});
test('revoke without staff is a no-op', () => {
  assert.deepEqual(applyStaffClaim({ tier: 'x' }, 'revoke'), { tier: 'x' });
  assert.deepEqual(applyStaffClaim(undefined, 'revoke'), {});
});
test('invalid action throws', () => {
  assert.throws(() => applyStaffClaim({}, 'show'));
});

test('parseArgs accepts valid combinations', () => {
  assert.deepEqual(parseArgs(['--project', 'p', '--email', 'a@b.c', '--grant']), {
    project: 'p',
    email: 'a@b.c',
    uid: undefined,
    action: 'grant',
  });
  assert.equal(parseArgs(['--project', 'p', '--uid', 'u1', '--revoke']).action, 'revoke');
  assert.equal(parseArgs(['--project=p', '--uid=u1', '--show']).action, 'show');
});
test('parseArgs rejects invalid combinations', () => {
  const bad = [
    [],
    ['--email', 'a@b.c', '--grant'],
    ['--project', 'p', '--grant'],
    ['--project', 'p', '--email', 'a@b.c', '--uid', 'u', '--grant'],
    ['--project', 'p', '--email', 'a@b.c'],
    ['--project', 'p', '--email', 'a@b.c', '--grant', '--revoke'],
    ['--project', 'p', '--email', 'a@b.c', '--grant', '--show'],
    ['--project', '--email', 'a@b.c', '--grant'],
    ['--project', 'p', '--email', 'a@b.c', '--grant', '--bogus'],
  ];
  for (const argv of bad) assert.throws(() => parseArgs(argv), /./, JSON.stringify(argv));
});
