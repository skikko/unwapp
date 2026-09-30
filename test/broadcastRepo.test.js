const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/config/db');
const broadcastRepo = require('../src/repos/broadcastRepo');

test('claims a pending broadcast recipient atomically', async (t) => {
  const originalQuery = db.query;
  let captured;
  t.after(() => { db.query = originalQuery; });

  db.query = async (text, params) => {
    captured = { text, params };
    return { rows: [{ id: 'recipient-1', status: 'processing', claim_token: 'claim-1' }] };
  };

  const recipient = await broadcastRepo.claimNextRecipient('campaign-1');

  assert.equal(recipient.status, 'processing');
  assert.match(captured.text, /FOR UPDATE SKIP LOCKED/);
  assert.match(captured.text, /SET status = 'processing'/);
  assert.deepEqual(captured.params, ['campaign-1']);
});
