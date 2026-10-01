const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const conversationRepo = require('../src/repos/conversationRepo');
const { parseBroadcastFilter } = conversationRepo;

test('parseBroadcastFilter accetta un Content SID Twilio', () => {
  const sid = `HX${'a'.repeat(32)}`;
  assert.deepEqual(parseBroadcastFilter(`template:${sid}`), { type: 'template', value: sid });
});

test('parseBroadcastFilter accetta una campagna UUID', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(parseBroadcastFilter(`campaign:${id}`), { type: 'campaign', value: id });
});

test('parseBroadcastFilter ignora filtri non validi', () => {
  assert.deepEqual(parseBroadcastFilter('template:non-valido'), { type: '', value: '' });
  assert.deepEqual(parseBroadcastFilter('campaign:non-valida'), { type: '', value: '' });
  assert.deepEqual(parseBroadcastFilter(''), { type: '', value: '' });
});

test('aggiorna in modo persistente archivio e stato non letto', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: 'conv-1', archived_at: values[1] ? new Date() : null, unread_count: 1 }] };
  };
  t.after(() => { db.query = originalQuery; });

  await conversationRepo.setArchived('conv-1', true);
  await conversationRepo.setUnread('conv-1', true);

  assert.match(calls[0].sql, /archived_at=CASE/);
  assert.deepEqual(calls[0].values, ['conv-1', true]);
  assert.match(calls[1].sql, /GREATEST\(unread_count,1\)/);
  assert.deepEqual(calls[1].values, ['conv-1', true]);
});

test('separa le conversazioni attive da quelle archiviate', async (t) => {
  const originalQuery = db.query;
  let queryCall;
  db.query = async (sql, values) => {
    queryCall = { sql, values };
    return { rows: [] };
  };
  t.after(() => { db.query = originalQuery; });

  await conversationRepo.listByBot('bot-1', { archived: true });

  assert.match(queryCall.sql, /c\.archived_at IS NOT NULL/);
  assert.equal(queryCall.values[5], true);
});
