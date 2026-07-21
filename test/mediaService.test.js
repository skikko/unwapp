const test = require('node:test');
const assert = require('node:assert/strict');
const mediaService = require('../src/services/mediaService');

test('accepts supported WhatsApp documents and sanitizes filenames', () => {
  const result = mediaService.validateMedia({
    buffer: Buffer.from('pdf'),
    mimetype: 'application/pdf',
    size: 3,
  });
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(mediaService.sanitizeFilename('../../contratto\n2026.pdf', 'application/pdf'), 'contratto_2026.pdf');
  assert.equal(mediaService.sanitizeFilename('Presentazione lunghissima è finale.pdf', 'application/pdf'), 'Presentazione_lu.pdf');
});

test('rejects unsupported or oversized media', () => {
  assert.throws(() => mediaService.validateMedia({
    buffer: Buffer.from('x'), mimetype: 'application/x-sh', size: 1,
  }), /non supportato/i);
  assert.throws(() => mediaService.validateMedia({
    buffer: Buffer.alloc(1), mimetype: 'application/pdf', size: mediaService.MAX_MEDIA_BYTES + 1,
  }), /16 MB/i);
  assert.throws(() => mediaService.validateMedia({
    buffer: Buffer.alloc(1), mimetype: 'image/png', size: mediaService.MAX_IMAGE_BYTES + 1,
  }), /5 MB/i);
});
