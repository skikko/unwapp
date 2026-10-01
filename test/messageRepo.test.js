const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/config/db');
const messageRepo = require('../src/repos/messageRepo');

test('un messaggio in entrata incrementa i non letti e riapre una chat archiviata', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: 'message-1', content: values[2] }] };
  };
  t.after(() => { db.query = originalQuery; });

  await messageRepo.add('conversation-1', 'user', 'Nuovo messaggio', 'SM123');

  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /unread_count \+ 1/);
  assert.match(calls[1].sql, /archived_at=CASE WHEN \$2='user' THEN NULL/);
  assert.deepEqual(calls[1].values, ['conversation-1', 'user']);
});

test('salva stato ed errore di consegna Twilio sul messaggio', async (t) => {
  const originalQuery = db.query;
  let call;
  db.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [{ id: 'message-1', provider_status: values[1] }] };
  };
  t.after(() => { db.query = originalQuery; });

  const updated = await messageRepo.updateDeliveryStatus('SM123', 'undelivered', '63016', 'Window closed');

  assert.equal(updated.provider_status, 'undelivered');
  assert.match(call.sql, /provider_error_code=COALESCE\(\$3,provider_error_code\)/);
  assert.deepEqual(call.values, ['SM123', 'undelivered', '63016', 'Window closed']);
});

test('verifica la finestra WhatsApp usando un messaggio ricevuto nelle ultime 24 ore', async (t) => {
  const originalQuery = db.query;
  db.query = async () => ({ rows: [{ is_open: true }] });
  t.after(() => { db.query = originalQuery; });

  assert.equal(await messageRepo.isCustomerServiceWindowOpen('conversation-1'), true);
});
