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

// --- Webhook abuse protection & rate limits (#10) ----------------------------------------
const upsertParsed = (parsedRows, writeRow) => [
  ...parsedRows.filter((item) => item.recordId !== writeRow.recordId),
  ...domain.parseRows([writeRow]),
];

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

test('per-client rate limit on chat and event-request returns 429 on (limit + 1)th request and resets after 1 hour', () => {
  const t0 = 1_700_000_000_000;
  let state = rows();
  for (let i = 0; i < domain.RATE_LIMITS.chat.perClient; i++) {
    const out = domain.publicAction(
      {
        action: 'chat',
        _identity: { uid: 'chat-user' },
        _clientKey: '203.0.113.10',
        message: `Vraag ${i}`,
      },
      state,
      t0 + i * 1000,
    );
    assert.equal(out.route, 'gemini');
    state = upsertParsed(state, out.rateLimitWrite);
  }
  assert.throws(
    () =>
      domain.publicAction(
        {
          action: 'chat',
          _identity: { uid: 'chat-user' },
          _clientKey: '203.0.113.10',
          message: 'Te veel',
        },
        state,
        t0 + 30_000,
      ),
    (err) => err.status === 429 && /Te veel verzoeken/.test(err.message),
  );
  // Succeeds again 1 hour after the earliest timestamp (frees 1 slot) and prunes all after full window
  const afterFirstExpiry = domain.publicAction(
    {
      action: 'chat',
      _identity: { uid: 'chat-user' },
      _clientKey: '203.0.113.10',
      message: 'Weer welkom',
    },
    state,
    t0 + 3600_001,
  );
  assert.equal(afterFirstExpiry.route, 'gemini');
  assert.equal(JSON.parse(afterFirstExpiry.rateLimitWrite.payload).data.global.length, 20);
  const afterFullWindow = domain.publicAction(
    {
      action: 'chat',
      _identity: { uid: 'chat-user' },
      _clientKey: '203.0.113.10',
      message: 'Schoon venster',
    },
    state,
    t0 + 19_000 + 3600_001,
  );
  assert.equal(afterFullWindow.route, 'gemini');
  assert.equal(JSON.parse(afterFullWindow.rateLimitWrite.payload).data.global.length, 1);

  // event-request per-client limit (5/hour)
  let reqState = rows();
  for (let i = 0; i < domain.RATE_LIMITS['event-request'].perClient; i++) {
    const body = request();
    body._clientKey = '203.0.113.20';
    body.config.date = `2099-12-${String(10 + i).padStart(2, '0')}`;
    const out = domain.publicAction(body, reqState, t0);
    assert.equal(out.route, 'claim');
    reqState = upsertParsed(reqState, out.rateLimitWrite);
  }
  const overReq = request();
  overReq._clientKey = '203.0.113.20';
  overReq.config.date = '2099-12-25';
  assert.throws(
    () => domain.publicAction(overReq, reqState, t0 + 10_000),
    (err) => err.status === 429 && /Te veel verzoeken/.test(err.message),
  );
  const afterReqWindow = domain.publicAction(overReq, reqState, t0 + 3600_001);
  assert.equal(afterReqWindow.route, 'claim');
  assert.equal(JSON.parse(afterReqWindow.rateLimitWrite.payload).data.global.length, 1);
});

test('global rate limit across distinct clients returns 429 when hourly cap is reached', () => {
  const t0 = 1_700_000_000_000;
  let chatState = rows();
  for (let i = 0; i < domain.RATE_LIMITS.chat.global; i++) {
    const out = domain.publicAction(
      {
        action: 'chat',
        _identity: { uid: `user-${i}` },
        _clientKey: `198.51.100.${i}`,
        message: 'Hallo',
      },
      chatState,
      t0 + i,
    );
    chatState = upsertParsed(chatState, out.rateLimitWrite);
  }
  assert.throws(
    () =>
      domain.publicAction(
        {
          action: 'chat',
          _identity: { uid: 'fresh-user' },
          _clientKey: '192.0.2.99',
          message: 'Nog een vraag',
        },
        chatState,
        t0 + 5000,
      ),
    (err) => err.status === 429,
  );

  let reqState = rows();
  for (let i = 0; i < domain.RATE_LIMITS['event-request'].global; i++) {
    const body = request();
    body._identity = { uid: `req-user-${i}`, email: `u${i}@example.test` };
    body._clientKey = `198.51.101.${i}`;
    const month = String(Math.floor(i / 25) + 1).padStart(2, '0');
    const day = String((i % 25) + 1).padStart(2, '0');
    body.config.date = `2099-${month}-${day}`;
    const out = domain.publicAction(body, reqState, t0 + i);
    reqState = upsertParsed(reqState, out.rateLimitWrite);
  }
  const blocked = request();
  blocked._identity = { uid: 'fresh-req-user', email: 'fresh@example.test' };
  blocked._clientKey = '192.0.2.200';
  blocked.config.date = '2099-11-28';
  assert.throws(
    () => domain.publicAction(blocked, reqState, t0 + 5000),
    (err) => err.status === 429,
  );
});

