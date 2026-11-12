const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validate, writeRuntimeConfig, ENVIRONMENTS } = require('./write-runtime-config.cjs');

const root = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

test('committed env files pass validation', () => {
  for (const env of ENVIRONMENTS) {
    assert.doesNotThrow(() => validate(read(`config/runtime/${env}.json`)));
  }
});

test('dev config targets the dev project and matches the local public file', () => {
  const dev = read('config/runtime/dev.json');
  assert.strictEqual(dev.firebase.projectId, 'h20-event-assistant-dev');
  assert.deepStrictEqual(read('public/h20-runtime.json'), dev);
});

test('prod config never points at the dev project', () => {
  const prod = read('config/runtime/prod.json');
  assert.ok(prod.firebase.projectId === 'h20-event-assistant-prod' || prod.firebase.apiKey === '');
  assert.notStrictEqual(prod.firebase.projectId, 'h20-event-assistant-dev');
});

test('validation rejects unexpected top-level and firebase keys', () => {
  const good = read('config/runtime/dev.json');
  assert.throws(() => validate({ ...good, secret: 'x' }), /secret/);
  assert.throws(
    () => validate({ ...good, firebase: { ...good.firebase, privateKey: 'x' } }),
    /privateKey/,
  );
  assert.throws(() => validate({ firebase: good.firebase }), /n8nWebhookBaseUrl/);
});

test('writeRuntimeConfig writes the env file into the output dir', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'h20-'));
  writeRuntimeConfig('prod', out);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(out, 'h20-runtime.json'), 'utf8')),
    read('config/runtime/prod.json'),
  );
  assert.throws(() => writeRuntimeConfig('nope', out), /Unknown environment/);
});
