const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const domain = require('../code/domain.cjs');
const { normalizeSource } = require('../code/scrape.cjs');
const { notificationJobs } = require('../code/notifications.cjs');
const room = {
  id: 'stadium',
  name: 'Stadium',
  description: 'Test room',
  isActive: true,
  minCapacity: 10,
  maxCapacity: 120,
  capacityVerified: true,
  baseHourlyRate: 100,
  facilities: [],
  suitableFor: [],
};
const rows = () =>
  domain.parseRows([
    domain.row('room', room.id, room),
    domain.row('activity', 'gaming', { id: 'gaming', name: 'Gaming', isActive: true, price: null }),
    domain.row('catering', 'lunch', {
      id: 'lunch',
      name: 'Lunch',
      isActive: true,
      pricePerPerson: null,
    }),
  ]);
function request() {
  return {
    action: 'event-request',
    _identity: { uid: 'test-user', email: 'customer@example.test' },
    requestId: randomUUID(),
    customerToken: randomUUID() + randomUUID(),
    customer: { fullName: 'Test Customer', email: 'customer@example.test' },
    config: {
      name: 'Team day',
      type: 'Teambuilding',
      participants: 30,
      date: '2099-12-15',
      startTime: '10:00',
      endTime: '16:00',
      selectedRoomId: room.id,
      selectedActivities: ['Gaming'],
      cateringSelections: ['Lunch'],
      selectedAddons: [],
      additionalRooms: [],
      budgetRange: '500',
      budgetVatInclusive: true,
    },
  };
}
function generated(context) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                explanation: 'Een concept voor beoordeling.',
                planning: [
                  {
                    startTime: '10:00',
                    endTime: '16:00',
                    activity: 'Teamdag',
                    room: context.booking.event.room.name,
                    materials: 'Op aanvraag',
                    responsible: 'Nog toe te wijzen',
                  },
                ],
              }),
            },
          ],
        },
      },
    ],
  };
}
function savedRequest() {
  const body = request();
  const context = domain.publicAction(body, rows());
  const result = domain.finishGemini(context, generated(context));
  return { body, context, result, rows: [...rows(), ...domain.parseRows([result.write])] };
}
test('catalogue never returns customers or capability tokens', () => {
  const s = savedRequest();
  const result = domain.publicAction({ action: 'catalogue' }, s.rows);
  assert.equal(result.response.rooms.length, 1);
  assert.ok(!JSON.stringify(result).includes(s.body.customerToken));
  assert.ok(!JSON.stringify(result).includes('customer@example.test'));
});
test('request validates and calculates prices on server, ignoring client totals', () => {
  const body = request();
  body.config.selectedAddons = [{ id: 'forged', price: -10000 }];
  assert.throws(() => domain.publicAction(body, rows()), /upgrade/);
  body.config.selectedAddons = [];
  const context = domain.publicAction(body, rows());
  assert.equal(context.booking.financial.totalPrice, 726);
  assert.match(context.booking.reviewNotes, /op aanvraag/);
  assert.match(context.booking.reviewNotes, /overschrijden/);
  assert.equal(context.booking.requestStatus, 'pending_review');
  assert.ok(!JSON.stringify(context.geminiBody).includes(body.customer.email));
});
test('invalid dates, times, capacity and unknown items are rejected', () => {
  for (const change of [
    { date: '2099-02-31' },
    { startTime: '25:00' },
    { endTime: '09:00' },
    { participants: 500 },
    { selectedRoomId: 'missing' },
    { selectedActivities: ['Made up'] },
  ]) {
    const body = request();
    Object.assign(body.config, change);
    assert.throws(() => domain.publicAction(body, rows()));
  }
});
test('invalid AI output and invented rooms keep the hold but save no AI text', () => {
  const context = domain.publicAction(request(), rows());
  const empty = domain.finishGemini(context, { candidates: [] });
  assert.equal(JSON.parse(empty.write.payload).data.aiStatus, 'failed');
  const bad = generated(context);
  bad.candidates[0].content.parts[0].text = bad.candidates[0].content.parts[0].text.replace(
    'Stadium',
    'Invented venue',
  );
  const invented = domain.finishGemini(context, bad);
  assert.equal(JSON.parse(invented.write.payload).data.aiStatus, 'failed');
  assert.equal(JSON.parse(invented.write.payload).data.planning, undefined);
  assert.throws(() => domain.finishGemini({ chat: true, config: null }, { candidates: [] }), /AI/);
});
test('customer lookup requires its private token and hides staff data until approval', () => {
  const s = savedRequest();
  assert.throws(
    () =>
      domain.publicAction(
        { action: 'lookup', _identity: { uid: 'test-user' }, id: s.body.requestId, token: 'wrong' },
        s.rows,
      ),
    /niet gevonden/,
  );
  let result = domain.publicAction(
    {
      action: 'lookup',
      _identity: { uid: 'test-user' },
      id: s.body.requestId,
      token: s.body.customerToken,
    },
    s.rows,
  ).response.booking;
  assert.equal(result.explanation, undefined);
  assert.equal(result.planning, undefined);
  assert.deepEqual(result.reservation.internalNotes, []);
  const approved = domain.adminAction(
    { action: 'booking-status', id: s.body.requestId, actionType: 'approve' },
    s.rows,
  );
  const after = [...rows(), ...domain.parseRows([approved.write])];
  result = domain.publicAction(
    {
      action: 'lookup',
      _identity: { uid: 'test-user' },
      id: s.body.requestId,
      token: s.body.customerToken,
    },
    after,
  ).response.booking;
  assert.equal(result.requestStatus, 'approved');
  assert.ok(result.explanation);
  assert.equal(result.planning, undefined);
});
test('retrying the same request returns the existing request without another AI call', () => {
  const s = savedRequest();
  const repeat = domain.publicAction(s.body, s.rows);
  assert.equal(repeat.route, 'respond');
  assert.equal(repeat.response.booking.id, s.body.requestId);
  assert.throws(
    () => domain.publicAction({ ...s.body, customerToken: randomUUID() + randomUUID() }, s.rows),
    /Ongeldige/,
  );
});
test('overlap is checked for additional rooms and blocks, but adjacent times are allowed', () => {
  const s = savedRequest();
  const body = request();
  assert.throws(() => domain.publicAction(body, s.rows), /overlapt/);
  body.config.startTime = '16:00';
  body.config.endTime = '18:00';
  assert.equal(domain.publicAction(body, s.rows).route, 'claim');
  assert.throws(
    () =>
      domain.adminAction(
        {
          action: 'add-block',
          block: {
            roomId: room.id,
            date: '2099-12-15',
            startTime: '12:00',
            endTime: '13:00',
            reason: 'Maintenance',
          },
        },
        s.rows,
      ),
    /overlapt/,
  );
});
test('editing an approved proposal sends it back for review', () => {
  const s = savedRequest();
  const result = domain.adminAction(
    { action: 'review', id: s.body.requestId, explanation: 'Changed proposal' },
    s.rows,
  );
  assert.equal(result.response.booking.requestStatus, 'pending_review');
  assert.equal(result.response.booking.reservation.adminApprovalStatus, 'Pending');
});
test('cancelling records the request as cancelled, rejecting as rejected', () => {
  for (const [actionType, expected] of [
    ['cancel', 'cancelled'],
    ['reject', 'rejected'],
  ]) {
    const s = savedRequest();
    const out = domain.adminAction(
      { action: 'booking-status', id: s.body.requestId, actionType },
      s.rows,
    );
    assert.equal(out.response.booking.requestStatus, expected);
    assert.equal(out.response.booking.reservation.bookingStatus, 'Cancelled');
    assert.equal(
      out.response.booking.reservation.adminApprovalStatus,
      actionType === 'reject' ? 'Rejected' : 'Pending',
    );
  }
});
test('a staff review cannot reopen a cancelled or refunded request', () => {
  for (const status of ['Cancelled', 'Refunded']) {
    const s = savedRequest();
    const closed = s.rows.map((item) =>
      item.kind === 'booking'
        ? {
            ...item,
            data: {
              ...item.data,
              requestStatus: 'rejected',
              reservation: { ...item.data.reservation, bookingStatus: status },
            },
          }
        : item,
    );
    assert.throws(
      () =>
        domain.adminAction(
          { action: 'review', id: s.body.requestId, explanation: 'Heropend' },
          closed,
        ),
      (err) => err.status === 409 && /afgesloten/.test(err.message),
    );
  }
});
test('a block on a non-existent calendar date is rejected', () => {
  for (const date of ['2099-02-31', '2099-13-01', '2099-04-31']) {
    assert.throws(
      () =>
        domain.adminAction(
          {
            action: 'add-block',
            block: { roomId: room.id, date, startTime: '10:00', endTime: '11:00', reason: 'X' },
          },
          rows(),
        ),
      /Ongeldige blokkade/,
    );
  }
});
test('website extraction stages data without publishing invented prices or capacity', () => {
  const result = normalizeSource(
    { id: 'test', kind: 'room', url: 'https://eventlocatie.h20.gg/test/', label: 'Test' },
    {
      heading: 'Official room',
      content:
        'Een officiële zaal met voldoende tekst om te verwerken, geschikt voor 10 tot 60 personen.',
      image: 'https://eventlocatie.h20.gg/room.jpg',
    },
  );
  const data = JSON.parse(result.payload).data;
  assert.equal(result.kind, 'source');
  assert.equal(data.suggestedItem.isActive, false);
  assert.equal(data.suggestedItem.capacityVerified, false);
  assert.equal(data.suggestedItem.maxCapacity, 60);
  assert.equal(data.suggestedItem.baseHourlyRate, undefined);
  assert.throws(() => normalizeSource({ url: 'test' }, {}), /inhoud/);
});
test('notification jobs are scoped to customer and skipped after delivery receipt', () => {
  const s = savedRequest();
  const jobs = notificationJobs([s.result.write], 'https://example.test');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].to, 'customer@example.test');
  assert.ok(jobs[0].text.includes(s.body.customerToken));
  assert.equal(notificationJobs([s.result.write, jobs[0]], 'https://example.test').length, 0);
  const mailWf = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../workflows/D-email-notifications.json'), 'utf8'),
  );
  const prepareNode = mailWf.nodes.find((n) => n.name === 'Prepare mail');
  assert.match(prepareNode.parameters.jsCode, /const FRONTEND_ORIGIN = 'https:\/\//);
});
const workflowsDir = path.join(__dirname, '../workflows');
const prodDir = path.join(workflowsDir, 'prod');
const readWorkflows = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => ({
      file: entry.name,
      wf: JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8')),
    }));
