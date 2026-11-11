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
test('workflow exports have valid connections, authentication and compilable Code nodes', () => {
  for (const file of fs.readdirSync(path.join(__dirname, '../workflows'))) {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '../workflows', file), 'utf8'));
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

test('live chat suggests only a published room that fits the group', () => {
  const context = domain.publicAction(
    { action: 'chat', message: 'Een teamdag voor 30 personen met budget 1000' },
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
  const tooLarge = domain.publicAction({ action: 'chat', message: 'Voor 500 personen' }, rows());
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
const outcome = (context, rows, id) =>
  domain.settleClaim(
    context,
    rows,
    id ?? rows.find((r) => r.recordId === context.claimRow.recordId)?.rowId,
  );

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
    assert.equal(lost.deleteRowId, 12);
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
  assert.equal(won.route, 'gemini');
  assert.equal(won.booking.id, mine.body.requestId);
  assert.ok(won.geminiBody);
  // loses: rival has the lower id
  const lost = domain.publicAction(
    mine.body,
    snapshot(inserted(rival.context.claimRow, 19), claiming),
  );
  assert.equal(lost.route, 'lost');
  assert.equal(lost.status, 409);
  assert.equal(lost.deleteRowId, 20);
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

test('B and C workflows wire claim insert, re-read, settle and delete-on-loss', () => {
  const load = (file) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '../workflows', file), 'utf8'));
  for (const file of ['B-public-api-and-proposals.json', 'C-employee-api.json']) {
    const wf = load(file);
    const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
    const next = (from, index = 0) =>
      (wf.connections[from]?.main[index] ?? []).map((edge) => edge.node);
    assert.equal(byName['Insert claim'].parameters.operation, 'insert');
    assert.equal(byName['Re-read records after claim'].parameters.operation, 'get');
    assert.equal(byName['Delete lost claim'].parameters.operation, 'deleteRows');
    assert.equal(byName['Delete lost claim'].alwaysOutputData, true);
    assert.equal(byName['Delete lost claim'].parameters.filters.conditions[0].keyName, 'id');
    assert.match(
      byName['Settle claim'].parameters.jsCode,
      /\$\('Insert claim'\)\.first\(\)\.json\.id/,
    );
    assert.match(byName['Settle claim'].parameters.jsCode, /settleClaim/);
    assert.deepEqual(next('Route request'), ['Needs claim']);
    assert.deepEqual(next('Needs claim', 0), ['Write claim']);
    assert.deepEqual(next('Write claim'), ['Insert claim']);
    assert.deepEqual(next('Insert claim'), ['Re-read records after claim']);
    assert.deepEqual(next('Re-read records after claim'), ['Settle claim']);
    assert.deepEqual(next('Settle claim'), [file.startsWith('B-') ? 'Needs Gemini' : 'Result']);
    assert.deepEqual(next('Result'), ['Needs delete']);
    assert.deepEqual(next('Needs delete', 0), ['Delete lost claim']);
    assert.deepEqual(next('Needs delete', 1), ['Needs save']);
    assert.deepEqual(next('Delete lost claim'), ['After lost claim']);
    assert.deepEqual(next('After lost claim'), ['Respond']);
  }
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
  assert.equal(loser.deleteRowId, 32);
  // while both rows exist, a retry sees the lowest id and staff see one booking
  const retry = domain.publicAction(body, rowsBoth);
  assert.equal(retry.route, 'gemini');
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
