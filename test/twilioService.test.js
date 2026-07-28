const test = require('node:test');
const assert = require('node:assert/strict');

test('resolves missing WhatsApp approval statuses from the template endpoint', async (t) => {
  const contents = [
    {
      sid: 'HX_SUMMARY',
      friendlyName: 'summary',
      language: 'it',
      approvalRequests: { whatsapp: { status: 'Approved', category: 'UTILITY' } },
      types: { 'twilio/text': { body: 'Summary' } },
    },
    {
      sid: 'HX_APPROVED',
      friendlyName: 'approved',
      language: 'it',
      types: { 'twilio/text': { body: 'Approved' } },
    },
    {
      sid: 'HX_NOT_SUBMITTED',
      friendlyName: 'not_submitted',
      language: 'it',
      types: { 'twilio/text': { body: 'Not submitted' } },
    },
  ];
  const fetchedSids = [];
  const fakeClient = {
    content: {
      v1: {
        contentAndApprovals: {
          list: async () => contents,
        },
        contents: (sid) => ({
          approvalFetch: {
            fetch: async () => {
              fetchedSids.push(sid);
              if (sid === 'HX_APPROVED') {
                return { whatsapp: { status: 'Approved', category: 'MARKETING' } };
              }
              const error = new Error('Approval request not found');
              error.status = 404;
              error.code = 20404;
              throw error;
            },
          },
        }),
      },
    },
  };
  const fakeTwilio = () => fakeClient;
  fakeTwilio.validateRequest = () => true;

  const twilioModulePath = require.resolve('twilio');
  const serviceModulePath = require.resolve('../src/services/twilioService');
  const settingsService = require('../src/services/settingsService');
  const originalTwilio = require(twilioModulePath);
  const originalGetTwilioSettings = settingsService.getTwilioSettings;

  require.cache[twilioModulePath].exports = fakeTwilio;
  settingsService.getTwilioSettings = async () => ({
    accountSid: 'AC_TEST',
    authToken: 'test-token',
    apiKeySid: '',
    apiKeySecret: '',
  });
  delete require.cache[serviceModulePath];

  t.after(() => {
    require.cache[twilioModulePath].exports = originalTwilio;
    settingsService.getTwilioSettings = originalGetTwilioSettings;
    delete require.cache[serviceModulePath];
  });

  const twilioService = require('../src/services/twilioService');
  const templates = await twilioService.listTemplates();
  const bySid = Object.fromEntries(templates.map((template) => [template.sid, template]));

  assert.equal(bySid.HX_SUMMARY.status, 'approved');
  assert.equal(bySid.HX_APPROVED.status, 'approved');
  assert.equal(bySid.HX_APPROVED.category, 'MARKETING');
  assert.equal(bySid.HX_NOT_SUBMITTED.status, 'not_submitted');
  assert.deepEqual(fetchedSids.sort(), ['HX_APPROVED', 'HX_NOT_SUBMITTED']);
});