const readJsonFile = (...parts) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '../../..', ...parts), 'utf8'));
test('workflow exports have valid connections, authentication and compilable Code nodes', () => {
  const exports = [...readWorkflows(workflowsDir), ...readWorkflows(prodDir)];
  assert.equal(exports.length, 7);
  for (const { file, wf } of exports) {
    const names = new Set(wf.nodes.map((n) => n.name));
    assert.equal(wf.active, false);
    for (const [name, outputs] of Object.entries(wf.connections)) {
      assert.ok(names.has(name));
      for (const edge of outputs.main.flat()) assert.ok(names.has(edge.node), edge.node);
    }
    for (const node of wf.nodes.filter((n) => n.type.endsWith('.code')))
      new vm.Script(`(function(){${node.parameters.jsCode}\n})`);
    if (file.startsWith('C-')) assert.ok(wf.nodes.some((n) => n.name === 'Verify Firebase token'));
  }
});
test('prod workflows B, C and D use only prod values', () => {
  const prodApiKey = readJsonFile('config/runtime/prod.json').firebase.apiKey;
  const devApiKey = readJsonFile('public/h20-runtime.json').firebase.apiKey;
  assert.ok(prodApiKey && devApiKey && prodApiKey !== devApiKey);
  const prod = readWorkflows(prodDir);
  assert.deepEqual(
    prod.map((p) => p.file),
    ['B-public-api-and-proposals.json', 'C-employee-api.json', 'D-email-notifications.json'],
  );
  for (const { file, wf } of prod) {
    assert.ok(wf.name.startsWith('[PROD] '), wf.name);
    assert.ok(!JSON.stringify(wf).includes(devApiKey), `${file} contains the dev apiKey`);
    assert.ok(!JSON.stringify(wf).includes('http://localhost'), file);
    assert.ok(!JSON.stringify(wf).includes('h20-event-assistant-dev'), file);
    const setup = wf.nodes.find((n) => n.name === 'Setup').parameters.content;
    assert.match(setup, /\[PROD\]/);
    assert.match(setup, /h20_records_prod/);
    if (file.startsWith('D-')) {
      const prepare = wf.nodes.find((n) => n.name === 'Prepare mail').parameters.jsCode;
      assert.match(
        prepare,
        /const FRONTEND_ORIGIN = 'https:\/\/h20-event-assistant-prod\.web\.app';/,
      );
      continue;
    }
    const admin = file.startsWith('C-');
    const webhook = wf.nodes.find((n) => n.name === 'Webhook');
    assert.equal(webhook.parameters.path, `h20-prod/${admin ? 'admin' : 'public'}`);
    assert.equal(webhook.webhookId, `h20-prod-${admin ? 'admin' : 'public'}`);
    assert.equal(
      webhook.parameters.options.allowedOrigins,
      'https://h20-event-assistant-prod.web.app,https://h20-event-assistant-prod.firebaseapp.com',
    );
    const lookup = wf.nodes.find((n) => n.name === 'Verify Firebase token').parameters.url;
    assert.equal(
      lookup,
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${prodApiKey}`,
    );
  }
});
test('dev workflows still use the dev webhook paths and dev apiKey', () => {
  const devApiKey = readJsonFile('public/h20-runtime.json').firebase.apiKey;
  const b = readWorkflows(workflowsDir).find((w) => w.file.startsWith('B-')).wf;
  assert.equal(b.nodes.find((n) => n.name === 'Webhook').parameters.path, 'h20/public');
  assert.ok(
    b.nodes.find((n) => n.name === 'Verify Firebase token').parameters.url.endsWith(devApiKey),
  );
  assert.ok(!b.name.startsWith('[PROD]'));
});
test('generator refuses to write prod workflows when the prod apiKey is empty', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'h20-prod-config-'));
  const config = readJsonFile('config/runtime/prod.json');
  config.firebase.apiKey = '';
  const file = path.join(dir, 'prod.json');
  fs.writeFileSync(file, JSON.stringify(config));
  const before = fs.readFileSync(path.join(prodDir, 'C-employee-api.json'), 'utf8');
  const result = require('node:child_process').spawnSync(
    process.execPath,
    [path.join(__dirname, '../generate-workflows.cjs')],
    { env: { ...process.env, H20_PROD_RUNTIME_CONFIG: file }, encoding: 'utf8' },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /firebase\.apiKey is empty/);
  assert.equal(fs.readFileSync(path.join(prodDir, 'C-employee-api.json'), 'utf8'), before);
});

test('live chat suggests only a published room that fits the group', () => {
  const identity = { uid: 'test-user', email: 'customer@example.test' };
  const context = domain.publicAction(
    {
      action: 'chat',
      _identity: identity,
      message: 'Een teamdag voor 30 personen met budget 1000',
    },
    rows(),
  );
  assert.equal(context.config.participants, 30);
  assert.equal(context.config.selectedRoomId, room.id);
  assert.equal(context.config.date, '');
  assert.equal(context.config.budgetRange, '1000');
  const result = domain.finishGemini(context, {
    candidates: [
      { content: { parts: [{ text: JSON.stringify({ reply: 'Bekijk de voorgestelde zaal.' }) }] } },
    ],
  });
  assert.equal(result.response.config.selectedRoomId, room.id);
  const tooLarge = domain.publicAction(
    { action: 'chat', _identity: identity, message: 'Voor 500 personen' },
    rows(),
  );
  assert.equal(tooLarge.config, null);
});

test('Firebase identity rejects missing tokens and non-staff accounts', () => {
  const { verifiedIdentity } = require('../code/auth-context.cjs');
  assert.throws(() => verifiedIdentity({ error: { message: 'INVALID_ID_TOKEN' } }));
  assert.throws(() => verifiedIdentity({ users: [{ localId: 'customer' }] }, true));
  assert.equal(
    verifiedIdentity({ users: [{ localId: 'staff', customAttributes: '{"staff":true}' }] }, true)
      .staff,
    true,
  );
  assert.throws(() => verifiedIdentity({ users: [{ localId: 'disabled', disabled: true }] }));
});
test('customer account only lists its own requests', () => {
  const a = request();
  a._identity = { uid: 'owner-a' };
  const context = domain.publicAction(a, rows());
  const saved = domain.finishGemini(context, generated(context));
  const all = [...rows(), ...domain.parseRows([saved.write])];
  assert.equal(
    domain.publicAction({ action: 'my-requests', _identity: { uid: 'owner-a' } }, all).response
      .bookings.length,
    1,
  );
  assert.equal(
    domain.publicAction({ action: 'my-requests', _identity: { uid: 'owner-b' } }, all).response
      .bookings.length,
    0,
  );
});

// --- Slot claims (#14) -------------------------------------------------------------------
const baseRaw = () => [
  domain.row('room', room.id, room),
  domain.row('room', 'aula', { ...room, id: 'aula', name: 'Aula' }),
  domain.row('activity', 'gaming', { id: 'gaming', name: 'Gaming', isActive: true, price: null }),
  domain.row('catering', 'lunch', {
    id: 'lunch',
    name: 'Lunch',
    isActive: true,
    pricePerPerson: null,
  }),
];
/** Simulates the Data Table insert: the new row gets an auto-generated integer id. */
const inserted = (write, id) => ({ ...write, id, createdAt: '2099-01-01T10:00:00.000Z' });
const snapshot = (...extra) => domain.parseRows([...baseRaw(), ...extra]);
const claimRequest = (change = {}) => {
  const body = request();
  Object.assign(body.config, change);
  return { body, context: domain.publicAction(body, snapshot()) };
};
const claimBlock = (change = {}) =>
  domain.adminAction(
    {
      action: 'add-block',
      block: {
        roomId: room.id,
        date: '2099-12-15',
        startTime: '10:00',
        endTime: '16:00',
        reason: 'Onderhoud',
        ...change,
      },
    },
    snapshot(),
  );
/** Settles a claim; a booking context's own hit is looked up in `rows` (or added when absent). */
const outcome = (context, rowList, id, hitId) => {
  let list = rowList;
  let ownHit = hitId ?? list.find((r) => r.recordId === context.hitRow?.recordId)?.rowId;
  if (context.hitRow && ownHit === undefined) {
    ownHit = 9000;
    list = [...list, ...domain.parseRows([inserted(context.hitRow, ownHit)])];
  }
  return domain.settleClaim(
    context,
    list,
    id ?? list.find((r) => r.recordId === context.claimRow.recordId)?.rowId,
    ownHit,
  );
};

test('a new request claims the slot first, as claiming, before any AI call', () => {
  const { context } = claimRequest();
  assert.equal(context.route, 'claim');
  assert.equal(context.claimKind, 'booking');
  const data = JSON.parse(context.claimRow.payload).data;
  assert.equal(data.claimStatus, 'claiming');
  assert.equal(context.claimRow.recordId, `booking:${data.id}`);
});

test('parseRows keeps the Data Table system columns next to the payload', () => {
  const [parsed] = domain.parseRows([
    { ...domain.row('room', 'x', room), id: 7, createdAt: '2099-01-01T00:00:00.000Z' },
  ]);
  assert.equal(parsed.rowId, 7);
  assert.equal(parsed.rowCreatedAt, '2099-01-01T00:00:00.000Z');
});

test('two overlapping requests: exactly one wins (lowest row id), whatever the evaluation order', () => {
  const a = claimRequest();
  const b = claimRequest({ startTime: '12:00', endTime: '18:00' });
  const rowsBoth = snapshot(inserted(a.context.claimRow, 11), inserted(b.context.claimRow, 12));
  for (const order of [
    [a, b],
    [b, a],
  ]) {
    const results = order.map((r) => outcome(r.context, rowsBoth));
    const won = results.filter((r) => r.route === 'gemini');
    assert.equal(won.length, 1);
    assert.equal(won[0].booking.id, a.body.requestId);
    const lost = results.find((r) => r.route === 'lost');
    assert.equal(lost.status, 409);
    assert.match(lost.response.error, /overlapt/);
    assert.deepEqual(lost.deleteRowIds, [12, 9000]);
  }
});

test('non-overlapping requests both win: other room, or adjacent times', () => {
  const a = claimRequest();
  for (const change of [{ selectedRoomId: 'aula' }, { startTime: '16:00', endTime: '18:00' }]) {
    const b = claimRequest(change);
    const rowsBoth = snapshot(inserted(a.context.claimRow, 5), inserted(b.context.claimRow, 6));
    assert.equal(outcome(a.context, rowsBoth).route, 'gemini');
    assert.equal(outcome(b.context, rowsBoth).route, 'gemini');
  }
});

test('multi-room: overlapping on an additional room loses to the earlier claim', () => {
  const first = claimRequest({ selectedRoomId: 'aula' });
  const second = claimRequest({ additionalRooms: [{ id: 'aula' }] });
  const rowsBoth = snapshot(
    inserted(first.context.claimRow, 1),
    inserted(second.context.claimRow, 2),
  );
  assert.equal(outcome(first.context, rowsBoth).route, 'gemini');
  assert.equal(outcome(second.context, rowsBoth).route, 'lost');
  // and the other way round: the multi-room claim is earlier
  const flipped = snapshot(
    inserted(second.context.claimRow, 1),
    inserted(first.context.claimRow, 2),
  );
  assert.equal(outcome(second.context, flipped).route, 'gemini');
  assert.equal(outcome(first.context, flipped).route, 'lost');
});

test('a block racing a request: the lower id wins in both directions', () => {
  const req = claimRequest();
  const block = claimBlock({ startTime: '09:00', endTime: '11:00' });
  assert.equal(block.route, 'claim');
  assert.equal(block.claimKind, 'block');
  for (const [reqId, blockId, reqWins] of [
    [1, 2, true],
    [2, 1, false],
  ]) {
    const rowsBoth = snapshot(
      inserted(req.context.claimRow, reqId),
      inserted(block.claimRow, blockId),
    );
    const r = outcome(req.context, rowsBoth);
    const b = outcome(block, rowsBoth);
    assert.equal(r.route, reqWins ? 'gemini' : 'lost');
    assert.equal(b.route, reqWins ? 'lost' : 'save');
    if (!reqWins) assert.equal(JSON.parse(b.write.payload).data.claimStatus, 'held');
    if (reqWins) assert.equal(b.status, 409);
  }
});

test('inactive bookings never cause a loss', () => {
  const mine = claimRequest();
  const old = savedRequest();
  const oldBooking = old.result.write;
  const variants = [
    (b) => ({ ...b, requestStatus: 'rejected' }),
    (b) => ({ ...b, reservation: { ...b.reservation, bookingStatus: 'Cancelled' } }),
    (b) => ({ ...b, reservation: { ...b.reservation, bookingStatus: 'Refunded' } }),
    (b) => ({ ...b, reservation: { ...b.reservation, bookingStatus: 'Draft' } }),
  ];
  for (const change of variants) {
    const payload = JSON.parse(oldBooking.payload);
    payload.data = change(payload.data);
    const rival = inserted({ ...oldBooking, payload: JSON.stringify(payload) }, 1);
    const rowsBoth = snapshot(rival, inserted(mine.context.claimRow, 2));
    assert.equal(outcome(mine.context, rowsBoth).route, 'gemini');
  }
});

test('legacy rows without claimStatus/aiStatus behave as held/ok', () => {
  const old = savedRequest();
  const payload = JSON.parse(old.result.write.payload);
  delete payload.data.claimStatus;
  delete payload.data.aiStatus;
  const legacy = inserted({ ...old.result.write, payload: JSON.stringify(payload) }, 1);
  const mine = claimRequest();
  const rowsBoth = snapshot(legacy, inserted(mine.context.claimRow, 2));
  assert.equal(outcome(mine.context, rowsBoth).route, 'lost');
  const staff = domain.adminAction({ action: 'snapshot' }, snapshot(legacy));
  assert.equal(staff.response.bookings[0].claimStatus ?? 'held', 'held');
  assert.equal(staff.response.bookings[0].aiStatus ?? 'ok', 'ok');
  const receipt = domain.publicAction(old.body, snapshot(legacy));
  assert.equal(receipt.route, 'respond');
});

test('a Gemini failure after a win saves a held booking with aiStatus failed and a normal receipt', () => {
  const { context } = claimRequest();
  for (const result of [{ error: { message: 'boom' } }, { candidates: [] }]) {
    const done = domain.finishGemini(context, result);
    assert.equal(done.route, 'save');
    assert.equal(done.status, 201);
    const saved = JSON.parse(done.write.payload).data;
    assert.equal(saved.claimStatus, 'held');
    assert.equal(saved.aiStatus, 'failed');
    assert.equal(saved.explanation, undefined);
    assert.equal(done.write.recordId, context.claimRow.recordId);
    assert.equal(done.response.booking.id, saved.id);
    assert.equal(done.response.booking.reference, saved.reference);
  }
  const ok = JSON.parse(domain.finishGemini(context, generated(context)).write.payload).data;
  assert.equal(ok.aiStatus, 'ok');
  assert.equal(ok.claimStatus, 'held');
});

test('the public booking never exposes claimStatus or aiStatus', () => {
  const { context } = claimRequest();
  const done = domain.finishGemini(context, generated(context));
  const text = JSON.stringify(done.response);
  assert.ok(!text.includes('claimStatus'));
  assert.ok(!text.includes('aiStatus'));
  const failed = domain.finishGemini(context, { candidates: [] });
  assert.ok(!JSON.stringify(failed.response).includes('aiStatus'));
});

test('retry with a claiming row re-verifies: it wins and proceeds, or loses, deletes and 409s', () => {
  const mine = claimRequest();
  const rival = claimRequest({ startTime: '12:00', endTime: '14:00' });
  const claiming = inserted(mine.context.claimRow, 20);
  // wins: no earlier overlapping claim
  const won = domain.publicAction(
    mine.body,
    snapshot(claiming, inserted(rival.context.claimRow, 21)),
  );
  assert.equal(won.route, 'hit');
  assert.equal(won.booking.id, mine.body.requestId);
  assert.ok(won.geminiBody);
  // loses: rival has the lower id
  const lost = domain.publicAction(
    mine.body,
    snapshot(inserted(rival.context.claimRow, 19), claiming),
  );
  assert.equal(lost.route, 'lost');
  assert.equal(lost.status, 409);
  assert.deepEqual(lost.deleteRowIds, [20]);
});

test('retry that finds a held row returns the receipt as before', () => {
  const s = savedRequest();
  const held = inserted(s.result.write, 3);
  const repeat = domain.publicAction(s.body, snapshot(held));
  assert.equal(repeat.route, 'respond');
  assert.equal(repeat.response.booking.id, s.body.requestId);
});

test('staff snapshot flags claiming rows with the Data Table creation time', () => {
  const { context } = claimRequest();
  const snap = domain.adminAction({ action: 'snapshot' }, snapshot(inserted(context.claimRow, 4)));
  assert.equal(snap.response.bookings[0].claimStatus, 'claiming');
  assert.equal(snap.response.bookings[0].claimCreatedAt, '2099-01-01T10:00:00.000Z');
});

test('a staff review supplies the missing AI text and clears the failed indicator', () => {
  const { context, body } = claimRequest();
  const failed = domain.finishGemini(context, { candidates: [] });
  const rowsNow = snapshot(inserted(failed.write, 9));
  assert.throws(
    () =>
      domain.adminAction(
        { action: 'booking-status', id: body.requestId, actionType: 'approve' },
        rowsNow,
      ),
    /uitleg/,
  );
  const reviewed = domain.adminAction(
    { action: 'review', id: body.requestId, explanation: 'Handmatige uitleg' },
    rowsNow,
  );
  assert.equal(reviewed.response.booking.aiStatus, 'ok');
});

test('claiming rows do not trigger customer notifications', () => {
  const { context } = claimRequest();
  assert.equal(notificationJobs([context.claimRow], 'https://example.test').length, 0);
});

test('resolveClaim is pure and deterministic', () => {
  const a = claimRequest();
  const b = claimRequest();
  const rowsBoth = snapshot(inserted(a.context.claimRow, 3), inserted(b.context.claimRow, 4));
  const claim = (id) => ({
    rowId: id,
    roomIds: [room.id],
    date: '2099-12-15',
    startTime: '10:00',
    endTime: '16:00',
  });
  assert.deepEqual(domain.resolveClaim(rowsBoth, claim(3)), { won: true, winnerId: 3 });
  assert.deepEqual(domain.resolveClaim(rowsBoth, claim(4)), { won: false, winnerId: 3 });
});

test('a claim without a system id fails closed and never wins', () => {
  const a = claimRequest();
  const b = claimRequest();
  // both rows come back without ids (e.g. an insert/get that dropped them)
  const idless = (c) => ({ ...c.context.claimRow });
  const rowsBoth = snapshot(idless(a), idless(b));
  for (const c of [a, b]) {
    const result = domain.settleClaim(c.context, rowsBoth, undefined);
    assert.notEqual(result.route, 'gemini');
    assert.equal(result.status, 503);
  }
  // a rival without an id blocks us instead of ranking behind us
  const mine = claimRequest();
  const rival = idless(a);
  const mixed = snapshot(rival, inserted(mine.context.claimRow, 5));
  assert.equal(domain.settleClaim(mine.context, mixed, 5).route, 'lost');
  // resolveClaim itself refuses an id-less own claim
  assert.equal(
    domain.resolveClaim(rowsBoth, {
      rowId: undefined,
      roomIds: [room.id],
      date: '2099-12-15',
      startTime: '10:00',
      endTime: '16:00',
    }).won,
    false,
  );
});

test('a same-requestId double submit: one winner, the loser deletes only its own row id', () => {
  const { body, context } = claimRequest();
  const first = inserted(context.claimRow, 31);
  const second = inserted(context.claimRow, 32);
  const rowsBoth = snapshot(first, second);
  const winner = outcome(context, rowsBoth, 31);
  const loser = outcome(context, rowsBoth, 32);
  assert.equal(winner.route, 'gemini');
  assert.equal(loser.route, 'lost');
  assert.deepEqual(loser.deleteRowIds, [32, 9000]);
  // while both rows exist, a retry sees the lowest id and staff see one booking
  const retry = domain.publicAction(body, rowsBoth);
  assert.equal(retry.route, 'hit');
  assert.equal(domain.adminAction({ action: 'snapshot' }, rowsBoth).response.bookings.length, 1);
  // after the loser deleted itself and the winner saved, the retry returns the receipt
  const saved = domain.finishGemini(winner, generated(winner));
  const receipt = domain.publicAction(body, snapshot(inserted(saved.write, 31)));
  assert.equal(receipt.route, 'respond');
  assert.equal(receipt.response.booking.id, body.requestId);
});

test('malformed Gemini output keeps the hold with aiStatus failed', () => {
  const { context } = claimRequest();
  for (const generatedValue of [
    { explanation: 'x', planning: [null] },
    null,
    { explanation: 'x', planning: 'nope' },
  ]) {
    const done = domain.finishGemini(context, {
      candidates: [{ content: { parts: [{ text: JSON.stringify(generatedValue) }] } }],
    });
    assert.equal(done.route, 'save');
    assert.equal(JSON.parse(done.write.payload).data.aiStatus, 'failed');
  }
});

test('staff cannot approve a booking that is still claiming', () => {
  const { context, body } = claimRequest();
  assert.throws(
    () =>
      domain.adminAction(
        { action: 'booking-status', id: body.requestId, actionType: 'approve' },
        snapshot(inserted(context.claimRow, 8)),
      ),
    /verwerkt/,
  );
});

// --- Webhook abuse protection & rate limits (#10, insert-first rate hits #46) --------------
const T0 = 1_700_000_000_000;
const keyOf = (name) => domain.hashClientKey(`uid:${name}`);
const hitAt = (action, keys, at, id, rowId) => {
  const written = domain.buildRateHit(action, keys, at, id);
  return rowId === undefined ? written : inserted(written, rowId);
};
const hitRows = (...raw) => domain.parseRows([...baseRaw(), ...raw]);
const shuffled = (list, seed) => {
  const copy = [...list];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const chatBody = (uid, ip, message = 'Hallo') => ({
  action: 'chat',
  _identity: { uid },
  _clientKey: ip,
  message,
});

test('chat without Firebase _identity.uid rejects with 401', () => {
  for (const body of [
    { action: 'chat', message: 'Hallo' },
    { action: 'chat', _identity: null, message: 'Hallo' },
    { action: 'chat', _identity: {}, message: 'Hallo' },
  ]) {
    assert.throws(
      () => domain.publicAction(body, rows()),
      (err) => err.status === 401 && /Log eerst in/.test(err.message),
    );
  }
});

test('buildRateHit stores hashed keys only, under a unique recordId, with the id given', () => {
  const written = domain.buildRateHit('chat', [keyOf('a'), 'raw-key', keyOf('a')], T0, 'abc123');
  assert.equal(written.kind, 'ratehit');
  assert.equal(written.recordId, 'ratehit:chat:abc123');
  const data = JSON.parse(written.payload).data;
  assert.equal(data.action, 'chat');
  assert.equal(data.at, T0);
  assert.equal(data.keys.length, 2);
  for (const key of data.keys) assert.match(key, /^sha256:[0-9a-f]{64}$/);
  assert.ok(!written.payload.includes('raw-key'));
});

test('legacy ratelimit rows are ignored: they neither count nor get pruned', () => {
  const legacy = domain.row('ratelimit', 'chat', {
    global: Array.from({ length: 500 }, (_, i) => T0 + i),
    clients: { [keyOf('a')]: Array.from({ length: 500 }, (_, i) => T0 + i) },
  });
  const own = hitAt('chat', [keyOf('a')], T0 + 1000, 'own', 1);
  const decision = domain.decideRateHit(hitRows(inserted(legacy, 0), own), 'chat', 1, T0 + 1000);
  assert.deepEqual(decision, { allowed: true, deleteRowIds: [] });
});

test('per-client limit: N concurrent hits with distinct ids allow exactly perClient, in any order', () => {
  for (const action of ['chat', 'event-request']) {
    const { perClient } = domain.RATE_LIMITS[action];
    const total = perClient + 7;
    const hits = Array.from({ length: total }, (_, i) =>
      hitAt(action, [keyOf('same'), domain.hashClientKey(`10.0.0.${i}`)], T0 + i, `r${i}`, 100 + i),
    );
    const reread = hitRows(...hits);
    for (const seed of [1, 2, 3, 4]) {
      const allowed = shuffled(hits, seed)
        .filter((hit) => domain.decideRateHit(reread, action, hit.id, T0 + 5000).allowed)
        .map((hit) => hit.id)
        .sort((a, b) => a - b);
      assert.deepEqual(
        allowed,
        Array.from({ length: perClient }, (_, i) => 100 + i),
      );
    }
    // every denied hit deletes itself
    const denied = domain.decideRateHit(reread, action, 100 + total - 1, T0 + 5000);
    assert.equal(denied.allowed, false);
    assert.deepEqual(denied.deleteRowIds, [100 + total - 1]);
  }
});

test('global limit: distinct keys each under perClient allow exactly global, in any order', () => {
  for (const action of ['chat', 'event-request']) {
    const { global } = domain.RATE_LIMITS[action];
    const hits = Array.from({ length: global + 10 }, (_, i) =>
      hitAt(action, [keyOf(`user-${i}`)], T0 + i, `g${i}`, 500 + i),
    );
    const reread = hitRows(...hits);
    const allowed = shuffled(hits, 9)
      .filter((hit) => domain.decideRateHit(reread, action, hit.id, T0 + 5000).allowed)
      .map((hit) => hit.id)
      .sort((a, b) => a - b);
    assert.deepEqual(
      allowed,
      Array.from({ length: global }, (_, i) => 500 + i),
    );
  }
});

test('hits of another action do not count', () => {
  const chatHits = Array.from({ length: 40 }, (_, i) =>
    hitAt('chat', [keyOf('x')], T0 + i, `c${i}`, 10 + i),
  );
  const own = hitAt('event-request', [keyOf('x')], T0 + 100, 'own', 200);
  const reread = hitRows(...chatHits, own);
  assert.equal(domain.decideRateHit(reread, 'event-request', 200, T0 + 200).allowed, true);
});

test('a signed-in user cannot escape the per-client limit by rotating a spoofed forwarded IP', () => {
  for (const action of ['chat', 'event-request']) {
    const { perClient } = domain.RATE_LIMITS[action];
    const hits = [];
    for (let i = 0; i < perClient + 1; i++) {
      let body = chatBody('rotating-user', `198.18.0.${i}`);
      if (action === 'event-request') {
        body = request();
        body._identity = { uid: 'rotating-user' };
        body._clientKey = `198.18.0.${i}`;
        body.config.date = `2099-12-${String(10 + i).padStart(2, '0')}`;
      }
      const ctx = domain.publicAction(body, rows(), T0 + i, `s${i}`);
      assert.equal(ctx.hitRow.recordId, `ratehit:${action}:s${i}`);
      hits.push(inserted(ctx.hitRow, 300 + i));
    }
    const reread = hitRows(...hits);
    for (let i = 0; i < perClient; i++)
      assert.equal(domain.decideRateHit(reread, action, 300 + i, T0 + 100).allowed, true);
    assert.equal(domain.decideRateHit(reread, action, 300 + perClient, T0 + 100).allowed, false);
  }
});

test('expired hits count for nothing and at most 50 of them are returned for pruning', () => {
  const { perClient, windowMs } = domain.RATE_LIMITS.chat;
  const expired = Array.from({ length: 60 }, (_, i) =>
    hitAt('chat', [keyOf('x')], T0 - windowMs - 1 - i, `e${i}`, 10 + i),
  );
  const own = hitAt('chat', [keyOf('x')], T0, 'own', 900);
  const decision = domain.decideRateHit(hitRows(...expired, own), 'chat', 900, T0);
  assert.equal(decision.allowed, true);
  assert.equal(decision.deleteRowIds.length, 50);
  assert.ok(decision.deleteRowIds.every((id) => id >= 10 && id < 70));
  assert.equal(new Set(decision.deleteRowIds).size, 50);
  // a hit exactly one window old is expired too
  const edge = hitAt('chat', [keyOf('x')], T0 - windowMs, 'edge', 5);
  assert.deepEqual(domain.decideRateHit(hitRows(edge, own), 'chat', 900, T0).deleteRowIds, [5]);
  // expired hits use no quota; a denied hit lists itself plus the expired ids
  const fresh = Array.from({ length: perClient }, (_, i) =>
    hitAt('chat', [keyOf('x')], T0 - 10 + i, `f${i}`, 100 + i),
  );
  const crowded = hitRows(...expired.slice(0, 3), ...fresh, own);
  const denied = domain.decideRateHit(crowded, 'chat', 900, T0);
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.deleteRowIds, [900, 10, 11, 12]);
});

test('an own hit without a row id is denied, a rival without one counts as earlier', () => {
  const { perClient } = domain.RATE_LIMITS['event-request'];
  const own = hitAt('event-request', [keyOf('x')], T0, 'own', 50);
  for (const id of [undefined, null, '', 'abc'])
    assert.equal(domain.decideRateHit(hitRows(own), 'event-request', id, T0).allowed, false);
  // our own row missing from the re-read: fail closed and delete the id we hold
  assert.deepEqual(domain.decideRateHit(hitRows(), 'event-request', 50, T0), {
    allowed: false,
    deleteRowIds: [50],
  });
  const idless = Array.from({ length: perClient }, (_, i) =>
    hitAt('event-request', [keyOf('x')], T0 + i, `i${i}`),
  );
  const denied = domain.decideRateHit(hitRows(...idless, own), 'event-request', 50, T0 + 100);
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.deleteRowIds, [50]);
  const fewer = hitRows(...idless.slice(1), own);
  assert.equal(domain.decideRateHit(fewer, 'event-request', 50, T0 + 100).allowed, true);
});

test('decideRateHit counts raw rows, so a duplicated recordId counts twice', () => {
  const { perClient } = domain.RATE_LIMITS['event-request'];
  const dup = hitAt('event-request', [keyOf('x')], T0, 'same');
  const dups = Array.from({ length: perClient }, (_, i) => inserted(dup, 10 + i));
  const own = hitAt('event-request', [keyOf('x')], T0 + 1, 'own', 99);
  const reread = hitRows(...dups, own);
  assert.equal(domain.decideRateHit(reread, 'event-request', 99, T0 + 2).allowed, false);
});

test('chat inserts a hit before Gemini, and invalid requests create no hit', () => {
  const ctx = domain.publicAction(chatBody('chat-user', '203.0.113.10'), rows(), T0, 'x1');
  assert.equal(ctx.route, 'hit');
  assert.equal(ctx.chat, true);
  assert.ok(ctx.geminiBody);
  assert.equal(ctx.hitRow.kind, 'ratehit');
  assert.equal(ctx.rateLimitWrite, undefined);
  assert.equal(JSON.parse(ctx.hitRow.payload).data.keys.length, 2);
  for (const message of ['', '   ', undefined]) {
    assert.throws(
      () => domain.publicAction({ ...chatBody('chat-user', '203.0.113.10'), message }, rows(), T0),
      (err) => err.status === 400,
    );
  }
  const invalid = request();
  invalid.config.participants = 99999;
  assert.throws(
    () => domain.publicAction(invalid, rows(), T0),
    (err) => err.status === 400,
  );
});

test('decideHit: allowed goes to Gemini with prune ids, denied deletes its own hit and answers 429', () => {
  const { perClient } = domain.RATE_LIMITS.chat;
  const old = hitAt('chat', [keyOf('other')], T0 - 4_000_000, 'old', 3);
  const earlier = Array.from({ length: perClient }, (_, i) =>
    hitAt('chat', [keyOf('chat-user')], T0 - 1000 + i, `p${i}`, 10 + i),
  );
  const ctx = domain.publicAction(chatBody('chat-user', '203.0.113.10'), rows(), T0, 'mine');
  const own = inserted(ctx.hitRow, 60);
  const allowed = domain.decideHit(ctx, hitRows(old, own), 60, T0);
  assert.equal(allowed.route, 'gemini');
  assert.deepEqual(allowed.pruneRowIds, [3]);
  assert.ok(allowed.geminiBody);
  const denied = domain.decideHit(ctx, hitRows(old, ...earlier, own), 60, T0);
  assert.equal(denied.route, 'lost');
  assert.equal(denied.status, 429);
  assert.match(denied.response.error, /Te veel verzoeken/);
  assert.deepEqual(denied.deleteRowIds, [60, 3]);
  assert.equal(denied.geminiBody, undefined);
  // no usable id: fail closed with 503, never Gemini
  const noId = domain.decideHit(ctx, hitRows(ctx.hitRow), undefined, T0);
  assert.notEqual(noId.route, 'gemini');
  assert.equal(noId.status, 503);
});

test('event-request: one claim row plus one hit row, settled together', () => {
  const a = claimRequest();
  assert.equal(a.context.route, 'claim');
  assert.equal(a.context.hitRow.kind, 'ratehit');
  assert.equal(JSON.parse(a.context.hitRow.payload).data.action, 'event-request');
  // appointment and block claims carry no hit
  assert.equal(claimBlock().hitRow, undefined);
  assert.equal(domain.publicAction(appointmentBody(), snapshot()).hitRow, undefined);
  // won slot + allowed hit -> Gemini with prune ids, no rateLimitWrite
  const reread = snapshot(inserted(a.context.claimRow, 11), inserted(a.context.hitRow, 12));
  const won = domain.settleClaim(a.context, reread, 11, 12, T0);
  assert.equal(won.route, 'gemini');
  assert.deepEqual(won.pruneRowIds, []);
  assert.equal(won.rateLimitWrite, undefined);
});

test('event-request: losing the slot deletes both the claim and the hit', () => {
  const a = claimRequest();
  const b = claimRequest({ startTime: '12:00', endTime: '18:00' });
  const reread = snapshot(
    inserted(a.context.claimRow, 11),
    inserted(b.context.claimRow, 12),
    inserted(a.context.hitRow, 13),
    inserted(b.context.hitRow, 14),
  );
  const lost = domain.settleClaim(b.context, reread, 12, 14, T0);
  assert.equal(lost.route, 'lost');
  assert.equal(lost.status, 409);
  assert.deepEqual(lost.deleteRowIds, [12, 14]);
  // without the insert's hit id the unambiguous row is still found by its unique recordId
  assert.deepEqual(domain.settleClaim(b.context, reread, 12, undefined, T0).deleteRowIds, [12, 14]);
  // when the hit cannot be found at all only the claim is deleted
  const noHit = snapshot(inserted(a.context.claimRow, 11), inserted(b.context.claimRow, 12));
  assert.deepEqual(domain.settleClaim(b.context, noHit, 12, undefined, T0).deleteRowIds, [12]);
});

test('event-request: a 429 after winning the slot deletes the claim, the hit and expired hits', () => {
  const { perClient } = domain.RATE_LIMITS['event-request'];
  const a = claimRequest();
  const earlier = Array.from({ length: perClient }, (_, i) =>
    hitAt('event-request', [keyOf('test-user')], T0 - 1000 + i, `q${i}`, 20 + i),
  );
  const old = hitAt('event-request', [keyOf('test-user')], T0 - 4_000_000, 'old', 5);
  const reread = snapshot(
    inserted(a.context.claimRow, 40),
    inserted(a.context.hitRow, 41),
    ...earlier,
    old,
  );
  const result = domain.settleClaim(a.context, reread, 40, 41, T0);
  assert.equal(result.route, 'lost');
  assert.equal(result.status, 429);
  assert.match(result.response.error, /Te veel verzoeken/);
  assert.deepEqual(result.deleteRowIds, [40, 41, 5]);
});

test('event-request: an unusable hit id fails closed and deletes the claim', () => {
  const a = claimRequest();
  const reread = snapshot(inserted(a.context.claimRow, 40), inserted(a.context.hitRow, 41));
  const result = domain.settleClaim(a.context, reread, 40, undefined, T0);
  assert.equal(result.route, 'lost');
  assert.equal(result.status, 503);
  assert.ok(result.deleteRowIds.includes(40));
  // an unusable claim id also removes our hit when it is unambiguous
  const noClaimId = domain.settleClaim(a.context, reread, undefined, 41, T0);
  assert.equal(noClaimId.status, 503);
  assert.deepEqual([...noClaimId.deleteRowIds].sort(), [40, 41]);
});

test('event-request: a held retry inserts no hit, a claiming retry counts as a new hit', () => {
  const s = savedRequest();
  const held = domain.publicAction(s.body, snapshot(inserted(s.result.write, 3)), T0);
  assert.equal(held.route, 'respond');
  assert.equal(held.hitRow, undefined);
  const mine = claimRequest();
  const claimingRow = inserted(mine.context.claimRow, 20);
  const claiming = domain.publicAction(mine.body, snapshot(claimingRow), T0, 'retry1');
  assert.equal(claiming.route, 'hit');
  assert.equal(claiming.hitRow.recordId, 'ratehit:event-request:retry1');
  assert.ok(claiming.geminiBody);
  const settled = domain.decideHit(
    claiming,
    snapshot(claimingRow, inserted(claiming.hitRow, 21)),
    21,
    T0,
  );
  assert.equal(settled.route, 'gemini');
  assert.equal(settled.booking.id, mine.body.requestId);
});

test('idempotent retry of an existing held event-request returns 200 even when rate limit is full', () => {
  const saved = savedRequest();
  const full = Array.from({ length: 10 }, (_, i) =>
    hitAt('event-request', [keyOf('test-user')], T0 + i, `f${i}`, 700 + i),
  );
  const state = [...saved.rows, ...domain.parseRows(full)];
  const fresh = request();
  fresh.config.date = '2099-12-20';
  const ctx = domain.publicAction(fresh, state, T0 + 500, 'fresh');
  const reread = [
    ...state,
    ...domain.parseRows([inserted(ctx.claimRow, 800), inserted(ctx.hitRow, 801)]),
  ];
  assert.equal(domain.settleClaim(ctx, reread, 800, 801, T0 + 500).status, 429);
  const retry = domain.publicAction(saved.body, state, T0 + 500);
  assert.equal(retry.route, 'respond');
  assert.equal(retry.status, 200);
  assert.equal(retry.response.booking.id, saved.body.requestId);
});

test('hit rows hold hashed keys only and never appear in the admin snapshot', () => {
  const { clientKeyFromHeaders, sha256 } = require('../code/auth-context.cjs');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const rawIp = '203.0.113.77';
  const fromForwarded = clientKeyFromHeaders({
    'X-Forwarded-For': `${rawIp}, 10.0.0.1`,
  });
  assert.equal(fromForwarded, clientKeyFromHeaders({ 'cf-connecting-ip': rawIp }));
  assert.equal(fromForwarded, clientKeyFromHeaders({ 'x-real-ip': rawIp }));
  assert.match(fromForwarded, /^sha256:[0-9a-f]{64}$/);
  assert.ok(!fromForwarded.includes(rawIp));
  const chat = domain.publicAction(chatBody('privacy-user', rawIp, 'Test privacy'), rows(), T0);
  const event = request();
  event._identity = { uid: 'privacy-user' };
  event._clientKey = rawIp;
  const claim = domain.publicAction(event, rows(), T0);
  for (const hitRow of [chat.hitRow, claim.hitRow]) {
    assert.ok(!hitRow.payload.includes(rawIp));
    assert.ok(!hitRow.payload.includes('privacy-user'));
    assert.ok(!hitRow.recordId.includes('privacy-user'));
    const keys = JSON.parse(hitRow.payload).data.keys;
    assert.equal(keys.length, 2);
    for (const key of keys) assert.match(key, /^sha256:[0-9a-f]{64}$/);
  }
  const state = domain.parseRows([
    ...baseRaw(),
    inserted(chat.hitRow, 1),
    inserted(claim.hitRow, 2),
    inserted(domain.row('ratelimit', 'chat', { global: [T0], clients: {} }), 3),
  ]);
  const snap = domain.adminAction({ action: 'snapshot' }, state).response;
  assert.ok(!JSON.stringify(snap).includes('ratehit'));
  assert.ok(!JSON.stringify(snap).includes('sha256:'));
  assert.equal(snap.bookings.length, 0);
  assert.equal(snap.logs.length, 0);
});

/** Runs one generated Code node with a minimal n8n stub (`$`, `$input`). */
function runCodeNode(wf, name, { input = [], nodes = {} } = {}) {
  const node = wf.nodes.find((n) => n.name === name);
  const items = (list) => list.map((json) => ({ json }));
  const $ = (from) => {
    const list = items(nodes[from] ?? []);
    return { first: () => list[0], all: () => list };
  };
  const fn = vm.runInNewContext(`(function($input,$){${node.parameters.jsCode}\n})`);
  const out = fn({ all: () => items(input), first: () => items(input)[0] }, $);
  // Objects from the vm context have another realm's prototypes; round-trip for deepStrictEqual.
  return JSON.parse(JSON.stringify(out.map((item) => item.json)));
}

for (const dir of ['workflows', 'workflows/prod']) {
  const load = (file) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, `../${dir}/${file}`), 'utf8'));

  test(`${dir} B wires insert hit, re-read, decide, then Gemini; no legacy rate-limit nodes`, () => {
    const wf = load('B-public-api-and-proposals.json');
    const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
    const next = (from, index = 0) =>
      (wf.connections[from]?.main[index] ?? []).map((edge) => edge.node);
    for (const gone of [
      'Rate limit payload',
      'Record rate limit',
      'After rate limit',
      'Rate limit recorded',
    ])
      assert.equal(byName[gone], undefined, gone);
    assert.doesNotMatch(JSON.stringify(wf), /rateLimitWrite|checkRateLimit|Rate limit recorded/);
    // chat and the claiming retry take the hit route
    assert.deepEqual(next('Needs claim', 0), ['Write claim']);
    assert.deepEqual(next('Needs claim', 1), ['Needs hit']);
    assert.equal(byName['Needs hit'].parameters.conditions.conditions[0].rightValue, 'hit');
    assert.deepEqual(next('Needs hit', 0), ['Write hit']);
    assert.deepEqual(next('Needs hit', 1), ['Result']);
    assert.deepEqual(next('Write hit'), ['Insert hit']);
    assert.equal(byName['Insert hit'].parameters.operation, 'insert');
    assert.equal(byName['Insert hit'].onError, 'continueRegularOutput');
    assert.deepEqual(next('Insert hit'), ['Re-read records after hit']);
    assert.equal(byName['Re-read records after hit'].parameters.operation, 'get');
    assert.deepEqual(next('Re-read records after hit'), ['Decide hit']);
    assert.match(byName['Decide hit'].parameters.jsCode, /decideHit/);
    assert.match(byName['Decide hit'].parameters.jsCode, /\$\('Insert hit'\)/);
    assert.deepEqual(next('Decide hit'), ['Needs Gemini']);
    assert.deepEqual(next('Settle claim'), ['Needs Gemini']);
    // an allowed request prunes expired hits (best effort) and calls Gemini; a denied one answers
    assert.deepEqual(next('Needs Gemini', 0), ['Prune payload', 'Gemini']);
    assert.deepEqual(next('Needs Gemini', 1), ['Result']);
    assert.deepEqual(next('Prune payload'), ['Prune expired hits']);
    const prune = byName['Prune expired hits'];
    assert.equal(prune.parameters.operation, 'deleteRows');
    assert.equal(prune.onError, 'continueRegularOutput');
    assert.equal(prune.parameters.filters.conditions[0].keyName, 'id');
    assert.equal(prune.parameters.filters.conditions[0].keyValue, '={{ $json.id }}');
    assert.equal(wf.connections['Prune expired hits'], undefined, 'prune is a dead end');
    // the decision sits before Gemini and PR #50's chain is intact
    assert.match(byName['Gemini fallback'].parameters.jsonBody, /\$\("Needs Gemini"\)/);
    assert.deepEqual(next('Gemini'), ['Gemini failed']);
    assert.deepEqual(next('Gemini failed', 0), ['Gemini fallback']);
    assert.deepEqual(next('Gemini failed', 1), ['Validate AI output']);
    assert.deepEqual(next('Gemini fallback'), ['Validate AI output']);
    assert.deepEqual(next('Validate AI output'), ['Result']);
    // Gemini hangs only off the allow branch of the decision
    const feeders = Object.entries(wf.connections)
      .filter(([, v]) => v.main.flat().some((e) => e.node === 'Gemini'))
      .map(([k]) => k);
    assert.deepEqual(feeders, ['Needs Gemini']);
    assert.equal(byName['Needs Gemini'].parameters.conditions.conditions[0].rightValue, 'gemini');
  });

  test(`${dir} B and C delete lost rows through one item per id and answer once`, () => {
    for (const file of ['B-public-api-and-proposals.json', 'C-employee-api.json']) {
      const wf = load(file);
      const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
      const next = (from, index = 0) =>
        (wf.connections[from]?.main[index] ?? []).map((edge) => edge.node);
      assert.deepEqual(next('Needs delete', 0), ['Lost claim ids']);
      assert.deepEqual(next('Lost claim ids'), ['Delete lost claim']);
      assert.deepEqual(next('Delete lost claim'), ['After lost claim']);
      assert.deepEqual(next('After lost claim'), ['Respond']);
      const del = byName['Delete lost claim'];
      assert.equal(del.parameters.operation, 'deleteRows');
      assert.equal(del.parameters.filters.conditions[0].keyName, 'id');
      assert.equal(del.parameters.filters.conditions[0].keyValue, '={{ $json.id }}');
      assert.equal(del.alwaysOutputData, true);
      assert.equal(del.onError, 'continueRegularOutput');
      assert.doesNotMatch(JSON.stringify(wf), /deleteRowId\b/);
      assert.match(byName['After lost claim'].parameters.jsCode, /\$\('Result'\)\.first\(\)/);
      const result = {
        route: 'lost',
        status: 429,
        response: { error: 'x' },
        deleteRowIds: [4, 9, 12],
      };
      assert.deepEqual(runCodeNode(wf, 'Lost claim ids', { nodes: { Result: [result] } }), [
        { id: 4 },
        { id: 9 },
        { id: 12 },
      ]);
      // always at least one item, so the webhook is answered even for an empty id list
      const empty = { ...result, deleteRowIds: [] };
      assert.equal(runCodeNode(wf, 'Lost claim ids', { nodes: { Result: [empty] } }).length, 1);
      // three delete outputs (one failed) still produce one answer
      const answered = runCodeNode(wf, 'After lost claim', {
        input: [{}, { error: 'x' }, {}],
        nodes: { Result: [result] },
      });
      assert.deepEqual(answered, [{ status: 429, response: { error: 'x' } }]);
    }
  });

  test(`${dir} B and C claim wiring: insert, re-read, settle by recordId, delete on loss`, () => {
    for (const file of ['B-public-api-and-proposals.json', 'C-employee-api.json']) {
      const wf = load(file);
      const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
      const next = (from, index = 0) =>
        (wf.connections[from]?.main[index] ?? []).map((edge) => edge.node);
      assert.equal(byName['Insert claim'].parameters.operation, 'insert');
      assert.equal(byName['Re-read records after claim'].parameters.operation, 'get');
      assert.match(byName['Settle claim'].parameters.jsCode, /settleClaim/);
      assert.match(byName['Settle claim'].parameters.jsCode, /\$\('Insert claim'\)\.all\(\)/);
      assert.doesNotMatch(byName['Settle claim'].parameters.jsCode, /Insert claim'\)\.first/);
      assert.deepEqual(next('Route request'), ['Needs claim']);
      assert.deepEqual(next('Needs claim', 0), ['Write claim']);
      assert.deepEqual(next('Write claim'), ['Insert claim']);
      assert.deepEqual(next('Insert claim'), ['Re-read records after claim']);
      assert.deepEqual(next('Re-read records after claim'), ['Settle claim']);
      assert.deepEqual(next('Settle claim'), [file.startsWith('B-') ? 'Needs Gemini' : 'Result']);
      assert.deepEqual(next('Result'), ['Needs delete']);
      assert.deepEqual(next('Needs delete', 1), ['Needs save']);
    }
  });

  test(`${dir} B: Write claim emits claim and hit, Settle claim matches ids by recordId`, () => {
    const wf = load('B-public-api-and-proposals.json');
    const a = claimRequest();
    const written = runCodeNode(wf, 'Write claim', {
      nodes: { 'Route request': [a.context] },
    });
    assert.deepEqual(written, [a.context.claimRow, a.context.hitRow]);
    const block = claimBlock();
    assert.deepEqual(runCodeNode(wf, 'Write claim', { nodes: { 'Route request': [block] } }), [
      block.claimRow,
    ]);
    const claimInserted = inserted(a.context.claimRow, 31);
    const hitInserted = inserted(a.context.hitRow, 32);
    // the insert node may return the ids in either order
    for (const insertOutput of [
      [claimInserted, hitInserted],
      [hitInserted, claimInserted],
    ]) {
      const [out] = runCodeNode(wf, 'Settle claim', {
        input: [...baseRaw(), claimInserted, hitInserted],
        nodes: { 'Route request': [a.context], 'Insert claim': insertOutput },
      });
      assert.equal(out.route, 'gemini', JSON.stringify(out.response));
      assert.deepEqual(out.pruneRowIds, []);
    }
    const [failed] = runCodeNode(wf, 'Settle claim', {
      input: [...baseRaw(), claimInserted, hitInserted],
      nodes: {
        'Route request': [a.context],
        'Insert claim': [{ error: 'x' }, hitInserted],
      },
    });
    assert.equal(failed.route, 'respond');
    assert.equal(failed.status, 503);
  });

  test(`${dir} B: Decide hit answers 503 and never Gemini when the insert or re-read failed`, () => {
    const wf = load('B-public-api-and-proposals.json');
    const ctx = domain.publicAction(chatBody('chat-user', '203.0.113.10'), rows(), T0, 'd1');
    const own = inserted(ctx.hitRow, 70);
    const [ok] = runCodeNode(wf, 'Decide hit', {
      input: [...baseRaw(), own],
      nodes: { 'Route request': [ctx], 'Insert hit': [own] },
    });
    assert.equal(ok.route, 'gemini');
    const [insertFailed] = runCodeNode(wf, 'Decide hit', {
      input: [...baseRaw(), own],
      nodes: { 'Route request': [ctx], 'Insert hit': [{ error: 'x' }] },
    });
    assert.equal(insertFailed.route, 'respond');
    assert.equal(insertFailed.status, 503);
    const [rereadFailed] = runCodeNode(wf, 'Decide hit', {
      input: [{ error: 'db down' }],
      nodes: { 'Route request': [ctx], 'Insert hit': [own] },
    });
    assert.equal(rereadFailed.route, 'respond');
    assert.equal(rereadFailed.status, 503);
    assert.equal(rereadFailed.geminiBody, undefined);
    const pruned = runCodeNode(wf, 'Prune payload', {
      input: [{ ...ok, pruneRowIds: [3, 4] }],
    });
    assert.deepEqual(pruned, [{ id: 3 }, { id: 4 }]);
  });

  test(`${dir} B setup note names the rate-hit nodes`, () => {
    const note = load('B-public-api-and-proposals.json').nodes.find((n) => n.name === 'Setup')
      .parameters.content;
    assert.doesNotMatch(note, /Record rate limit/);
    assert.match(note, /Insert hit/);
    assert.match(note, /Re-read records after hit/);
    assert.match(note, /Prune expired hits/);
  });
}

test('Workflow B enforces Firebase auth on chat and routes the caller key through Access', () => {
  const wf = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../workflows/B-public-api-and-proposals.json'), 'utf8'),
  );
  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  // Execute Access node inside restricted VM context without require()
  const runAccess = (action, headers = {}) => {
    const fn = vm.runInNewContext(`(function($input){${byName['Access'].parameters.jsCode}\n})`);
    return fn({ first: () => ({ json: { headers, body: { action } } }) })[0].json;
  };
  assert.equal(runAccess('catalogue').route, 'public');
  assert.equal(runAccess('chat', { 'x-forwarded-for': '198.51.100.42' }).route, 'verify');
  assert.equal(runAccess('event-request', { 'x-forwarded-for': '198.51.100.42' }).route, 'verify');
  assert.equal(runAccess('my-requests').route, 'verify');
  const accessOut = runAccess('chat', {
    'x-forwarded-for': '198.51.100.42, 10.0.0.5',
  });
  assert.match(accessOut.clientKey, /^sha256:[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(accessOut).includes('198.51.100.42'));
});
// --- In-app appointments (#17) -----------------------------------------------------------
function appointmentBody(overrides = {}) {
  return {
    action: 'book-appointment',
    _identity: { uid: 'customer-1', email: 'klant@example.test' },
    requestId: randomUUID(),
    date: '2099-01-05', // Monday
    startTime: '10:00',
    endTime: '11:00',
    format: 'location_tour',
    customer: {
      fullName: 'Sanne de Vries',
      email: 'klant@example.test',
      phone: '0612345678',
      company: 'Studio Noord',
    },
    notes: 'Graag het Esports Stadium bekijken.',
    ...overrides,
  };
}

function savedAppointment(overrides = {}, existingRows = snapshot(), rowId = 41) {
  const body = appointmentBody(overrides);
  const claim = domain.publicAction(body, existingRows);
  assert.equal(claim.route, 'claim');
  assert.equal(claim.claimKind, 'appointment');
  const withClaim = [...existingRows, ...domain.parseRows([inserted(claim.claimRow, rowId)])];
  const settled = domain.settleClaim(claim, withClaim, rowId);
  assert.equal(settled.route, 'save');
  assert.equal(settled.status, 201);
  const nextRows = [...existingRows, ...domain.parseRows([inserted(settled.write, rowId)])];
  return { body, claim, settled, rows: nextRows };
}

test('appointment-slots returns 4 weekday slots, marks weekends/past unavailable, and leaks zero PII', () => {
  assert.equal(new Date('2099-01-05T00:00:00Z').getUTCDay(), 1); // Monday
  assert.equal(new Date('2099-01-03T00:00:00Z').getUTCDay(), 6); // Saturday
  assert.equal(new Date('2099-01-04T00:00:00Z').getUTCDay(), 0); // Sunday

  const monday = domain.publicAction(
    { action: 'appointment-slots', date: '2099-01-05' },
    snapshot(),
  );
  assert.equal(monday.route, 'respond');
  assert.equal(monday.response.slots.length, 4);
  assert.ok(monday.response.slots.every((s) => s.available));

  for (const nonBookable of ['2099-01-03', '2099-01-04', '2020-01-06']) {
    const res = domain.availableAppointmentSlots(snapshot(), nonBookable);
    assert.equal(res.slots.length, 4);
    assert.ok(
      res.slots.every((s) => !s.available),
      nonBookable,
    );
  }

  for (const invalid of ['2099-02-31', 'not-a-date', '']) {
    assert.throws(() => domain.availableAppointmentSlots(snapshot(), invalid), /geldige datum/);
  }

  const booked = savedAppointment({ startTime: '11:30', endTime: '12:30' });
  const after = domain.publicAction(
    { action: 'appointment-slots', date: '2099-01-05' },
    booked.rows,
  );
  assert.deepEqual(
    after.response.slots.map((s) => [s.startTime, s.available]),
    [
      ['10:00', true],
      ['11:30', false],
      ['14:00', true],
      ['15:30', true],
    ],
  );
  const serialized = JSON.stringify(after);
  assert.ok(!serialized.includes('Sanne'));
  assert.ok(!serialized.includes('klant@example.test'));
  assert.ok(!serialized.includes('0612345678'));
  assert.ok(!serialized.includes('AF-'));
});

test('Closure blocks make overlapping appointment slots unavailable, while room Maintenance blocks do not', () => {
  const closureRow = inserted(
    domain.row('block', 'closure-1', {
      id: 'closure-1',
      roomId: room.id,
      roomName: room.name,
      date: '2099-01-05',
      startTime: '13:30',
      endTime: '16:00',
      reason: 'Locatie gesloten',
      type: 'Closure',
    }),
    10,
  );
  const maintenanceRow = inserted(
    domain.row('block', 'maint-1', {
      id: 'maint-1',
      roomId: room.id,
      roomName: room.name,
      date: '2099-01-05',
      startTime: '10:00',
      endTime: '11:00',
      reason: 'Beamer onderhoud',
      type: 'Maintenance',
    }),
    11,
  );
  const res = domain.availableAppointmentSlots(snapshot(closureRow, maintenanceRow), '2099-01-05');
  assert.deepEqual(
    res.slots.map((s) => [s.startTime, s.available]),
    [
      ['10:00', true],
      ['11:30', true],
      ['14:00', false],
      ['15:30', false],
    ],
  );
  assert.throws(
    () =>
      domain.publicAction(
        appointmentBody({ startTime: '14:00', endTime: '15:00' }),
        snapshot(closureRow),
      ),
    (err) => err.status === 409 && /niet meer beschikbaar/.test(err.message),
  );
});

test('book-appointment enforces auth, validates inputs, prevents double-booking, and supports idempotent retries', () => {
  assert.throws(
    () => domain.publicAction(appointmentBody({ _identity: null }), snapshot()),
    (err) => err.status === 401 && /Log eerst in/.test(err.message),
  );
  for (const invalid of [
    { requestId: 'bad-id' },
    { date: '2099-01-03' }, // Saturday
    { date: '2020-01-06' }, // Past Monday
    { startTime: '09:00', endTime: '10:00' },
    { format: 'phone_call' },
    { customer: { fullName: '', email: 'klant@example.test' } },
    { customer: { fullName: 'Sanne', email: 'invalid-email' } },
    { notes: 'x'.repeat(1001) },
  ]) {
    assert.throws(() => domain.publicAction(appointmentBody(invalid), snapshot()));
  }

  const first = savedAppointment();
  assert.equal(
    first.settled.response.appointment.reference,
    `AF-${first.body.requestId.slice(0, 8).toUpperCase()}`,
  );
  assert.equal(first.settled.response.appointment.status, 'pending');
  assert.equal(first.settled.response.appointment.claimStatus, undefined);

  // Idempotent retry by same owner returns existing appointment
  const retry = domain.publicAction(first.body, first.rows);
  assert.equal(retry.route, 'respond');
  assert.equal(retry.response.appointment.id, first.body.requestId);

  // Different user with same requestId is rejected with 409
  assert.throws(
    () =>
      domain.publicAction(
        { ...first.body, _identity: { uid: 'other-user', email: 'other@example.test' } },
        first.rows,
      ),
    (err) => err.status === 409,
  );

  // Double booking same slot with new requestId fails with 409
  assert.throws(
    () => domain.publicAction(appointmentBody(), first.rows),
    (err) => err.status === 409 && /niet meer beschikbaar/.test(err.message),
  );
});

test('two simultaneous appointment bookings for the same slot resolve race-safely via slot claims', () => {
  const bodyA = appointmentBody({ _identity: { uid: 'user-a' } });
  const bodyB = appointmentBody({ _identity: { uid: 'user-b' }, format: 'online_intake' });
  const claimA = domain.publicAction(bodyA, snapshot());
  const claimB = domain.publicAction(bodyB, snapshot());
  const rowsBoth = snapshot(inserted(claimA.claimRow, 51), inserted(claimB.claimRow, 52));

  const winA = domain.settleClaim(claimA, rowsBoth, 51);
  const loseB = domain.settleClaim(claimB, rowsBoth, 52);
  assert.equal(winA.route, 'save');
  assert.equal(winA.status, 201);
  assert.equal(JSON.parse(winA.write.payload).data.claimStatus, 'held');
  assert.equal(loseB.route, 'lost');
  assert.equal(loseB.status, 409);
  assert.deepEqual(loseB.deleteRowIds, [52]);
  assert.match(loseB.response.error, /niet meer beschikbaar/);
});

test('my-requests scopes appointments to ownerUid and admin can confirm or cancel with conflict re-check', () => {
  const apptA = savedAppointment({ _identity: { uid: 'owner-a' } }, snapshot(), 61);
  const apptB = savedAppointment(
    { _identity: { uid: 'owner-b' }, startTime: '14:00', endTime: '15:00' },
    apptA.rows,
    62,
  );

  const mineA = domain.publicAction(
    { action: 'my-requests', _identity: { uid: 'owner-a' } },
    apptB.rows,
  );
  assert.equal(mineA.response.appointments.length, 1);
  assert.equal(mineA.response.appointments[0].id, apptA.body.requestId);
  assert.equal(mineA.response.appointments[0].claimStatus, undefined);

  const snap = domain.adminAction({ action: 'snapshot' }, apptB.rows);
  assert.equal(snap.response.appointments.length, 2);

  // Confirm appointment A
  const confirmed = domain.adminAction(
    { action: 'appointment-status', id: apptA.body.requestId, actionType: 'confirm' },
    apptB.rows,
  );
  assert.equal(confirmed.route, 'save');
  assert.equal(confirmed.response.appointment.status, 'confirmed');
  assert.equal(JSON.parse(confirmed.write.payload).ownerUid, 'owner-a');

  // If a Closure block is added on appointment B's slot before staff confirms B, confirm fails with 409
  const closure = inserted(
    domain.row('block', 'closure-b', {
      id: 'closure-b',
      roomId: room.id,
      roomName: room.name,
      date: '2099-01-05',
      startTime: '14:00',
      endTime: '15:00',
      reason: 'Sluiting',
      type: 'Closure',
    }),
    63,
  );
  const withClosure = [
    ...apptB.rows.filter((r) => r.recordId !== `appointment:${apptA.body.requestId}`),
    ...domain.parseRows([inserted(confirmed.write, 61), closure]),
  ];
  assert.throws(
    () =>
      domain.adminAction(
        { action: 'appointment-status', id: apptB.body.requestId, actionType: 'confirm' },
        withClosure,
      ),
    (err) => err.status === 409 && /overlapt/.test(err.message),
  );

  // Cancelling appointment A frees its 10:00-11:00 slot
  const cancelled = domain.adminAction(
    { action: 'appointment-status', id: apptA.body.requestId, actionType: 'cancel' },
    withClosure,
  );
  assert.equal(cancelled.response.appointment.status, 'cancelled');
  const afterCancel = [
    ...apptB.rows.filter((r) => r.recordId !== `appointment:${apptA.body.requestId}`),
    ...domain.parseRows([inserted(cancelled.write, 61)]),
  ];
  const slotsAfterCancel = domain.availableAppointmentSlots(afterCancel, '2099-01-05');
  assert.equal(slotsAfterCancel.slots.find((s) => s.startTime === '10:00').available, true);
  const snapAfter = domain.adminAction({ action: 'snapshot' }, afterCancel);
  assert.ok(snapAfter.response.logs.some((l) => l.action === 'Afspraak geannuleerd'));
});

test('public workflow allows appointment-slots without auth while keeping book-appointment verified', () => {
  const wf = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../workflows/B-public-api-and-proposals.json'), 'utf8'),
  );
  const accessNode = wf.nodes.find((n) => n.name === 'Access');
  const runAccess = new vm.Script(
    `(function($input){ ${accessNode.parameters.jsCode} })`,
  ).runInNewContext();
  assert.equal(
    runAccess({ first: () => ({ json: { body: { action: 'appointment-slots' } } }) })[0].json.route,
    'public',
  );
  assert.equal(
    runAccess({ first: () => ({ json: { body: { action: 'book-appointment' } } }) })[0].json.route,
    'verify',
  );
});

// --- Gemini outage handling -------------------------------------------------------------
// n8n Cloud's edge replaces 502/504 webhook responses with its own reply (no CORS headers),
// so the browser only sees "Failed to fetch". Errors must use statuses that pass through.
test('chat failures answer 503 with a retry hint instead of a swallowed 502', () => {
  const chat = { chat: true, config: null };
  const status = (result) => {
    try {
      domain.finishGemini(chat, result);
    } catch (error) {
      return { status: error.status, message: error.message };
    }
    return null;
  };
  const busy = status({ error: { message: 'timeout of 20000ms exceeded' } });
  assert.equal(busy.status, 503);
  assert.match(busy.message, /niet beschikbaar|druk/i);
  assert.equal(status({ candidates: [] }).status, 503);
  const empty = { candidates: [{ content: { parts: [{ text: '{"reply":""}' }] } }] };
  assert.equal(status(empty).status, 503);
  const ok = { candidates: [{ content: { parts: [{ text: '{"reply":"Hallo!"}' }] } }] };
  assert.equal(domain.finishGemini(chat, ok).response.reply, 'Hallo!');
});

test('no workflow responds with a 502 or 504 status', () => {
  const dirs = ['../workflows', '../workflows/prod'].map((d) => path.join(__dirname, d));
  const files = dirs.flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.join(dir, file)),
  );
  assert.ok(files.length >= 7, String(files.length));
  for (const file of files) {
    const wf = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(wf, /status\s*(?::|\?\?)\s*50[24]\b/, file);
    assert.doesNotMatch(wf, /fail\([^)]*,\s*50[24]\)/, file);
  }
});

for (const dir of ['workflows', 'workflows/prod'])
  test(`${dir} B falls back to a second Gemini model and answers before the client gives up`, () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(__dirname, `../${dir}/B-public-api-and-proposals.json`), 'utf8'),
    );
    const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
    const next = (from, index = 0) =>
      (wf.connections[from]?.main[index] ?? []).map((edge) => edge.node);
    const model = (name) => byName[name].parameters.url.match(/models\/([^:]+):/)[1];
    assert.deepEqual(next('Gemini'), ['Gemini failed']);
    assert.deepEqual(next('Gemini failed', 0), ['Gemini fallback']);
    assert.deepEqual(next('Gemini failed', 1), ['Validate AI output']);
    assert.deepEqual(next('Gemini fallback'), ['Validate AI output']);
    assert.notEqual(model('Gemini'), model('Gemini fallback'));
    assert.deepEqual(byName['Gemini fallback'].credentials, byName['Gemini'].credentials);
    assert.equal(byName['Gemini fallback'].onError, 'continueRegularOutput');
    // The browser aborts after 60 s; both calls together must finish well before that.
    const timeouts = ['Gemini', 'Gemini fallback'].map((n) => byName[n].parameters.options.timeout);
    assert.ok(timeouts.reduce((a, b) => a + b, 0) <= 45000, String(timeouts));
  });
