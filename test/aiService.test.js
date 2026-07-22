const test = require('node:test');
const assert = require('node:assert/strict');

const aiService = require('../src/services/aiService');

test('requires both a saved key and the AI toggle to enable automatic replies', () => {
  assert.equal(aiService.isConfigured({ ai_api_key_encrypted: 'encrypted', ai_enabled: true }), true);
  assert.equal(aiService.isConfigured({ ai_api_key_encrypted: 'encrypted', ai_enabled: false }), false);
  assert.equal(aiService.isConfigured({ ai_api_key_encrypted: null, ai_enabled: true }), false);
});
