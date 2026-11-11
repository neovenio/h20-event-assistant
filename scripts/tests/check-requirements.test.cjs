const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkRequirements } = require('../check-requirements.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(repoRoot, 'scripts/check-requirements.cjs');

function createFixtureRoot({
  n8nWebhookBaseUrl = 'https://example.test/webhook/h20',
  adrs = true,
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h20-req-'));
  fs.mkdirSync(path.join(tmp, 'src/app/event-assistant/data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'public/assets/brand'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'public/assets/venue'), { recursive: true });

  fs.writeFileSync(
    path.join(tmp, 'src/app/event-assistant/brand.css'),
    ":root { --black: #000000; --white: #ffffff; --pink: #e1014b; --cyan: #5fc2d2; --h20-font-sans: 'nudista-web', 'Barlow', sans-serif; }",
  );
  fs.writeFileSync(
    path.join(tmp, 'src/index.html'),
    '<link href="https://fonts.googleapis.com/css2?family=Barlow" rel="stylesheet">',
  );
  fs.writeFileSync(
    path.join(tmp, 'src/app/app.html'),
    '<nav aria-expanded="true" class="nav-collapsed"><a href="https://eventlocatie.h20.gg/"><app-icon /></a></nav>',
  );
  fs.writeFileSync(
    path.join(tmp, 'public/h20-runtime.json'),
    JSON.stringify({ n8nWebhookBaseUrl }),
  );
  fs.writeFileSync(path.join(tmp, 'public/assets/brand/h20-logo.png'), 'logo');
  fs.writeFileSync(path.join(tmp, 'public/assets/venue/room.png'), 'img');
  fs.writeFileSync(
    path.join(tmp, 'src/app/event-assistant/data/initial-data.ts'),
    "export const ROOMS = [{ imageUrl: '/assets/venue/room.png' }];\n",
  );

  if (adrs) {
    fs.mkdirSync(path.join(tmp, 'docs/adr'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'docs/adr/0002-descope-online-payments.md'), '# ADR 0002\n');
    fs.writeFileSync(
      path.join(tmp, 'docs/adr/0003-descope-whatsapp-notifications.md'),
      '# ADR 0003\n',
    );
  }
  return tmp;
}

test('reports descoped ADRs and email-only delivery when ADR files exist', () => {
  const tmp = createFixtureRoot({ adrs: true });
  try {
    const lines = [];
    const result = checkRequirements(tmp, (line) => lines.push(line));
    assert.equal(result.passed, true);
    assert.ok(lines.includes('PASS: Merkpalet aanwezig'));
    assert.ok(lines.includes('PASS: n8n URL ingesteld'));
    assert.ok(
      lines.includes(
        'BUITEN SCOPE (ADR): Online betalingen (docs/adr/0002-descope-online-payments.md)',
      ),
    );
    assert.ok(
      lines.includes(
        'BUITEN SCOPE (ADR): WhatsApp-notificaties (docs/adr/0003-descope-whatsapp-notifications.md)',
      ),
    );
    assert.ok(
      lines.includes(
        'NOG TE VERIFIËREN / IMPLEMENTEREN: Directe e-mailaflevering (workflow D; WhatsApp buiten scope per ADR 0003)',
      ),
    );
    assert.ok(
      !lines.includes('NOG TE VERIFIËREN / IMPLEMENTEREN: Directe e-mail/WhatsApp-aflevering'),
    );
    assert.ok(!lines.includes('NOG TE VERIFIËREN / IMPLEMENTEREN: Online betalingen'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('falls back to pending verification lines when ADR files or n8n URL are absent', () => {
  const tmp = createFixtureRoot({ n8nWebhookBaseUrl: '', adrs: false });
  try {
    const lines = [];
    const result = checkRequirements(tmp, (line) => lines.push(line));
    assert.equal(result.passed, false);
    assert.ok(lines.includes('ONTBREEKT: n8n URL ingesteld'));
    assert.ok(!lines.some((line) => line.startsWith('BUITEN SCOPE (ADR):')));
    assert.ok(
      lines.includes('NOG TE VERIFIËREN / IMPLEMENTEREN: Directe e-mail/WhatsApp-aflevering'),
    );
    assert.ok(lines.includes('NOG TE VERIFIËREN / IMPLEMENTEREN: Online betalingen'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI execution on repository detects ADR 0002 and ADR 0003', () => {
  const runtime = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'public/h20-runtime.json'), 'utf8'),
  );
  const run = spawnSync(process.execPath, [scriptPath], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, runtime.n8nWebhookBaseUrl ? 0 : 1);
  assert.match(
    run.stdout,
    /BUITEN SCOPE \(ADR\): Online betalingen \(docs\/adr\/0002-descope-online-payments\.md\)/,
  );
  assert.match(
    run.stdout,
    /BUITEN SCOPE \(ADR\): WhatsApp-notificaties \(docs\/adr\/0003-descope-whatsapp-notifications\.md\)/,
  );
  assert.match(
    run.stdout,
    /NOG TE VERIFIËREN \/ IMPLEMENTEREN: Directe e-mailaflevering \(workflow D; WhatsApp buiten scope per ADR 0003\)/,
  );
});
