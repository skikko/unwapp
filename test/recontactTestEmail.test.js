const test = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('../src/services/emailService');
const crmRepo = require('../src/repos/crmRepo');

test('la mail di test genera un link Ricontattami con token email valido', async (t) => {
  const previousTrackingSecret = process.env.CRM_TRACKING_SECRET;
  process.env.CRM_TRACKING_SECRET = 'r'.repeat(32);
  const originalRecordEmailTestRecontact = crmRepo.recordEmailTestRecontact;
  const originalGetRecontactContact = crmRepo.getRecontactContact;
  crmRepo.getRecontactContact = async () => null;
  let recorded;
  crmRepo.recordEmailTestRecontact = async (input) => {
    recorded = input;
    return { contactId: 'contact-1', membershipAdded: true };
  };
  t.after(() => {
    crmRepo.recordEmailTestRecontact = originalRecordEmailTestRecontact;
    crmRepo.getRecontactContact = originalGetRecontactContact;
    if (previousTrackingSecret === undefined) delete process.env.CRM_TRACKING_SECRET;
    else process.env.CRM_TRACKING_SECRET = previousTrackingSecret;
  });

  const url = new URL(emailService.recontactThankYouUrl(null, { email: 'Test@Example.com' }));
  const result = await emailService.confirmRecontact({
    token: url.searchParams.get('token'),
  });

  assert.equal(`${url.origin}${url.pathname}`, 'https://www.unitednetwork.it/grazie-ricontatto/');
  assert.equal(result.membershipAdded, true);
  assert.equal(recorded.email, 'test@example.com');
  assert.equal(recorded.listName, 'Da Ricontattare');
});
