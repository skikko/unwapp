const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const settingsRepo = require('../src/repos/settingsRepo');

test('riutilizza una sola connessione SMTP limitata per invii consecutivi', async (t) => {
  const originalCreateTransport = nodemailer.createTransport;
  const originalGetMany = settingsRepo.getMany;
  const originalEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USERNAME: process.env.SMTP_USERNAME,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    EMAIL_SMTP_RATE_LIMIT: process.env.EMAIL_SMTP_RATE_LIMIT,
    EMAIL_SMTP_RATE_DELTA_MS: process.env.EMAIL_SMTP_RATE_DELTA_MS,
  };
  const transports = [];
  const sendTimes = [];
  nodemailer.createTransport = (options) => {
    const transport = {
      options,
      closed: false,
      async sendMail() {
        sendTimes.push(Date.now());
        return { messageId: 'message-1' };
      },
      close() { this.closed = true; },
    };
    transports.push(transport);
    return transport;
  };
  settingsRepo.getMany = async () => ({});
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USERNAME: 'sender@example.com',
    SMTP_PASSWORD: 'secret',
    SMTP_FROM_EMAIL: 'sender@example.com',
    EMAIL_SMTP_RATE_LIMIT: '2',
    EMAIL_SMTP_RATE_DELTA_MS: '1000',
  });
  delete require.cache[require.resolve('../src/services/emailService')];
  const emailService = require('../src/services/emailService');
  t.after(async () => {
    await emailService.stopWorker();
    nodemailer.createTransport = originalCreateTransport;
    settingsRepo.getMany = originalGetMany;
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    delete require.cache[require.resolve('../src/services/emailService')];
  });

  await emailService.sendAutomationNotification({
    to_email: 'one@example.com', subject: 'Test 1', body: 'Messaggio 1',
  });
  await emailService.sendAutomationNotification({
    to_email: 'two@example.com', subject: 'Test 2', body: 'Messaggio 2',
  });
  await emailService.sendAutomationNotification({
    to_email: 'three@example.com', subject: 'Test 3', body: 'Messaggio 3',
  });

  assert.equal(transports.length, 1);
  assert.equal(transports[0].options.pool, true);
  assert.equal(transports[0].options.maxConnections, 1);
  assert.equal(transports[0].options.maxMessages, 100);
  assert.equal(sendTimes.length, 3);
  assert.ok(sendTimes[1] - sendTimes[0] >= 450);
  assert.ok(sendTimes[2] - sendTimes[1] >= 450);
  await emailService.stopWorker();
  assert.equal(transports[0].closed, true);
});