test('a signed-in user cannot escape the per-client limit by rotating a spoofed forwarded IP', () => {
  const t0 = 1_700_000_000_000;
  let state = rows();
  for (let i = 0; i < domain.RATE_LIMITS.chat.perClient; i++) {
    const out = domain.publicAction(
      {
        action: 'chat',
        _identity: { uid: 'rotating-user' },
        _clientKey: `198.18.0.${i}`,
        message: `Vraag ${i}`,
      },
      state,
      t0 + i,
    );
    state = upsertParsed(state, out.rateLimitWrite);
  }
  assert.throws(
    () =>
      domain.publicAction(
        {
          action: 'chat',
          _identity: { uid: 'rotating-user' },
          _clientKey: '198.18.1.1',
          message: 'Nieuw IP',
        },
        state,
        t0 + 5000,
      ),
    (err) => err.status === 429,
  );

  let reqState = rows();
  for (let i = 0; i < domain.RATE_LIMITS['event-request'].perClient; i++) {
    const body = request();
    body._clientKey = `198.18.2.${i}`;
    body.config.date = `2099-12-${String(10 + i).padStart(2, '0')}`;
    const out = domain.publicAction(body, reqState, t0);
    reqState = upsertParsed(reqState, out.rateLimitWrite);
  }
  const rotated = request();
  rotated._clientKey = '198.18.3.1';
  rotated.config.date = '2099-12-25';
  assert.throws(
    () => domain.publicAction(rotated, reqState, t0 + 10_000),
    (err) => err.status === 429,
  );
});

test('idempotent retry of an existing held event-request returns 200 even when rate limit is full', () => {
  const t0 = 1_700_000_000_000;
  const saved = savedRequest();
  saved.body._clientKey = '203.0.113.55';
  let state = [...saved.rows];
  for (let i = 0; i < domain.RATE_LIMITS['event-request'].perClient; i++) {
    const writeRow = domain.checkRateLimit(state, 'event-request', '203.0.113.55', t0 + i);
    state = upsertParsed(state, writeRow);
  }
  // Confirm new requests from this client are rate-limited with 429
  const fresh = request();
  fresh._clientKey = '203.0.113.55';
  fresh.config.date = '2099-12-20';
  assert.throws(
    () => domain.publicAction(fresh, state, t0 + 500),
    (err) => err.status === 429,
  );
  // Retrying the already-saved requestId returns 200 receipt without hitting Gemini or 429
  const retry = domain.publicAction(saved.body, state, t0 + 500);
  assert.equal(retry.route, 'respond');
  assert.equal(retry.status, 200);
  assert.equal(retry.response.booking.id, saved.body.requestId);
});

test('raw caller IP is SHA-256 hashed, never stored in plain text, and ratelimit rows stay out of admin snapshot', () => {
  const { clientKeyFromHeaders, sha256 } = require('../code/auth-context.cjs');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const rawIp = '203.0.113.77';
  const fromForwarded = clientKeyFromHeaders({ 'X-Forwarded-For': `${rawIp}, 10.0.0.1` });
  const fromCf = clientKeyFromHeaders({ 'cf-connecting-ip': rawIp });
  const fromReal = clientKeyFromHeaders({ 'x-real-ip': rawIp });
  assert.match(fromForwarded, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fromForwarded, fromCf);
  assert.equal(fromForwarded, fromReal);
  assert.ok(!fromForwarded.includes(rawIp));

  const out = domain.publicAction(
    {
      action: 'chat',
      _identity: { uid: 'privacy-user' },
      _clientKey: rawIp,
      message: 'Test privacy',
    },
    rows(),
    1_700_000_000_000,
  );
  assert.ok(!out.rateLimitWrite.payload.includes(rawIp));
  const keys = Object.keys(JSON.parse(out.rateLimitWrite.payload).data.clients);
  // One key for the Firebase uid, one for the caller IP; both hashed.
  assert.equal(keys.length, 2);
  for (const key of keys) assert.match(key, /^sha256:[0-9a-f]{64}$/);
  assert.ok(!out.rateLimitWrite.payload.includes('privacy-user'));

  const stateWithRateLimit = upsertParsed(rows(), out.rateLimitWrite);
  const snap = domain.adminAction({ action: 'snapshot' }, stateWithRateLimit).response;
  assert.ok(!JSON.stringify(snap).includes('ratelimit'));
  assert.equal(snap.bookings.length, 0);
  assert.equal(snap.logs.length, 0);
});

test('Workflow B enforces Firebase auth on chat and upserts rate-limit row before Gemini', () => {
  const wf = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../workflows/B-public-api-and-proposals.json'), 'utf8'),
  );
  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const next = (from, index = 0) =>
    (wf.connections[from]?.main[index] ?? []).map((edge) => edge.node);

  // Verify rate-limit Data Table upsert sits on the Needs Gemini -> Gemini path
  assert.deepEqual(next('Needs Gemini', 0), ['Rate limit payload']);
  assert.deepEqual(next('Rate limit payload'), ['Record rate limit']);
  assert.equal(byName['Record rate limit'].type, 'n8n-nodes-base.dataTable');
  assert.equal(byName['Record rate limit'].parameters.operation, 'upsert');
  assert.deepEqual(next('Record rate limit'), ['After rate limit']);
  assert.deepEqual(next('After rate limit'), ['Rate limit recorded']);
  assert.deepEqual(next('Rate limit recorded', 0), ['Gemini']);
  assert.deepEqual(next('Rate limit recorded', 1), ['Result']);

  // Execute Access node inside restricted VM context without require()
  const runAccess = (action, headers = {}) => {
    const fn = vm.runInNewContext(`(function($input){${byName['Access'].parameters.jsCode}\n})`);
    return fn({ first: () => ({ json: { headers, body: { action } } }) })[0].json;
  };
  assert.equal(runAccess('catalogue').route, 'public');
  assert.equal(runAccess('chat', { 'x-forwarded-for': '198.51.100.42' }).route, 'verify');
  assert.equal(runAccess('event-request', { 'x-forwarded-for': '198.51.100.42' }).route, 'verify');
  assert.equal(runAccess('my-requests').route, 'verify');
  const accessOut = runAccess('chat', { 'x-forwarded-for': '198.51.100.42, 10.0.0.5' });
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
  assert.equal(loseB.deleteRowId, 52);
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
