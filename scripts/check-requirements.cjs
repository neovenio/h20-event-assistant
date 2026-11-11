const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

function checkRequirements(rootDir = DEFAULT_ROOT, log = console.log) {
  const resolve = (relPath) => path.join(rootDir, relPath);
  const css = fs.readFileSync(resolve('src/app/event-assistant/brand.css'), 'utf8');
  const html = fs.readFileSync(resolve('src/app/app.html'), 'utf8');
  const runtime = JSON.parse(fs.readFileSync(resolve('public/h20-runtime.json'), 'utf8'));
  const demoData = fs.readFileSync(resolve('src/app/event-assistant/data/initial-data.ts'), 'utf8');
  const demoImageUrls = [...demoData.matchAll(/imageUrl:\s*'([^']+)'/g)].map((m) => m[1]);
  const checks = [
    [
      'Merkpalet aanwezig',
      ['#000000', '#FFFFFF', '#E1014B', '#5FC2D2'].every((c) =>
        css.toLowerCase().includes(c.toLowerCase()),
      ),
    ],
    ['Aangeleverd logo aanwezig', fs.existsSync(resolve('public/assets/brand/h20-logo.png'))],
    ['Inklapbare navigatie', html.includes('aria-expanded') && html.includes('nav-collapsed')],
    ['Officiële website gelinkt', html.includes('https://eventlocatie.h20.gg/')],
    ['Lijniconen aanwezig', html.includes('app-icon')],
    [
      'Demo-afbeeldingen bestaan in public/',
      demoImageUrls.length > 0 &&
        demoImageUrls.every((url) => {
          const exists = fs.existsSync(resolve(`public${url}`));
          if (!exists) log(`Ontbrekend bestand: public${url}`);
          return exists;
        }),
    ],
    ['n8n URL ingesteld', !!runtime.n8nWebhookBaseUrl],
  ];
  for (const [label, ok] of checks) log(`${ok ? 'PASS' : 'ONTBREEKT'}: ${label}`);

  const paymentsAdr = 'docs/adr/0002-descope-online-payments.md';
  const whatsappAdr = 'docs/adr/0003-descope-whatsapp-notifications.md';
  const hasPaymentsAdr = fs.existsSync(resolve(paymentsAdr));
  const hasWhatsappAdr = fs.existsSync(resolve(whatsappAdr));

  const descoped = [
    ['Online betalingen', paymentsAdr, hasPaymentsAdr],
    ['WhatsApp-notificaties', whatsappAdr, hasWhatsappAdr],
  ];
  for (const [label, adrPath, exists] of descoped) {
    if (exists) log(`BUITEN SCOPE (ADR): ${label} (${adrPath})`);
  }

  for (const item of [
    'Visuele gelijkheid met officiële website en exact lettertype',
    'Productie-authenticatie voor klanten en medewerkers',
    'Live n8n/Gemini en uitsluitend gecontroleerde broncatalogus',
    'Budgetgarantie inclusief onbekende tarieven',
    'Echte PDF-download (momenteel browser afdrukken)',
    hasWhatsappAdr
      ? 'Directe e-mailaflevering (workflow D; WhatsApp buiten scope per ADR 0003)'
      : 'Directe e-mail/WhatsApp-aflevering',
    'Afspraken met gecontroleerde beschikbaarheid',
    ...(hasPaymentsAdr ? [] : ['Online betalingen']),
    'End-to-end productiecontrole van alle functionele eisen',
  ])
    log(`NOG TE VERIFIËREN / IMPLEMENTEREN: ${item}`);

  log('Deze controle geeft geen productiecertificering. Live diensten vereisen integratietests.');
  const passed = checks.every(([, ok]) => ok);
  return { passed, checks, descoped };
}

if (require.main === module) {
  const { passed } = checkRequirements();
  process.exitCode = passed ? 0 : 1;
}

module.exports = { checkRequirements };
