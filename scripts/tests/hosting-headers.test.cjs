const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const firebase = JSON.parse(fs.readFileSync(path.join(__dirname, '../../firebase.json'), 'utf8'));

function headersFor(source) {
  const rule = (firebase.hosting.headers ?? []).find((entry) => entry.source === source);
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

test('Hosting sends security headers on every response', () => {
  const headers = headersFor('**');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.match(headers['content-security-policy'] ?? '', /frame-ancestors 'none'/);
  assert.match(headers['content-security-policy'] ?? '', /object-src 'none'/);
  assert.match(headers['content-security-policy'] ?? '', /base-uri 'self'/);
  // Firebase API keys may be referrer-restricted, so the origin must still be sent cross-site.
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['permissions-policy'] ?? '', /camera=\(\)/);
});
