const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBroadcastFilter } = require('../src/repos/conversationRepo');

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
