const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, normalizePhone, prepareContacts } = require('../src/services/csvService');

test('parses semicolon CSV with quoted fields and detects the phone column', () => {
  const parsed = parseCsv(Buffer.from('\uFEFFtelefono;nome;nota\r\n+393331234567;Mario;"Roma; centro"\r\n'));
  assert.equal(parsed.delimiter, ';');
  assert.equal(parsed.suggestedPhoneColumn, 'telefono');
  assert.equal(parsed.rows[0].data.nota, 'Roma; centro');
});

test('normalizes common international phone formats', () => {
  assert.equal(normalizePhone('whatsapp:+39 333-123-4567'), '+393331234567');
  assert.equal(normalizePhone('00393331234567'), '+393331234567');
  assert.equal(normalizePhone('393331234567'), '+393331234567');
  assert.equal(normalizePhone('333123'), null);
});

test('removes duplicates, reports invalid rows and maps template variables', () => {
  const parsed = parseCsv('phone,nome,citta\n+393331111111,Mario,Roma\ninvalid,No,Nowhere\n+393331111111,Mario bis,Roma\n+393332222222,Giulia,Milano\n');
  const result = prepareContacts(parsed, 'phone', { 1: 'nome', 2: 'citta' });
  assert.equal(result.contacts.length, 2);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.duplicates.length, 1);
  assert.deepEqual(result.contacts[1].variables, { 1: 'Giulia', 2: 'Milano' });
});
