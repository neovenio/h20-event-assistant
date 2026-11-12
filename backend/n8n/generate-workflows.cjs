const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const domain = fs
  .readFileSync(path.join(root, 'code/domain.cjs'), 'utf8')
  .split('if (typeof module')[0];
const scrape = fs
  .readFileSync(path.join(root, 'code/scrape.cjs'), 'utf8')
  .split('if (typeof module')[0];
const DEV_ORIGINS =
  'https://h20-event-assistant-dev.web.app,https://h20-event-assistant-prod.web.app,http://localhost:4200';
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// One small per-environment value table. Dev reads public/h20-runtime.json exactly as before;
// prod reads config/runtime/prod.json (H20_PROD_RUNTIME_CONFIG overrides the path, for tests).
const ENVS = {
  dev: {
    name: 'dev',
    outDir: 'workflows',
    namePrefix: '',
    webhookPath: 'h20',
    webhookIdPrefix: 'h20',
    allowedOrigins: DEV_ORIGINS,
    frontendOrigin: 'https://h20-event-assistant-dev.web.app',
    configFile: path.join(root, '../../public/h20-runtime.json'),
  },
  prod: {
    name: 'prod',
    outDir: 'workflows/prod',
    namePrefix: '[PROD] ',
    webhookPath: 'h20-prod',
    webhookIdPrefix: 'h20-prod',
    allowedOrigins:
      'https://h20-event-assistant-prod.web.app,https://h20-event-assistant-prod.firebaseapp.com',
    frontendOrigin: 'https://h20-event-assistant-prod.web.app',
    configFile:
      process.env.H20_PROD_RUNTIME_CONFIG || path.join(root, '../../config/runtime/prod.json'),
  },
};
for (const e of Object.values(ENVS)) e.firebase = readJson(e.configFile).firebase;
if (!ENVS.prod.firebase?.apiKey) {
  console.error(
    `Refusing to generate [PROD] workflows: firebase.apiKey is empty in ${ENVS.prod.configFile}. Populate the prod web config first.`,
  );
  process.exit(1);
}
let env = ENVS.dev;
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';
const table = { __rl: true, value: 'REPLACE_WITH_H20_DATA_TABLE_ID', mode: 'id' };
const settings = {
  executionOrder: 'v1',
  saveDataSuccessExecution: 'none',
  saveDataErrorExecution: 'none',
  saveManualExecutions: false,
  timezone: 'Europe/Amsterdam',
};
function node(name, type, parameters, x, y = 0, extra = {}) {
  return {
    parameters,
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    type: `n8n-nodes-base.${type}`,
    typeVersion:
      {
        webhook: 2.1,
        code: 2,
        if: 2.2,
        httpRequest: 4.2,
        respondToWebhook: 1.4,
        html: 1.2,
        dataTable: 1,
        manualTrigger: 1,
        stickyNote: 1,
        scheduleTrigger: 1.2,
        emailSend: 2.1,
      }[type] ?? 1,
    position: [x, y],
    ...extra,
  };
}
function code(name, jsCode, x, y = 0) {
  return node(name, 'code', { jsCode, mode: 'runOnceForAllItems' }, x, y);
}
function connect(connections, from, to, index = 0) {
  connections[from] ??= { main: [] };
  connections[from].main[index] ??= [];
  connections[from].main[index].push({ node: to, type: 'main', index: 0 });
}
function check(name, value, x, y = 0) {
  return node(
    name,
    'if',
    {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            id: name,
            leftValue: '={{ $json.route }}',
            rightValue: value,
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    x,
    y,
  );
}
function upsert(name, x, y = 0) {
  return node(
    name,
    'dataTable',
    {
      resource: 'row',
      operation: 'upsert',
      dataTableId: table,
      matchType: 'allConditions',
      filters: {
        conditions: [{ keyName: 'recordId', condition: 'eq', keyValue: '={{ $json.recordId }}' }],
      },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          recordId: '={{ $json.recordId }}',
          kind: '={{ $json.kind }}',
          payload: '={{ $json.payload }}',
        },
        schema: [
          { id: 'recordId', displayName: 'recordId', type: 'string' },
          { id: 'kind', displayName: 'kind', type: 'string' },
          { id: 'payload', displayName: 'payload', type: 'string' },
        ],
      },
      options: {},
    },
    x,
    y,
  );
}
function insertRow(name, x, y = 0) {
  return node(
    name,
    'dataTable',
    {
      resource: 'row',
      operation: 'insert',
      dataTableId: table,
      columns: {
        mappingMode: 'defineBelow',
        value: {
          recordId: '={{ $json.recordId }}',
          kind: '={{ $json.kind }}',
          payload: '={{ $json.payload }}',
        },
        schema: [
          { id: 'recordId', displayName: 'recordId', type: 'string' },
          { id: 'kind', displayName: 'kind', type: 'string' },
          { id: 'payload', displayName: 'payload', type: 'string' },
        ],
      },
      options: {},
    },
    x,
    y,
    { onError: 'continueRegularOutput' },
  );
}
/** Deletes one Data Table row per input item, by system id (`{ id }`). */
function deleteById(name, x, y = 0, extra = {}) {
  return node(
    name,
    'dataTable',
    {
      resource: 'row',
      operation: 'deleteRows',
      dataTableId: table,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: '={{ $json.id }}' }] },
    },
    x,
    y,
    // deleteRows outputs nothing when no row matches; the webhook must still be answered.
    { alwaysOutputData: true, ...extra },
  );
}
function write(file, name, nodes, connections) {
  fs.mkdirSync(path.join(root, env.outDir), { recursive: true });
  fs.writeFileSync(
    path.join(root, env.outDir, file),
    JSON.stringify(
      {
        name: env.namePrefix + name,
        nodes,
        connections,
        settings,
        active: false,
        pinData: {},
        tags: [],
      },
      null,
      2,
    ) + '\n',
  );
}
function apiWorkflow(admin) {
  const nodes = [],
    connections = {};
  const note = admin
    ? 'Attach an n8n Header Auth credential: header Authorization, value Bearer <random staff token>. Never place this token in Angular files. Set the Data Table ID. Keep inactive until configured.'
    : 'Set the Data Table ID and Gemini Header Auth credential (x-goog-api-key). Set allowedOrigins to your deployed Firebase origin. The API returns only the public catalogue and capability-scoped requests. Rate-limit this public endpoint at your ingress before opening it broadly.';
  nodes.push(node('Setup', 'stickyNote', { content: note, height: 180, width: 620 }, 0, -260));
  nodes.push(
    node(
      'Webhook',
      'webhook',
      {
        httpMethod: 'POST',
        path: `${env.webhookPath}/${admin ? 'admin' : 'public'}`,
        authentication: admin ? 'headerAuth' : 'none',
        responseMode: 'responseNode',
        options: {
          allowedOrigins: env.allowedOrigins,
        },
      },
      0,
      0,
      { webhookId: `${env.webhookIdPrefix}-${admin ? 'admin' : 'public'}` },
    ),
  );
  nodes.push(
    node(
      'Read records',
      'dataTable',
      { resource: 'row', operation: 'get', dataTableId: table, returnAll: true },
      220,
      0,
      { alwaysOutputData: true, onError: 'continueRegularOutput' },
    ),
  );
  // Reserve first, verify after: insert the claim row, re-read everything, lowest Data Table row id wins.
  const settle = `${domain}\ntry{const items=$input.all().map(item=>item.json);if(items.some(item=>item.error))throw new Error('De database is niet beschikbaar.');const inserts=$('Insert claim').all().map(item=>item.json);if(inserts.some(item=>item.error))fail('Opslaan mislukt. Probeer opnieuw met dezelfde aanvraagreferentie.',503);const context=$('Route request').first().json;const idOf=(recordId)=>inserts.find(item=>item.recordId===recordId)?.id;return [{json:settleClaim(context,parseRows(items),idOf(context.claimRow.recordId),context.hitRow?idOf(context.hitRow.recordId):undefined)}];}catch(error){return [{json:{route:'respond',status:error.status??503,response:{error:error.message??'Verzoek mislukt.'}}}];}`;
  // Hit-only requests (chat, claiming retry): decide on our own hit after the re-read, before Gemini.
  const decide = `${domain}\ntry{const items=$input.all().map(item=>item.json);if(items.some(item=>item.error))throw new Error('De database is niet beschikbaar.');const inserts=$('Insert hit').all().map(item=>item.json);if(inserts.some(item=>item.error))fail('De database is niet beschikbaar.',503);return [{json:decideHit($('Route request').first().json,parseRows(items),inserts[0]?.id)}];}catch(error){return [{json:{route:'respond',status:error.status??503,response:{error:error.message??'Verzoek mislukt.'}}}];}`;
  const routing = `${domain}\ntry { const items=$input.all().map(item=>item.json);if(items.some(item=>item.error))throw new Error('De database is niet beschikbaar.');const body=$('Webhook').first().json.body??{};if(JSON.stringify(body).length>25000)fail('Verzoek is te groot.',413);return [{json:${admin ? 'adminAction' : 'publicAction'}(body,parseRows(items))}]; }catch(error){return [{json:{route:'respond',status:error.status??503,response:{error:error.message??'Verzoek mislukt.'}}}];}`;
  nodes.push(code('Route request', routing, 440));
  nodes.push(check('Needs claim', 'claim', 660, 160));
  // One insert writes both rows (one per item): the claim and, for event requests, its rate hit.
  nodes.push(
    code(
      'Write claim',
      'const context=$("Route request").first().json;return [{json:context.claimRow}].concat(context.hitRow?[{json:context.hitRow}]:[]);',
      880,
      160,
    ),
  );
  nodes.push(insertRow('Insert claim', 1100, 160));
  nodes.push(
    node(
      'Re-read records after claim',
      'dataTable',
      { resource: 'row', operation: 'get', dataTableId: table, returnAll: true },
      1320,
      160,
      { alwaysOutputData: true, onError: 'continueRegularOutput' },
    ),
  );
  nodes.push(code('Settle claim', settle, 1540, 160));
  connect(connections, 'Route request', 'Needs claim');
  connect(connections, 'Needs claim', 'Write claim');
  connect(connections, 'Write claim', 'Insert claim');
  connect(connections, 'Insert claim', 'Re-read records after claim');
  connect(connections, 'Re-read records after claim', 'Settle claim');
  if (!admin) {
    nodes.push(check('Needs Gemini', 'gemini', 1100, -140));
    // Chat and a `claiming` retry insert only a rate hit: hit -> insert -> re-read -> decide.
    nodes.push(check('Needs hit', 'hit', 660, 360));
    nodes.push(
      code('Write hit', 'return [{json:$("Route request").first().json.hitRow}];', 880, 360),
    );
    nodes.push(insertRow('Insert hit', 1100, 360));
    nodes.push(
      node(
        'Re-read records after hit',
        'dataTable',
        { resource: 'row', operation: 'get', dataTableId: table, returnAll: true },
        1320,
        360,
        { alwaysOutputData: true, onError: 'continueRegularOutput' },
      ),
    );
    nodes.push(code('Decide hit', decide, 1540, 360));
    // Best-effort prune of expired hits: one item per id, errors ignored, a dead-end branch.
    nodes.push(
      code(
        'Prune payload',
        'return ($input.first().json.pruneRowIds??[]).map(id=>({json:{id}}));',
        1320,
        -300,
      ),
    );
    nodes.push(deleteById('Prune expired hits', 1540, -300, { onError: 'continueRegularOutput' }));
    nodes.push(
      node(
        'Gemini',
        'httpRequest',
        {
          method: 'POST',
          url: `${GEMINI_API}/${GEMINI_MODEL}:generateContent`,
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ $json.geminiBody }}',
          options: { timeout: 25000 },
        },
        2200,
        -220,
        { onError: 'continueRegularOutput' },
      ),
    );
    // The primary model can stall or answer 503 under load; retry once on a second model.
    // Both timeouts together stay well under the browser's 60 s abort.
    nodes.push(
      node(
        'Gemini failed',
        'if',
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
            conditions: [
              {
                id: 'Gemini failed',
                leftValue: '={{ $json.error !== undefined }}',
                rightValue: '',
                operator: { type: 'boolean', operation: 'true', singleValue: true },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
        2420,
        -220,
      ),
    );
    nodes.push(
      node(
        'Gemini fallback',
        'httpRequest',
        {
          method: 'POST',
          url: `${GEMINI_API}/${GEMINI_FALLBACK_MODEL}:generateContent`,
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ $("Needs Gemini").first().json.geminiBody }}',
          options: { timeout: 20000 },
        },
        2640,
        -320,
        { onError: 'continueRegularOutput' },
      ),
    );
    nodes.push(
      code(
        'Validate AI output',
        `${domain}\ntry{return [{json:finishGemini($('Route request').first().json,$input.first().json)}];}catch(error){return [{json:{route:'respond',status:error.status??503,response:{error:error.message??'AI niet bereikbaar.'}}}];}`,
        2860,
        -220,
      ),
    );
    nodes.push(code('Result', 'return $input.all();', 3080));
    connect(connections, 'Settle claim', 'Needs Gemini');
    connect(connections, 'Needs claim', 'Needs hit', 1);
    connect(connections, 'Needs hit', 'Write hit');
    connect(connections, 'Needs hit', 'Result', 1);
    connect(connections, 'Write hit', 'Insert hit');
    connect(connections, 'Insert hit', 'Re-read records after hit');
    connect(connections, 'Re-read records after hit', 'Decide hit');
    connect(connections, 'Decide hit', 'Needs Gemini');
    // Prune first (best effort, never blocks), then Gemini; a denied request answers instead.
    connect(connections, 'Needs Gemini', 'Prune payload');
    connect(connections, 'Needs Gemini', 'Gemini');
    connect(connections, 'Needs Gemini', 'Result', 1);
    connect(connections, 'Prune payload', 'Prune expired hits');
    connect(connections, 'Gemini', 'Gemini failed');
    connect(connections, 'Gemini failed', 'Gemini fallback');
    connect(connections, 'Gemini failed', 'Validate AI output', 1);
    connect(connections, 'Gemini fallback', 'Validate AI output');
    connect(connections, 'Validate AI output', 'Result');
  } else {
    nodes.push(code('Result', 'return $input.all();', 1760, 160));
    connect(connections, 'Needs claim', 'Result', 1);
    connect(connections, 'Settle claim', 'Result');
  }
  const offset = admin ? 1980 : 3300;
  nodes.push(check('Needs delete', 'lost', offset - 220, 160));
  // One item per row id (our claim, our hit, expired hits). Never empty, so the webhook is always
  // answered: the sentinel id 0 matches no row.
  nodes.push(
    code(
      'Lost claim ids',
      'const ids=$("Result").first().json.deleteRowIds??[];return (ids.length?ids:[0]).map(id=>({json:{id}}));',
      offset - 110,
      260,
    ),
  );
  nodes.push(deleteById('Delete lost claim', offset, 260, { onError: 'continueRegularOutput' }));
  // A failed delete still answers 409/429: a leftover row only errs on the cautious side. The
  // node runs once for all delete outputs, so the webhook is answered exactly once.
  nodes.push(
    code(
      'After lost claim',
      `const result=$('Result').first().json;return [{json:{status:result.status,response:result.response}}];`,
      offset + 220,
      260,
    ),
  );
  nodes.push(check('Needs save', 'save', offset));
  nodes.push(
    code('Write payload', 'return [{json:$("Result").first().json.write}];', offset + 220, -100),
  );
  nodes.push(upsert('Save record', offset + 440, -100));
  nodes[nodes.length - 1].onError = 'continueRegularOutput';
  nodes.push(
    code(
      'After save',
      `const result=$('Result').first().json;const saved=$input.all();if(saved.some(item=>item.json.error))return [{json:{status:503,response:{error:'Opslaan mislukt. Probeer opnieuw met dezelfde aanvraagreferentie.'}}}];return [{json:{status:result.status,response:result.response}}];`,
      offset + 660,
      -100,
    ),
  );
  nodes.push(
    node(
      'Respond',
      'respondToWebhook',
      {
        respondWith: 'json',
        responseBody: '={{ $json.response }}',
        options: {
          responseCode: '={{ $json.status }}',
          responseHeaders: {
            entries: [
              { name: 'Cache-Control', value: 'no-store' },
              { name: 'X-Content-Type-Options', value: 'nosniff' },
            ],
          },
        },
      },
      offset + 880,
    ),
  );
  connect(connections, 'Webhook', 'Read records');
  connect(connections, 'Read records', 'Route request');
  connect(connections, 'Result', 'Needs delete');
  connect(connections, 'Needs delete', 'Lost claim ids');
  connect(connections, 'Lost claim ids', 'Delete lost claim');
  connect(connections, 'Needs delete', 'Needs save', 1);
  connect(connections, 'Delete lost claim', 'After lost claim');
  connect(connections, 'After lost claim', 'Respond');
  connect(connections, 'Needs save', 'Write payload');
  connect(connections, 'Needs save', 'Respond', 1);
  connect(connections, 'Write payload', 'Save record');
  connect(connections, 'Save record', 'After save');
  connect(connections, 'After save', 'Respond');
  write(
    admin ? 'C-employee-api.json' : 'B-public-api-and-proposals.json',
    admin ? 'H20 C — Employee review API' : 'H20 B — Public catalogue and proposal generator',
    nodes,
    connections,
  );
}
function generate(selected) {
  env = selected;
  const prod = env.name === 'prod';
  apiWorkflow(false);
  apiWorkflow(true);
  if (!prod) {
    const sources = [
      {
        id: 'h20-event-zaal',
        label: 'H20 Event Zaal',
        kind: 'room',
        url: 'https://eventlocatie.h20.gg/h20-event-zaal/',
      },
      {
        id: 'rabo-esports-stadium',
        label: 'Rabo Esports Stadium',
        kind: 'room',
        url: 'https://eventlocatie.h20.gg/rabo-esports-stadium-eventlocatie/',
      },
      {
        id: 'h20-lounge-cafe',
        label: 'H20 Lounge Café',
        kind: 'room',
        url: 'https://eventlocatie.h20.gg/lounge-cafe/',
      },
      { id: 'aula', label: 'Aula', kind: 'room', url: 'https://eventlocatie.h20.gg/aula/' },
      {
        id: 'catering',
        label: 'Catering',
        kind: 'catering',
        url: 'https://eventlocatie.h20.gg/catering-eventlocatie/',
      },
      {
        id: 'activities',
        label: 'Activiteiten',
        kind: 'activity',
        url: 'https://h20.gg/activiteiten-bij-h20/',
      },
      {
        id: 'rooms-overview',
        label: 'Ruimtes',
        kind: 'information',
        url: 'https://eventlocatie.h20.gg/ruimtes-eventlocatie/',
      },
      {
        id: 'contact',
        label: 'Contact',
        kind: 'information',
        url: 'https://eventlocatie.h20.gg/contact/',
      },
    ];
    const scrapeNodes = [
      node(
        'Setup',
        'stickyNote',
        {
          content:
            'Set the Data Table ID. Execute manually first. Review staged sources in the employee portal and publish the catalogue items you have checked. Re-scraping only updates source rows, never staff-reviewed catalogue entries. Add official detail-page URLs in Sources as needed. H20 Event Zaal and Rabo Esports Stadium describe the same large venue: publish only one to avoid duplicate capacity.',
          height: 220,
          width: 600,
        },
        0,
        -280,
      ),
      node('Manual', 'manualTrigger', {}, 0),
      code('Sources', `return ${JSON.stringify(sources)}.map(json=>({json}));`, 220),
      node(
        'Fetch official page',
        'httpRequest',
        {
          url: '={{ $json.url }}',
          options: {
            timeout: 20000,
            response: { response: { responseFormat: 'text', outputPropertyName: 'data' } },
          },
        },
        440,
      ),
      node(
        'Extract HTML',
        'html',
        {
          operation: 'extractHtmlContent',
          sourceData: 'json',
          dataPropertyName: 'data',
          extractionValues: {
            values: [
              { key: 'heading', cssSelector: 'h1', returnValue: 'text' },
              { key: 'title', cssSelector: 'title', returnValue: 'text' },
              {
                key: 'content',
                // eventlocatie.h20.gg has no main/article; its body is the Elementor wp-page block.
                cssSelector:
                  'main, article, .elementor-location-single, [data-elementor-type="wp-page"]',
                returnValue: 'text',
                skipSelectors: 'script, style, nav, footer',
              },
              {
                key: 'image',
                cssSelector: 'meta[property="og:image"]',
                returnValue: 'attribute',
                attribute: 'content',
              },
            ],
          },
          options: { trimValues: true, cleanUpText: true },
        },
        660,
      ),
      code(
        'Normalize sources',
        `${scrape}\nreturn $input.all().map((item,index)=>({json:normalizeSource($('Sources').all()[index].json,item.json)}));`,
        880,
      ),
      upsert('Stage source', 1100),
    ];
    const scrapeConnections = {};
    for (let i = 1; i < scrapeNodes.length - 1; i++)
      connect(scrapeConnections, scrapeNodes[i].name, scrapeNodes[i + 1].name);
    write(
      'A-official-website-scraper.json',
      'H20 A — Official website scraper',
      scrapeNodes,
      scrapeConnections,
    );
  }
  const FRONTEND_ORIGIN = env.frontendOrigin;
  const notifications = fs
    .readFileSync(path.join(root, 'code/notifications.cjs'), 'utf8')
    .split('if (typeof module')[0];
  const mailNodes = [
    node(
      'Setup',
      'stickyNote',
      {
        content: prod
          ? 'OPTIONAL — these are the [PROD] files: keep inactive until sender, SMTP credential and the h20_records_prod Data Table are bound. FRONTEND_ORIGIN in Prepare mail is already https://h20-event-assistant-prod.web.app. Test with your own address first. Production schedule sends real customer emails. Delivery is at-least-once: a failure after sending but before recording the receipt can cause a duplicate. A receipt is written only after successful SMTP delivery.'
          : 'OPTIONAL — keep inactive until sender, SMTP credential, Data Table ID and FRONTEND_ORIGIN are configured. FRONTEND_ORIGIN in Prepare mail defaults to https://h20-event-assistant-dev.web.app for dev; set FRONTEND_ORIGIN to https://h20-event-assistant-prod.web.app in the [PROD] workflow import. Test with your own address first. Production schedule sends real customer emails. Delivery is at-least-once: a failure after sending but before recording the receipt can cause a duplicate. A receipt is written only after successful SMTP delivery.',
        height: 220,
        width: 650,
      },
      0,
      -250,
    ),
    node('Manual', 'manualTrigger', {}, 0),
    node(
      'Every five minutes',
      'scheduleTrigger',
      { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
      0,
      180,
    ),
    node(
      'Read records',
      'dataTable',
      { resource: 'row', operation: 'get', dataTableId: table, returnAll: true },
      220,
      0,
      { alwaysOutputData: true },
    ),
    code(
      'Prepare mail',
      `const FRONTEND_ORIGIN = '${FRONTEND_ORIGIN}';\n${notifications}\nreturn notificationJobs($input.all().map(item=>item.json), FRONTEND_ORIGIN).map(json=>({json}));`,
      440,
    ),
    node(
      'Send email',
      'emailSend',
      {
        fromEmail: 'REPLACE_WITH_VERIFIED_SENDER',
        toEmail: '={{ $json.to }}',
        subject: '={{ $json.subject }}',
        emailFormat: 'text',
        text: '={{ $json.text }}',
        options: { appendAttribution: false },
      },
      660,
    ),
    code(
      'Delivery receipts',
      `return $input.all().map((item,index)=>({json:$('Prepare mail').all()[index].json}));`,
      880,
    ),
    upsert('Record delivery', 1100),
  ];
  const mailConnections = {};
  connect(mailConnections, 'Manual', 'Read records');
  connect(mailConnections, 'Every five minutes', 'Read records');
  for (let i = 3; i < mailNodes.length - 1; i++)
    connect(mailConnections, mailNodes[i].name, mailNodes[i + 1].name);
  write(
    'D-email-notifications.json',
    'H20 D — Request and approval notifications',
    mailNodes,
    mailConnections,
  );

  // Replace the prototype shared staff token with Firebase-verified identity before any database access.
  const firebaseSettings = env.firebase;
  for (const file of ['B-public-api-and-proposals.json', 'C-employee-api.json']) {
    const pathname = path.join(root, env.outDir, file);
    const workflow = JSON.parse(fs.readFileSync(pathname, 'utf8'));
    const admin = file.startsWith('C-');
    const webhook = workflow.nodes.find((n) => n.name === 'Webhook');
    webhook.parameters.authentication = 'none';
    const authSource = fs
      .readFileSync(path.join(root, 'code/auth-context.cjs'), 'utf8')
      .split(/if\s*\(typeof module/)[0];
    workflow.nodes.push(
      code(
        'Access',
        `${authSource}\nconst request=$input.first().json;return [{json:{route:${admin ? 'true' : "!['catalogue','appointment-slots'].includes(request.body?.action)"}?'verify':'public',clientKey:clientKeyFromHeaders(request.headers),body:request.body??{}}}];`,
        -900,
        400,
      ),
    );
    workflow.nodes.push(check('Verify required', 'verify', -680, 400));
    workflow.nodes.push(
      node(
        'Verify Firebase token',
        'httpRequest',
        {
          method: 'POST',
          url: `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseSettings.apiKey}`,
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            '={{ {idToken: ($("Webhook").first().json.headers.authorization || "").replace(/^Bearer /, "")} }}',
          options: { timeout: 10000 },
        },
        -440,
        300,
        { onError: 'continueRegularOutput' },
      ),
    );
    workflow.nodes.push(
      code(
        'Verified access',
        `${authSource}\ntry{const access=$('Access').first().json;const identity=verifiedIdentity($input.first().json,${admin});return [{json:{route:'allowed',body:{...access.body,_identity:identity,_clientKey:access.clientKey}}}];}catch{return [{json:{route:'denied',status:401,response:{error:'Inloggen vereist of onvoldoende rechten.'}}}];}`,
        -220,
        300,
      ),
    );
    workflow.nodes.push(
      code(
        'Public access',
        `const access=$('Access').first().json;return [{json:{route:'allowed',body:{...access.body,_identity:null,_clientKey:access.clientKey}}}];`,
        -440,
        550,
      ),
    );
    workflow.nodes.push(code('Access context', 'return $input.all();', 0, 400));
    workflow.nodes.push(check('Allowed', 'allowed', 220, 400));
    workflow.connections.Webhook = { main: [] };
    connect(workflow.connections, 'Webhook', 'Access');
    connect(workflow.connections, 'Access', 'Verify required');
    connect(workflow.connections, 'Verify required', 'Verify Firebase token');
    connect(workflow.connections, 'Verify required', 'Public access', 1);
    connect(workflow.connections, 'Verify Firebase token', 'Verified access');
    connect(workflow.connections, 'Verified access', 'Access context');
    connect(workflow.connections, 'Public access', 'Access context');
    connect(workflow.connections, 'Access context', 'Allowed');
    connect(workflow.connections, 'Allowed', 'Read records');
    connect(workflow.connections, 'Allowed', 'Respond', 1);
    const router = workflow.nodes.find((n) => n.name === 'Route request');
    router.parameters.jsCode = router.parameters.jsCode.replace(
      "$('Webhook').first().json.body??{}",
      "$('Access context').first().json.body??{}",
    );
    workflow.nodes.find((n) => n.name === 'Setup').parameters.content = prod
      ? `These are the [PROD] files (webhook ${env.webhookPath}/${admin ? 'admin' : 'public'}, prod Firebase project). Verify Firebase token uses the prod web API key and CORS allows only the prod Hosting origins. Bind every Data Table node to h20_records_prod${admin ? '' : ' (including Insert hit, Re-read records after hit and Prune expired hits)'}${admin ? '' : ', attach your Gemini Header Auth credential (x-goog-api-key) to both Gemini and Gemini fallback'}, then publish.`
      : admin
        ? 'Firebase ID tokens are verified through accounts:lookup for this Firebase project before protected data access. Staff must have the server-managed custom claim staff:true. Select your Data Table credential, then publish. No shared staff password is used.'
        : 'Firebase ID tokens are verified through accounts:lookup for all actions except public catalogue reads. AI actions (chat, event-request) enforce per-account and per-IP (both SHA-256 hashed) and global hourly rate limits before calling Gemini: each request first inserts a rate-hit row, re-reads the Data Table and is allowed only if fewer than the limit of earlier hits (lowest row id first) exist. Select your Data Table in Read records, Insert claim, Re-read records after claim, Insert hit, Re-read records after hit, Delete lost claim, Prune expired hits and Save record, attach your Gemini credential to both Gemini and Gemini fallback, configure Google Cloud Gemini quota/budget caps, then publish.';
    fs.writeFileSync(pathname, JSON.stringify(workflow, null, 2) + '\n');
  }
}
generate(ENVS.dev);
generate(ENVS.prod);
