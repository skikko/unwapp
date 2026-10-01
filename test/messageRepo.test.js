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
