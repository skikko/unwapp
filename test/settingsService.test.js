const test = require('node:test');
const assert = require('node:assert/strict');
const settingsService = require('../src/services/settingsService');

const valid = {
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'auth-token',
  apiKeySid: '',
  apiKeySecret: '',
  publicBaseUrl: '',
};

test('accetta le credenziali Twilio minime', () => {
  const result = settingsService.validateInput({}, valid);
  assert.deepEqual(result.errors, []);
});

test('API Key SID e Secret devono essere presenti insieme', () => {
  const result = settingsService.validateInput({ apiKeySid: `SK${'b'.repeat(32)}` }, valid);
  assert.match(result.errors.join(' '), /insieme/);
});

test('rifiuta URL pubblici non HTTPS fuori da localhost', () => {
  const result = settingsService.validateInput({ publicBaseUrl: 'http://example.com' }, valid);
  assert.match(result.errors.join(' '), /HTTPS/);
});
