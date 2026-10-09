const test = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('../src/services/emailService');
const crmRepo = require('../src/repos/crmRepo');

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';

function setup(t, contact) {
  const originalSecret = process.env.CRM_TRACKING_SECRET;
  const originalLookup = crmRepo.getRecontactContact;
  const originalRecord = crmRepo.recordEmailEvent;
  const events = [];
  process.env.CRM_TRACKING_SECRET = 'l'.repeat(32);
  crmRepo.getRecontactContact = async () => contact;
  crmRepo.recordEmailEvent = async (input) => {
    events.push(input);
    return { membershipAdded: true };
  };
  t.after(() => {
    crmRepo.getRecontactContact = originalLookup;
    crmRepo.recordEmailEvent = originalRecord;
    if (originalSecret === undefined) delete process.env.CRM_TRACKING_SECRET;
    else process.env.CRM_TRACKING_SECRET = originalSecret;
  });
  return events;
}

test('precompila dal token senza registrare richieste o invii', async (t) => {
  const events = setup(t, {
    first_name: 'Mario', last_name: 'Rossi', email: 'mario@example.com',
    phone: null, template_tags: ['lastcall'],
  });
  const result = await emailService.getRecontactProfile({ token: emailService.recontactToken(JOB_ID) });
  assert.deepEqual(result.contact, { firstName: 'Mario', lastName: 'Rossi', email: 'mario@example.com', phone: '' });
  assert.equal(result.requiresPhone, true);
  assert.equal(result.isLastCall, true);
  assert.equal(events.length, 0);
});

test('Last Call senza telefono non entra in Da Ricontattare', async (t) => {
  const events = setup(t, { email: 'mario@example.com', template_tags: ['lastcall'] });
  const result = await emailService.confirmRecontact({ token: emailService.recontactToken(JOB_ID) });
  assert.equal(result.success, false);
  assert.equal(result.requiresPhone, true);
  assert.equal(events.length, 0);
});

test('salva il telefono e applica LastCall solo alla conferma', async (t) => {
  const events = setup(t, { email: 'mario@example.com', template_tags: ['lastcall'] });
  const result = await emailService.confirmRecontact({
    token: emailService.recontactToken(JOB_ID), phone: '+39 333 123 4567',
  });
  assert.equal(result.success, true);
  assert.equal(events[0].phone, '+393331234567');
  assert.deepEqual(events[0].tags, ['lastcall']);
  assert.equal(events[0].listName, 'Da Ricontattare');
});

test('Last Call con telefono esistente conferma senza riscriverlo', async (t) => {
  const events = setup(t, { email: 'mario@example.com', phone: '+393331234567', template_tags: ['lastcall'] });
  await emailService.confirmRecontact({ token: emailService.recontactToken(JOB_ID) });
  assert.equal(events[0].phone, null);
  assert.deepEqual(events[0].tags, ['lastcall']);
});

test('le richieste degli altri template non ricevono LastCall', async (t) => {
  const events = setup(t, { email: 'mario@example.com', template_tags: ['ricontattami'] });
  await emailService.confirmRecontact({ token: emailService.recontactToken(JOB_ID) });
  assert.deepEqual(events[0].tags, []);
});

test('rifiuta telefoni non validi e token alterati senza registrare richieste', async (t) => {
  const events = setup(t, { email: 'mario@example.com', template_tags: ['lastcall'] });
  const token = emailService.recontactToken(JOB_ID);
  await assert.rejects(emailService.confirmRecontact({ token, phone: '123' }), /Invalid phone/);
  await assert.rejects(emailService.getRecontactProfile({ token: token + '0' }), /Invalid recontact token/);
  assert.equal(events.length, 0);
});

test('il contesto Last Call delle email di test e firmato', async (t) => {
  setup(t, null);
  const url = new URL(emailService.recontactThankYouUrl(null, { email: 'test@example.com', context: 'lastcall' }));
  const token = url.searchParams.get('token');
  const profile = await emailService.getRecontactProfile({ token });
  assert.equal(profile.isLastCall, true);
  const result = await emailService.confirmRecontact({ token });
  assert.equal(result.requiresPhone, true);
  const [payload, signature] = token.split('.');
  const changed = JSON.parse(Buffer.from(payload, 'base64url').toString());
  delete changed.context;
  const forged = Buffer.from(JSON.stringify(changed)).toString('base64url') + '.' + signature;
  await assert.rejects(emailService.getRecontactProfile({ token: forged }), /Invalid recontact token/);
});
