const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('check-requirements verifies official brand palette and webfont stack', () => {
  const defaultRun = spawnSync(process.execPath, ['scripts/check-requirements.cjs'], {
    encoding: 'utf8',
  });
  assert.match(defaultRun.stdout, /^PASS: Merkpalet aanwezig$/m);
  assert.match(defaultRun.stdout, /^PASS: Officieel lettertype \/ webfont-stack ingesteld$/m);
  assert.doesNotMatch(
    defaultRun.stdout,
    /Visuele gelijkheid met officiële website en exact lettertype/,
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h20-req-'));
  const runtimePath = path.join(tmpDir, 'h20-runtime.json');
  const baseRuntime = JSON.parse(fs.readFileSync('public/h20-runtime.json', 'utf8'));
  fs.writeFileSync(
    runtimePath,
    JSON.stringify({ ...baseRuntime, n8nWebhookBaseUrl: 'https://example.test/webhook/h20' }),
  );
  const configuredOut = execFileSync(process.execPath, ['scripts/check-requirements.cjs'], {
    encoding: 'utf8',
    env: { ...process.env, H20_RUNTIME_PATH: runtimePath },
  });
  assert.doesNotMatch(configuredOut, /^ONTBREEKT:/m);
});

test('brand.css and index.html follow H20 Elementor tokens and modern-web-guidance rules', () => {
  const indexHtml = fs.readFileSync('src/index.html', 'utf8');
  const css = fs.readFileSync('src/app/event-assistant/brand.css', 'utf8');

  assert.match(indexHtml, /<link\s+rel="preconnect"\s+href="https:\/\/fonts\.googleapis\.com"/);
  assert.match(
    indexHtml,
    /<link\s+rel="preconnect"\s+href="https:\/\/fonts\.gstatic\.com"\s+crossorigin/,
  );
  assert.match(
    indexHtml,
    /family=Barlow:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap/,
  );
  assert.doesNotMatch(css, /@import/);

  assert.match(
    css,
    /--h20-font-sans:\s*'nudista-web',\s*'Barlow',\s*Arial,\s*Helvetica,\s*sans-serif;/,
  );
  assert.match(css, /--h20-deep-blue:\s*#364b9b;/i);
  assert.match(css, /--h20-charcoal:\s*#333333;/i);
  assert.match(css, /font-size-adjust:\s*from-font;/);
  assert.match(css, /font-size-adjust:\s*cap-height from-font;/);
  assert.match(css, /text-wrap:\s*balance;/);
  assert.match(css, /text-wrap:\s*pretty;/);

  // No raw px font-size declarations in brand.css; clamp() max <= 2.5x min for WCAG 1.4.4 zoom
  assert.doesNotMatch(css, /font-size:\s*\d+px/);
  const clamps = [...css.matchAll(/clamp\(\s*([\d.]+)rem\s*,[^,]+,\s*([\d.]+)rem\s*\)/g)];
  assert.ok(clamps.length >= 4, 'expected responsive clamp() rules for headings');
  for (const [full, minRem, maxRem] of clamps) {
    assert.ok(
      Number(maxRem) <= Number(minRem) * 2.5,
      `${full} exceeds 2.5x min ratio required for 200% zoom`,
    );
  }

  // Pill CTA buttons with WCAG AAA black-on-cyan hover
  assert.match(css, /border-radius:\s*999px;/);
  assert.match(
    css,
    /\.primary:hover:not\(:disabled\)[\s\S]*?background:\s*#5fc2d2;\s*color:\s*#000000;/i,
  );
});
