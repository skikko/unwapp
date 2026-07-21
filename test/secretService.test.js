const test = require('node:test');
const assert = require('node:assert/strict');
const secretService = require('../src/services/secretService');

test('encrypts and decrypts a BOT API key without storing plaintext', () => {
  const previous = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = 'test-only-encryption-secret-32-characters';
  const encrypted = secretService.encrypt('sk-example-secret');
  assert.notEqual(encrypted, 'sk-example-secret');
  assert.equal(secretService.decrypt(encrypted), 'sk-example-secret');
  if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = previous;
});
