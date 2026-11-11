const fs = require('node:fs');
const css = fs.readFileSync('src/app/event-assistant/brand.css', 'utf8');
const html = fs.readFileSync('src/app/app.html', 'utf8');
const runtime = JSON.parse(fs.readFileSync('public/h20-runtime.json', 'utf8'));
const demoData = fs.readFileSync('src/app/event-assistant/data/initial-data.ts', 'utf8');
const demoImageUrls = [...demoData.matchAll(/imageUrl:\s*'([^']+)'/g)].map((m) => m[1]);
const checks = [
  [
    'Merkpalet aanwezig',
    ['#000000', '#FFFFFF', '#E1014B', '#5FC2D2'].every((c) =>
      css.toLowerCase().includes(c.toLowerCase()),
    ),
  ],
  ['Aangeleverd logo aanwezig', fs.existsSync('public/assets/brand/h20-logo.png')],
  ['Inklapbare navigatie', html.includes('aria-expanded') && html.includes('nav-collapsed')],
  ['Officiële website gelinkt', html.includes('https://eventlocatie.h20.gg/')],
  ['Lijniconen aanwezig', html.includes('app-icon')],
  [
    'Demo-afbeeldingen bestaan in public/',
    demoImageUrls.length > 0 &&
      demoImageUrls.every((url) => {
        const exists = fs.existsSync(`public${url}`);
        if (!exists) console.log(`Ontbrekend bestand: public${url}`);
        return exists;
      }),
  ],
  ['n8n URL ingesteld', !!runtime.n8nWebhookBaseUrl],
];
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'ONTBREEKT'}: ${label}`);
for (const item of [
  'Visuele gelijkheid met officiële website en exact lettertype',
  'Productie-authenticatie voor klanten en medewerkers',
  'Live n8n/Gemini en uitsluitend gecontroleerde broncatalogus',
  'Budgetgarantie inclusief onbekende tarieven',
  'Echte PDF-download (momenteel browser afdrukken)',
  'Directe e-mail/WhatsApp-aflevering',
  'Afspraken met gecontroleerde beschikbaarheid',
  'End-to-end productiecontrole van alle functionele eisen',
])
  console.log(`NOG TE VERIFIËREN / IMPLEMENTEREN: ${item}`);
console.log(
  'Deze controle geeft geen productiecertificering. Live diensten vereisen integratietests.',
);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
