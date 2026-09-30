const test = require('node:test');
const assert = require('node:assert/strict');
const crmIngestService = require('../src/services/crmIngestService');

test('canonicalizza il payload indipendentemente dall’ordine delle proprietà', () => {
  const first = crmIngestService.canonicalJson({ source: 'wordpress', contact: { email: 'a@example.com', name: 'A' } });
  const second = crmIngestService.canonicalJson({ contact: { name: 'A', email: 'a@example.com' }, source: 'wordpress' });
  assert.equal(first, second);
});
