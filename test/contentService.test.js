const test = require('node:test');
const assert = require('node:assert/strict');
const contentService = require('../src/services/contentService');

test('builds a WhatsApp media template with variable samples', () => {
  const built = contentService.buildTemplatePayload({
    friendlyName: 'documento_cliente',
    language: 'it',
    category: 'UTILITY',
    type: 'media',
    body: 'Ciao {{1}}, trovi il documento richiesto.',
    mediaUrl: 'https://manager.example.com/media/token/documento.pdf',
    variables: { 1: 'Mario' },
  });

  assert.equal(built.payload.friendly_name, 'documento_cliente');
  assert.deepEqual(built.payload.variables, { 1: 'Mario' });
  assert.deepEqual(built.payload.types['twilio/media'].media, [
    'https://manager.example.com/media/token/documento.pdf',
  ]);
});

test('builds CTA actions and preserves variables in public URLs', () => {
  const built = contentService.buildTemplatePayload({
    friendlyName: 'apri_pratica',
    language: 'it',
    category: 'UTILITY',
    type: 'call_to_action',
    body: 'Ciao {{1}}, la tua pratica è pronta.',
    actions: [
      { type: 'URL', title: 'Apri pratica', url: 'https://example.com/pratiche/{{2}}' },
      { type: 'PHONE_NUMBER', title: 'Chiama', phone: '+390212345678' },
    ],
    variables: { 1: 'Mario', 2: 'ABC123' },
  });

  const cta = built.payload.types['twilio/call-to-action'];
  assert.equal(cta.actions[0].url, 'https://example.com/pratiche/{{2}}');
  assert.equal(cta.actions[1].phone, '+390212345678');
});

test('builds an in-session rich card with media and quick reply', () => {
  const built = contentService.buildRichMessagePayload({
    friendlyName: 'operator_123',
    language: 'it',
    body: 'Vuoi procedere?',
    mediaUrl: 'https://manager.example.com/media/token/image.jpg',
    actions: [{ type: 'QUICK_REPLY', title: 'Sì', id: 'si' }],
  });

  assert.equal(built.type, 'card');
  assert.equal(built.payload.types['whatsapp/card'].actions[0].type, 'QUICK_REPLY');
});

test('rejects missing variable samples and non-public URLs', () => {
  assert.throws(() => contentService.buildTemplatePayload({
    friendlyName: 'test_variabile', language: 'it', category: 'UTILITY', type: 'text',
    body: 'Ciao {{1}}, benvenuto.', variables: {},
  }), /esempio.*\{\{1\}\}/i);

  assert.throws(() => contentService.buildTemplatePayload({
    friendlyName: 'test_media', language: 'it', category: 'UTILITY', type: 'media',
    body: 'Documento allegato.', mediaUrl: 'http://localhost/file.pdf', variables: {},
  }), /HTTPS pubblico/i);
});

test('enforces WhatsApp in-session button limits', () => {
  assert.throws(() => contentService.buildRichMessagePayload({
    friendlyName: 'operator_123', language: 'it', body: 'Contattaci',
    actions: [{ type: 'PHONE_NUMBER', title: 'Chiama', phone: '+390212345678' }],
  }), /template approvato/i);

  assert.throws(() => contentService.buildRichMessagePayload({
    friendlyName: 'operator_123', language: 'it', body: 'Scegli',
    actions: [
      { type: 'URL', title: 'Apri', url: 'https://example.com' },
      { type: 'QUICK_REPLY', title: 'No', id: 'no' },
    ],
  }), /stesso tipo/i);
});

test('rejects a WhatsApp card with both media and text header', () => {
  assert.throws(() => contentService.buildTemplatePayload({
    friendlyName: 'card_non_valida', language: 'it', category: 'UTILITY', type: 'card',
    body: 'Aggiornamento', headerText: 'Header',
    mediaUrl: 'https://example.com/image.jpg',
    actions: [{ type: 'QUICK_REPLY', title: 'Va bene', id: 'ok' }], variables: {},
  }), /sia un media sia un header/i);
});
