#!/usr/bin/env node
// Writes the per-environment public runtime config (config/runtime/<env>.json)
// to <outDir>/h20-runtime.json. Fails if the file has keys beyond public config.
const fs = require('node:fs');
const path = require('node:path');

const ENVIRONMENTS = ['dev', 'prod'];
const TOP_KEYS = ['n8nWebhookBaseUrl', 'firebase'];
const FIREBASE_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'appId',
  'storageBucket',
  'messagingSenderId',
  'measurementId',
  'projectNumber',
  'version',
];

function validate(config) {
  const errors = [];
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(config)) throw new Error('Runtime config must be an object');
  for (const k of Object.keys(config)) {
    if (!TOP_KEYS.includes(k)) errors.push(`unexpected key "${k}"`);
  }
  if (typeof config.n8nWebhookBaseUrl !== 'string') {
    errors.push('n8nWebhookBaseUrl must be a string');
  }
  if (!isObj(config.firebase)) {
    errors.push('firebase must be an object');
  } else {
    for (const [k, v] of Object.entries(config.firebase)) {
      if (!FIREBASE_KEYS.includes(k)) errors.push(`unexpected key "firebase.${k}"`);
      else if (typeof v !== 'string') errors.push(`firebase.${k} must be a string`);
    }
  }
  if (errors.length) throw new Error(`Invalid runtime config: ${errors.join('; ')}`);
}

function writeRuntimeConfig(env, outDir) {
  if (!ENVIRONMENTS.includes(env)) throw new Error(`Unknown environment "${env}"`);
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'runtime', `${env}.json`), 'utf8'),
  );
  validate(config);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'h20-runtime.json'), JSON.stringify(config, null, 2) + '\n');
}

module.exports = { validate, writeRuntimeConfig, ENVIRONMENTS };

if (require.main === module) {
  const [env, outDir = 'dist/h20-event-assistant/browser'] = process.argv.slice(2);
  writeRuntimeConfig(env, outDir);
  console.log(`Wrote ${env} runtime config to ${path.join(outDir, 'h20-runtime.json')}`);
}
