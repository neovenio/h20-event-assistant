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
const seedRows = () => [
  domain.row('room', room.id, room),
  domain.row('room', 'lounge', { ...room, id: 'lounge', name: 'Lounge' }),
  domain.row('activity', 'gaming', { id: 'gaming', name: 'Gaming', isActive: true, price: null }),
  domain.row('catering', 'lunch', {
    id: 'lunch',
    name: 'Lunch',
    isActive: true,
    pricePerPerson: null,
  }),
];
const rows = () => domain.parseRows(seedRows().map((r, i) => ({ ...r, id: i + 1 })));
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
/** In-memory stand-in for the n8n Data Table: system `id`/`createdAt` columns, insert never dedupes. */
function dataTable(seed = []) {
  const stored = [];
  let nextId = 1;
  const table = {
    insert(write) {
      const created = { ...write, id: nextId++, createdAt: new Date().toISOString() };
      stored.push(created);
      return { ...created };
    },
    upsert(write) {
      const found = stored.filter((r) => r.recordId === write.recordId);
      if (!found.length) return table.insert(write);
      for (const r of found) Object.assign(r, write);
      return { ...found[0] };
    },
    remove(id) {
      const index = stored.findIndex((r) => r.id === id);
      if (index >= 0) stored.splice(index, 1);
    },
    read: () => stored.map((r) => ({ ...r })),
    parsed: () => domain.parseRows(table.read()),
  };
  for (const item of seed) table.insert(item);
  return table;
}
/** Steps 1 and 2 of the claim protocol: validate, then insert the claim row. */
function begin(body, table, snapshot = table.parsed()) {
  // `snapshot` is what the request read BEFORE any competing claim was inserted.
  const context = domain.publicAction(body, snapshot);
  assert.equal(context.route, 'claim');
  return { context, inserted: table.insert(context.write) };
}
/** Step 3: re-read the table and resolve the claim against the snapshot. */
function settle(started, table) {
  return domain.settleClaim(started.context, started.inserted.id, table.parsed());
}
function blockInput(change = {}) {
  return {
    action: 'add-block',
    block: {
      roomId: room.id,
      date: '2099-12-15',
      startTime: '12:00',
      endTime: '13:00',
      reason: 'Maintenance',
      ...change,
    },
  };
}
function beginBlock(input, table, snapshot = table.parsed()) {
  const context = domain.adminAction(input, snapshot);
  assert.equal(context.route, 'claim');
  return { context, inserted: table.insert(context.write) };
}
/** Whole happy path for one request, as the workflow would run it. */
function savedRequest() {
  const body = request();
  const table = dataTable(seedRows());
  const context = settle(begin(body, table), table);
  assert.equal(context.route, 'gemini');
  const result = domain.finishGemini(context, generated(context));
  table.upsert(result.write);
  return { body, context, result, table, rows: table.parsed() };
}
test('catalogue never returns customers or capability tokens', () => {
  const s = savedRequest();
  const result = domain.publicAction({ action: 'catalogue' }, s.rows);
  assert.equal(result.response.rooms.length, 2);
  assert.ok(!JSON.stringify(result).includes(s.body.customerToken));
  assert.ok(!JSON.stringify(result).includes('customer@example.test'));
});
test('request validates and calculates prices on server, ignoring client totals', () => {
  const body = request();
  body.config.selectedAddons = [{ id: 'forged', price: -10000 }];
  assert.throws(() => domain.publicAction(body, rows()), /upgrade/);
  body.config.selectedAddons = [];
  const context = domain.publicAction(body, rows()).next;
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
test('invalid AI output and invented rooms keep the hold as a failed-AI booking', () => {
  const context = domain.publicAction(request(), rows()).next;
  const bad = generated(context);
  bad.candidates[0].content.parts[0].text = bad.candidates[0].content.parts[0].text.replace(
    'Stadium',
    'Invented venue',
  );
  for (const result of [{ candidates: [] }, { error: 'timeout' }, bad]) {
    const saved = domain.finishGemini(context, result);
    assert.equal(saved.route, 'save');
    assert.equal(saved.status, 201);
    const data = JSON.parse(saved.write.payload).data;
    assert.equal(data.claimStatus, 'held');
    assert.equal(data.aiStatus, 'failed');
    assert.equal(data.explanation, undefined);
    assert.equal(data.planning, undefined);
  }
  assert.throws(() => domain.finishGemini({ chat: true }, { candidates: [] }), /AI/);
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
  const context = domain.publicAction(a, rows()).next;
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

// ---- Slot claims (#14): reserve first, verify after, lowest row id wins ----
function overlappingRequest(change = {}) {
  const body = request();
  Object.assign(body.config, change);
  return body;
}
/** Both requests passed the pre-check and inserted before either re-read: the interleaving to defend. */
function race(bodyA, bodyB) {
  const table = dataTable(seedRows());
  const snapshot = table.parsed();
  const a = begin(bodyA, table, snapshot);
  const b = begin(bodyB, table, snapshot);
  return { table, a, b };
}
const won = (result) => result.route !== 'release';
function savedRequestIn(table, body) {
  const context = settle(begin(body, table), table);
  const saved = domain.finishGemini(context, generated(context));
  return table.upsert(saved.write);
}
test('two overlapping requests: exactly one wins, the lower row id, in any evaluation order', () => {
  const { table, a, b } = race(overlappingRequest(), overlappingRequest({ startTime: '12:00' }));
  assert.ok(a.inserted.id < b.inserted.id);
  for (const order of [
    [a, b],
    [b, a],
  ]) {
    const outcomes = new Map(order.map((s) => [s, settle(s, table)]));
    assert.equal(won(outcomes.get(a)), true);
    assert.equal(outcomes.get(a).route, 'gemini');
    const lost = outcomes.get(b);
    assert.equal(lost.route, 'release');
    assert.equal(lost.releaseId, b.inserted.id);
    assert.equal(lost.status, 409);
    assert.match(lost.response.error, /overlapt/);
  }
});
test('the claim is inserted as claiming and the winner continues with a claiming booking', () => {
  const table = dataTable(seedRows());
  const started = begin(overlappingRequest(), table);
  assert.equal(JSON.parse(started.context.write.payload).data.claimStatus, 'claiming');
  const next = settle(started, table);
  assert.equal(next.booking.claimStatus, 'claiming');
  const saved = domain.finishGemini(next, generated(next));
  const data = JSON.parse(saved.write.payload).data;
  assert.equal(data.claimStatus, 'held');
  assert.equal(data.aiStatus, 'ok');
  assert.equal(saved.write.recordId, started.context.write.recordId);
});
test('non-overlapping requests both win (other room, adjacent times)', () => {
  for (const change of [{ selectedRoomId: 'lounge' }, { startTime: '16:00', endTime: '18:00' }]) {
    const { table, a, b } = race(overlappingRequest(), overlappingRequest(change));
    assert.equal(won(settle(a, table)), true);
    assert.equal(won(settle(b, table)), true);
  }
});
test('multi-room: a claim overlapping on an additional room loses to the earlier claim', () => {
  const later = overlappingRequest({
    selectedRoomId: 'lounge',
    additionalRooms: [{ id: room.id }],
  });
  const { table, a, b } = race(overlappingRequest(), later);
  assert.equal(won(settle(a, table)), true);
  assert.equal(settle(b, table).route, 'release');
  // and the other way round: the additional-room claim is first
  const reverse = race(later, overlappingRequest());
  assert.equal(won(settle(reverse.a, reverse.table)), true);
  assert.equal(settle(reverse.b, reverse.table).route, 'release');
});
test('a block racing a request: the lower id wins in both directions', () => {
  for (const blockFirst of [true, false]) {
    const table = dataTable(seedRows());
    const snapshot = table.parsed();
    const startRequest = () => begin(overlappingRequest(), table, snapshot);
    const startBlock = () => beginBlock(blockInput(), table, snapshot);
    const [first, second] = blockFirst
      ? [startBlock(), startRequest()]
      : [startRequest(), startBlock()];
    const [blockClaim, requestClaim] = blockFirst ? [first, second] : [second, first];
    const blockResult = settle(blockClaim, table);
    const requestResult = settle(requestClaim, table);
    if (blockFirst) {
      assert.equal(blockResult.route, 'save');
      assert.equal(blockResult.status, 201);
      assert.equal(JSON.parse(blockResult.write.payload).data.claimStatus, 'held');
      assert.equal(requestResult.route, 'release');
    } else {
      assert.equal(requestResult.route, 'gemini');
      assert.equal(blockResult.route, 'release');
      assert.equal(blockResult.status, 409);
      assert.match(blockResult.response.error, /Blokkade overlapt/);
    }
  }
});
test('inactive bookings never cause a loss', () => {
  const source = dataTable(seedRows());
  const old = savedRequestIn(source, overlappingRequest());
  for (const [bookingStatus, requestStatus] of [
    ['Cancelled', 'pending_review'],
    ['Refunded', 'pending_review'],
    ['Draft', 'pending_review'],
    ['Awaiting Approval', 'rejected'],
  ]) {
    const stored = JSON.parse(old.payload);
    stored.data.reservation.bookingStatus = bookingStatus;
    stored.data.requestStatus = requestStatus;
    // The inactive row has the LOWER id; a later overlapping claim must still win.
    const table = dataTable(seedRows());
    table.insert({ ...old, payload: JSON.stringify(stored) });
    const claim = { roomIds: [room.id], date: '2099-12-15', startTime: '10:00', endTime: '16:00' };
    const inserted = table.insert(domain.row('block', 'x', { id: 'x', roomId: 'lounge' }));
    assert.equal(
      domain.resolveClaim(table.parsed(), { ...claim, rowId: inserted.id }).won,
      true,
      `${bookingStatus}/${requestStatus}`,
    );
  }
});
test('a Gemini failure after a win saves a held booking with aiStatus failed and a normal receipt', () => {
  const table = dataTable(seedRows());
  const body = overlappingRequest();
  const context = settle(begin(body, table), table);
  const result = domain.finishGemini(context, { error: { message: 'Gemini unavailable' } });
  assert.equal(result.route, 'save');
  assert.equal(result.status, 201);
  const data = JSON.parse(result.write.payload).data;
  assert.equal(data.claimStatus, 'held');
  assert.equal(data.aiStatus, 'failed');
  assert.equal(data.requestStatus, 'pending_review');
  assert.equal(result.response.booking.id, body.requestId);
  assert.equal(result.response.booking.aiStatus, undefined);
  assert.equal(result.response.booking.claimStatus, undefined);
  table.upsert(result.write);
  // staff can add the explanation through the existing review action, which clears the indicator
  const reviewed = domain.adminAction(
    { action: 'review', id: body.requestId, explanation: 'Handmatige uitleg' },
    table.parsed(),
  );
  assert.equal(reviewed.response.booking.aiStatus, 'ok');
});
test('staff cannot approve a booking without explanation or with an unverified claim', () => {
  const table = dataTable(seedRows());
  const body = overlappingRequest();
  const approve = () =>
    domain.adminAction(
      { action: 'booking-status', id: body.requestId, actionType: 'approve' },
      table.parsed(),
    );
  const started = begin(body, table);
  assert.throws(approve, /onvolledig/i);
  const context = settle(started, table);
  table.upsert(domain.finishGemini(context, { candidates: [] }).write);
  assert.throws(approve, /uitleg/);
  // rejecting an incomplete claim stays possible
  const rejected = domain.adminAction(
    { action: 'booking-status', id: body.requestId, actionType: 'reject' },
    table.parsed(),
  );
  assert.equal(rejected.response.booking.requestStatus, 'rejected');
});
test('retry finding a claiming row re-verifies: it can win and proceed', () => {
  const table = dataTable(seedRows());
  const body = overlappingRequest();
  begin(body, table); // first attempt crashed after the insert
  const retry = domain.publicAction(body, table.parsed());
  assert.equal(retry.route, 'gemini');
  assert.equal(retry.booking.id, body.requestId);
  assert.equal(retry.booking.claimStatus, 'claiming');
  assert.equal(retry.status, 201);
  const saved = domain.finishGemini(retry, generated(retry));
  assert.equal(JSON.parse(saved.write.payload).data.claimStatus, 'held');
});
test('retry finding a claiming row that lost deletes the row and returns 409', () => {
  const table = dataTable(seedRows());
  const first = overlappingRequest();
  const second = overlappingRequest({ startTime: '11:00' });
  const snapshot = table.parsed();
  const a = begin(first, table, snapshot);
  const b = begin(second, table, snapshot);
  assert.ok(a.inserted.id < b.inserted.id);
  const retry = domain.publicAction(second, table.parsed());
  assert.equal(retry.route, 'release');
  assert.equal(retry.releaseId, b.inserted.id);
  assert.equal(retry.status, 409);
  assert.match(retry.response.error, /overlapt/);
  // the first claimant's own retry still wins
  assert.equal(domain.publicAction(first, table.parsed()).route, 'gemini');
});
test('retry finding a held row returns the receipt without another AI call', () => {
  const s = savedRequest();
  const repeat = domain.publicAction(s.body, s.rows);
  assert.equal(repeat.route, 'respond');
  assert.equal(repeat.response.booking.id, s.body.requestId);
  assert.equal(repeat.response.booking.claimStatus, undefined);
});
test('retry with a different identity or token cannot touch a claiming row', () => {
  const table = dataTable(seedRows());
  const body = overlappingRequest();
  begin(body, table);
  assert.throws(
    () => domain.publicAction({ ...body, _identity: { uid: 'other' } }, table.parsed()),
    /Ongeldige/,
  );
  assert.throws(
    () =>
      domain.publicAction({ ...body, customerToken: randomUUID() + randomUUID() }, table.parsed()),
    /Ongeldige/,
  );
});
test('legacy rows without claimStatus/aiStatus behave as held/ok', () => {
  const s = savedRequest();
  const stored = JSON.parse(s.table.read().find((r) => r.kind === 'booking').payload);
  delete stored.data.claimStatus;
  delete stored.data.aiStatus;
  const legacy = dataTable(seedRows());
  legacy.insert({
    recordId: `booking:${s.body.requestId}`,
    kind: 'booking',
    payload: JSON.stringify(stored),
  });
  // a retry returns the receipt instead of re-verifying
  assert.equal(domain.publicAction(s.body, legacy.parsed()).route, 'respond');
  // it still blocks an overlapping new request
  assert.throws(() => domain.publicAction(overlappingRequest(), legacy.parsed()), /overlapt/);
  assert.equal(domain.claimStatusOf(stored.data), 'held');
  assert.equal(domain.aiStatusOf(stored.data), 'ok');
});
test('resolveClaim is pure: lowest row id among overlapping active claims wins', () => {
  const claim = { roomIds: [room.id], date: '2099-12-15', startTime: '10:00', endTime: '12:00' };
  const snapshot = (...ids) =>
    domain.parseRows(
      ids.map((id) => ({
        ...domain.row('block', `b${id}`, {
          id: `b${id}`,
          roomId: room.id,
          date: '2099-12-15',
          startTime: '11:00',
          endTime: '13:00',
        }),
        id,
      })),
    );
  assert.deepEqual(domain.resolveClaim(snapshot(2, 7), { ...claim, rowId: 5 }), {
    won: false,
    winnerId: 2,
  });
  assert.deepEqual(domain.resolveClaim(snapshot(7), { ...claim, rowId: 5 }), {
    won: true,
    winnerId: 5,
  });
  assert.deepEqual(domain.resolveClaim([], { ...claim, rowId: 5 }), { won: true, winnerId: 5 });
});
test('workflows B and C wire claim insert, re-read, resolve and delete-on-loss', () => {
  for (const [file, gemini] of [
    ['B-public-api-and-proposals.json', true],
    ['C-employee-api.json', false],
  ]) {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '../workflows', file), 'utf8'));
    const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
    const next = (from, index = 0) =>
      (wf.connections[from]?.main[index] ?? []).map((edge) => edge.node);
    assert.equal(byName['Claim insert'].parameters.operation, 'insert');
    assert.equal(byName['Read after claim'].parameters.operation, 'get');
    assert.equal(byName['Read after claim'].parameters.returnAll, true);
    assert.match(byName['Resolve claim'].parameters.jsCode, /settleClaim/);
    assert.equal(byName['Release claim'].parameters.operation, 'deleteRows');
    assert.equal(byName['Release claim'].parameters.filters.conditions[0].keyName, 'id');
    assert.deepEqual(next('Route request'), ['Needs claim']);
    assert.deepEqual(next('Needs claim', 0), ['Claim insert']);
    assert.deepEqual(next('Claim insert'), ['Read after claim']);
    assert.deepEqual(next('Read after claim'), ['Resolve claim']);
    assert.deepEqual(next('Resolve claim'), ['Request context']);
    assert.deepEqual(next('Needs claim', 1), ['Request context']);
    assert.deepEqual(next('Request context'), [gemini ? 'Needs Gemini' : 'Result']);
    assert.deepEqual(next('Needs release', 0), ['Release claim']);
    assert.deepEqual(next('Needs release', 1), ['Respond']);
    assert.deepEqual(next('Release claim'), ['After release']);
    assert.deepEqual(next('After release'), ['Respond']);
    if (gemini) assert.deepEqual(next('Needs Gemini', 0), ['Gemini']);
  }
});
