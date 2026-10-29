const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const crmRepo = require('../src/repos/crmRepo');

test('serializza e distanzia globalmente la prenotazione dei job email', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM crm_email_jobs j')) {
        return { rows: [{ id: 'job-1', attempts: 0, campaign_id: null }] };
      }
      if (sql.includes("SET status='sending'")) {
        return { rows: [{ claim_token: 'claim-1', claimed_at: new Date() }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const job = await crmRepo.claimDueJob();

  assert.equal(job.id, 'job-1');
  assert.equal(job.claim_token, 'claim-1');
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  const throttle = calls.find((call) => call.sql.includes('scheduled_at=GREATEST'));
  assert.ok(throttle);
  assert.deepEqual(throttle.values, [6000]);
  assert.ok(calls.indexOf(throttle) < calls.findIndex((call) => call.sql === 'COMMIT'));
});

test('duplica un template mantenendo contenuto e allegati', async (t) => {
  const originalQuery = db.query;
  let queryCall;
  db.query = async (sql, values) => {
    queryCall = { sql, values };
    return { rows: [{ id: 'copy-1', name: 'Newsletter - copia' }] };
  };
  t.after(() => { db.query = originalQuery; });

  const copy = await crmRepo.duplicateTemplate('template-1', 'admin');

  assert.equal(copy.id, 'copy-1');
  assert.match(queryCall.sql, /name \|\| ' - copia'/);
  assert.match(queryCall.sql, /attachments/);
  assert.match(queryCall.sql, /folder_id/);
  assert.deepEqual(queryCall.values, ['template-1', 'admin']);
});

test('blocca il salvataggio di una versione obsoleta del template', async (t) => {
  const originalQuery = db.query;
  db.query = async (sql) => {
    if (sql.includes('FROM crm_content_folders')) return { rows: [] };
    if (sql.includes('SELECT 1 FROM crm_email_templates WHERE slug=')) return { rows: [] };
    if (sql.includes('UPDATE crm_email_templates SET')) return { rows: [] };
    if (sql.includes('SELECT version,updated_at,updated_by')) {
      return { rows: [{ version: 4, updated_at: '2026-10-06T10:00:00.000Z', updated_by: 'editor@example.com' }] };
    }
    return { rows: [] };
  };
  t.after(() => { db.query = originalQuery; });

  await assert.rejects(() => crmRepo.updateTemplate('template-1', {
    name: 'Newsletter',
    slug: 'newsletter',
    templateType: 'marketing',
    editorMode: 'visual',
    status: 'published',
    subject: 'Aggiornamento',
    preheader: null,
    htmlBody: '<p>Ciao</p>',
    textBody: 'Ciao',
    builderModel: null,
    description: null,
    tags: [],
    attachments: [],
    folderId: null,
    updatedBy: 'admin',
    version: 3,
  }), (error) => error.status === 409 && error.message === 'Template version conflict');
});

test('duplica una sequenza disattivata senza copiare le iscrizioni', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT * FROM crm_sequences')) return { rows: [{ id: 'sequence-1' }] };
      if (sql.includes('INSERT INTO crm_sequences')) {
        return { rows: [{ id: 'sequence-copy', trigger_list_id: 'list-1', active: false }] };
      }
      if (sql.startsWith('SELECT * FROM crm_lists')) return { rows: [{ id: 'list-1' }] };
      return { rows: [] };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const copy = await crmRepo.duplicateSequence('sequence-1', 'admin');

  assert.equal(copy.id, 'sequence-copy');
  const sequenceInsert = calls.find((call) => call.sql.includes('INSERT INTO crm_sequences'));
  const stepsInsert = calls.find((call) => call.sql.includes('INSERT INTO crm_sequence_steps'));
  assert.match(sequenceInsert.sql, /description,FALSE,trigger_type/);
  assert.match(sequenceInsert.sql, /folder_id/);
  assert.deepEqual(sequenceInsert.values, ['sequence-1', 'admin']);
  assert.deepEqual(stepsInsert.values, ['sequence-1', 'sequence-copy']);
  assert.equal(calls.some((call) => call.sql.includes('crm_sequence_enrollments')), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('lista sequenze senza duplicare gli step per iscrizione', async (t) => {
  const originalQuery = db.query;
  let capturedSql = '';
  db.query = async (sql) => {
    capturedSql = sql;
    return {
      rows: [{
        id: 'sequence-1',
        steps: [{ id: 'step-1', position: 0, templateName: 'Template 1' }],
        enrollment_count: 21,
        active_count: 5,
        completed_count: 16,
        failed_count: 0,
      }],
    };
  };
  t.after(() => { db.query = originalQuery; });

  const sequences = await crmRepo.listSequences();

  assert.equal(sequences[0].steps.length, 1);
  assert.equal(sequences[0].enrollment_count, 21);
  assert.match(capturedSql, /LEFT JOIN LATERAL/);
  assert.doesNotMatch(capturedSql, /LEFT JOIN crm_sequence_enrollments e ON e\.sequence_id = s\.id/);
});

test('conta i destinatari idonei applicando i filtri della campagna', async (t) => {
  const originalQuery = db.query;
  let captured;
  db.query = async (sql, values) => {
    captured = { sql, values };
    return { rows: [{ count: 12 }] };
  };
  t.after(() => { db.query = originalQuery; });

  const count = await crmRepo.countEligibleContactsForList(
    { id: '123e4567-e89b-12d3-a456-426614174000' },
    [
      { field: 'contactType', operator: 'equals', value: 'parent' },
      { field: 'tags', operator: 'contains', value: 'webinar' },
    ]
  );

  assert.equal(count, 12);
  assert.match(captured.sql, /c\.contact_type = \$2/);
  assert.match(captured.sql, /\$3 = ANY\(c\.tags\)/);
  assert.deepEqual(captured.values, [
    '123e4567-e89b-12d3-a456-426614174000',
    'parent',
    'webinar',
  ]);
});

test('unisce più liste ed esclude i contatti presenti nelle liste di blocco', () => {
  const result = crmRepo.compileCampaignAudience(
    [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
    ],
    ['123e4567-e89b-12d3-a456-426614174002'],
    3
  );

  assert.match(result.clause, /lm\.list_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(result.clause, /excluded\.list_id = ANY\(\$4::uuid\[\]\)/);
  assert.match(result.clause, /NOT EXISTS/);
  assert.deepEqual(result.values, [
    [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
    ],
    ['123e4567-e89b-12d3-a456-426614174002'],
  ]);
});

test('crea una campagna dinamica senza congelare i destinatari', async (t) => {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const calls = [];
  db.query = async (sql) => {
    if (sql.includes('FROM crm_lists')) return { rows: [{ id: 'list-1' }] };
    if (sql.includes('FROM crm_email_templates')) return { rows: [{ id: 'template-1', status: 'published' }] };
    return { rows: [] };
  };
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('INSERT INTO crm_email_campaigns')) return { rows: [{ id: 'campaign-1' }] };
      if (sql.startsWith('SELECT count(*)::int AS count FROM crm_contacts')) return { rows: [{ count: 1 }] };
      if (sql.includes('UPDATE crm_email_campaigns')) return { rows: [{ id: 'campaign-1', total_count: 1 }] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => {
    db.query = originalQuery;
    db.getClient = originalGetClient;
  });

  const campaign = await crmRepo.createCampaign({
    name: 'Genitori webinar',
    listId: 'list-1',
    templateId: 'template-1',
    recipientFilters: [{ field: 'contactType', operator: 'equals', value: 'parent' }],
    scheduledAt: '2026-10-20T16:00:00.000Z',
    createdBy: 'admin',
  });

  const estimateQuery = calls.find((call) => call.sql.startsWith('SELECT count(*)::int AS count FROM crm_contacts'));
  assert.match(estimateQuery.sql, /c\.contact_type = \$2/);
  assert.deepEqual(estimateQuery.values, ['list-1', 'parent']);
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO crm_email_jobs')), false);
  assert.equal(campaign.total_count, 1);
});

test('ricalcola la stima delle campagne non ancora materializzate', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes('FROM crm_email_campaigns c')) {
      return { rows: [
        {
          id: 'campaign-dynamic',
          list_id: 'list-1',
          recipient_filters: [{ field: 'contactType', operator: 'equals', value: 'parent' }],
          recipients_materialized_at: null,
          total_count: 84,
        },
        {
          id: 'campaign-sent',
          list_id: 'list-1',
          recipient_filters: [],
          recipients_materialized_at: '2026-10-20T16:00:00.000Z',
          total_count: 84,
        },
      ] };
    }
    if (sql.startsWith('SELECT count(*)::int AS count FROM crm_contacts')) {
      return { rows: [{ count: 127 }] };
    }
    return { rows: [] };
  };
  t.after(() => { db.query = originalQuery; });

  const campaigns = await crmRepo.listCampaigns();

  assert.equal(campaigns[0].estimated_count, 127);
  assert.equal(campaigns[1].estimated_count, undefined);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /c\.contact_type = \$2/);
  assert.deepEqual(calls[1].values, ['list-1', 'parent']);
});

test('modifica atomicamente una campagna in coda mantenendo i destinatari dinamici', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id,status FROM crm_email_jobs')) {
        return { rows: [{ id: 'job-old', status: 'pending' }] };
      }
      if (sql.startsWith('SELECT * FROM crm_email_campaigns')) {
        return { rows: [{
          id: 'campaign-1', status: 'queued', total_count: 1,
          recipients_materialized_at: null, scheduled_at: '2026-10-20T16:00:00.000Z',
        }] };
      }
      if (sql.includes('AS list_exists')) return { rows: [{ list_exists: true, template_exists: true }] };
      if (sql.startsWith('SELECT count(*)::int AS count FROM crm_contacts')) return { rows: [{ count: 1 }] };
      if (sql.includes('SET total_count=')) return { rows: [{ id: 'campaign-1', total_count: 1, status: 'queued' }] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const campaign = await crmRepo.updateCampaign('campaign-1', {
    name: 'Webinar genitori aggiornato',
    listId: 'list-2',
    templateId: 'template-2',
    recipientFilters: [{ field: 'contactType', operator: 'equals', value: 'parent' }],
    scheduledAt: '2026-10-21T16:00:00.000Z',
  });

  const jobsLockIndex = calls.findIndex((call) => call.sql.includes('SELECT id,status FROM crm_email_jobs'));
  const campaignLockIndex = calls.findIndex((call) => call.sql.startsWith('SELECT * FROM crm_email_campaigns'));
  assert.ok(jobsLockIndex < campaignLockIndex);
  assert.ok(calls.some((call) => call.sql.startsWith('DELETE FROM crm_email_jobs')));
  assert.ok(calls.some((call) => call.sql.includes('recipient_filters=$5')));
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO crm_email_jobs')), false);
  assert.equal(campaign.status, 'queued');
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('materializza alla scadenza i contatti correnti della lista', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('LIMIT 1 FOR UPDATE SKIP LOCKED')) {
        return { rows: [{
          id: 'campaign-1', status: 'queued', list_id: 'list-1', template_id: 'template-1',
          recipient_filters: [{ field: 'contactType', operator: 'equals', value: 'parent' }],
          scheduled_at: '2026-10-20T16:00:00.000Z',
        }] };
      }
      if (sql.startsWith('SELECT count(*)::int AS count FROM crm_email_jobs')) return { rows: [{ count: 0 }] };
      if (sql.includes('INSERT INTO crm_email_jobs')) return { rows: [{ id: 'job-1' }, { id: 'job-2' }], rowCount: 2 };
      if (sql.includes('SET total_count=')) {
        return { rows: [{ id: 'campaign-1', status: 'queued', total_count: 2, recipients_materialized_at: new Date() }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const campaign = await crmRepo.materializeNextDueCampaign();

  const jobsQuery = calls.find((call) => call.sql.includes('INSERT INTO crm_email_jobs'));
  assert.match(jobsQuery.sql, /c\.contact_type = \$5/);
  assert.deepEqual(jobsQuery.values, [
    'campaign-1',
    'template-1',
    '2026-10-20T16:00:00.000Z',
    'list-1',
    'parent',
  ]);
  assert.equal(campaign.total_count, 2);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('blocca la modifica dopo il calcolo definitivo dei destinatari', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id,status FROM crm_email_jobs')) {
        return { rows: [{ id: 'job-1', status: 'pending' }] };
      }
      if (sql.startsWith('SELECT * FROM crm_email_campaigns')) {
        return { rows: [{
          id: 'campaign-1', status: 'queued', total_count: 1,
          scheduled_at: '2026-10-20T16:00:00.000Z',
          recipients_materialized_at: '2026-10-20T16:00:01.000Z',
        }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  await assert.rejects(
    () => crmRepo.updateCampaign('campaign-1', {
      name: 'Troppo tardi',
      listId: 'list-1',
      templateId: 'template-1',
      recipientFilters: [],
      scheduledAt: '2026-10-21T16:00:00.000Z',
    }),
    (error) => error.status === 409 && /queued campaigns/.test(error.message)
  );
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('non duplica i job creati dalla versione precedente durante il deploy', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('LIMIT 1 FOR UPDATE SKIP LOCKED')) {
        return { rows: [{ id: 'campaign-1', status: 'queued', total_count: 3 }] };
      }
      if (sql.startsWith('SELECT count(*)::int AS count FROM crm_email_jobs')) return { rows: [{ count: 3 }] };
      if (sql.includes('SET recipients_materialized_at=')) {
        return { rows: [{ id: 'campaign-1', status: 'queued', total_count: 3 }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const campaign = await crmRepo.materializeNextDueCampaign();

  assert.equal(campaign.total_count, 3);
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO crm_email_jobs')), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('impedisce di eliminare una campagna già acquisita dal worker', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id,status FROM crm_email_jobs')) {
        return { rows: [{ id: 'job-1', status: 'sending' }] };
      }
      if (sql.startsWith('SELECT * FROM crm_email_campaigns')) {
        return { rows: [{ id: 'campaign-1', status: 'running', total_count: 1 }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  await assert.rejects(
    () => crmRepo.deleteCampaign('campaign-1'),
    (error) => error.status === 409 && /queued campaigns/.test(error.message)
  );
  assert.equal(calls.some((call) => call.sql.startsWith('DELETE FROM crm_email_campaigns')), false);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('elimina una campagna in coda e i relativi job in cascata', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id,status FROM crm_email_jobs')) {
        return { rows: [{ id: 'job-1', status: 'pending' }] };
      }
      if (sql.startsWith('SELECT * FROM crm_email_campaigns')) {
        return { rows: [{ id: 'campaign-1', status: 'queued', total_count: 1 }] };
      }
      if (sql.startsWith('DELETE FROM crm_email_campaigns')) {
        return { rows: [{ id: 'campaign-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const removed = await crmRepo.deleteCampaign('campaign-1');

  assert.deepEqual(removed, { id: 'campaign-1' });
  assert.ok(calls.some((call) => call.sql.startsWith('DELETE FROM crm_email_campaigns')));
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('riaccoda soltanto i destinatari falliti di una campagna completata', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT * FROM crm_email_campaigns')) {
        return { rows: [{ id: 'campaign-1', status: 'completed_with_errors', sent_count: 185, failed_count: 270 }] };
      }
      if (sql.includes("WHERE campaign_id=$1 AND status='failed'")) {
        return { rows: Array.from({ length: 270 }, (_, index) => ({ id: `job-${index}` })), rowCount: 270 };
      }
      if (sql.includes('UPDATE crm_email_campaigns SET')) {
        return { rows: [{ id: 'campaign-1', status: 'queued', sent_count: 185, failed_count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const result = await crmRepo.retryFailedCampaignJobs('campaign-1');

  const jobsUpdate = calls.find((call) => call.sql.includes('UPDATE crm_email_jobs SET'));
  assert.match(jobsUpdate.sql, /status='pending',attempts=0/);
  assert.match(jobsUpdate.sql, /WHERE campaign_id=\$1 AND status='failed'/);
  assert.equal(result.retriedCount, 270);
  assert.equal(result.campaign.sent_count, 185);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('rifiuta il reinvio di una campagna ancora in esecuzione', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT * FROM crm_email_campaigns')) {
        return { rows: [{ id: 'campaign-1', status: 'running' }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  await assert.rejects(
    () => crmRepo.retryFailedCampaignJobs('campaign-1'),
    (error) => error.status === 409 && /failed campaigns/.test(error.message)
  );
  assert.equal(calls.some((call) => call.sql.includes('UPDATE crm_email_jobs SET')), false);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('modifica una campagna legacy mantenendo invariati i destinatari', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id,status FROM crm_email_jobs')) {
        return { rows: [{ id: 'job-1', status: 'pending' }] };
      }
      if (sql.startsWith('SELECT * FROM crm_email_campaigns')) {
        return { rows: [{
          id: 'campaign-1', status: 'queued', total_count: 1,
          list_id: 'list-1', recipient_filters: null,
        }] };
      }
      if (sql.includes('AS list_exists')) return { rows: [{ list_exists: true, template_exists: true }] };
      if (sql.includes('UPDATE crm_email_campaigns SET')) {
        return { rows: [{ id: 'campaign-1', status: 'queued', total_count: 1 }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const campaign = await crmRepo.updateCampaign('campaign-1', {
    name: 'Campagna legacy aggiornata',
    listId: 'list-1',
    templateId: 'template-2',
    recipientFilters: [],
    preserveRecipients: true,
    scheduledAt: '2026-10-21T16:00:00.000Z',
  });

  assert.equal(campaign.id, 'campaign-1');
  assert.ok(calls.some((call) => call.sql.includes('UPDATE crm_email_jobs SET template_id=')));
  assert.equal(calls.some((call) => call.sql.startsWith('DELETE FROM crm_email_jobs')), false);
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO crm_email_jobs')), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('crea e rinomina cartelle contenuto mantenendo il tipo', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: 'folder-1', kind: values[0] === 'folder-1' ? values[3] : values[0], name: values[1] }] };
  };
  t.after(() => { db.query = originalQuery; });

  await crmRepo.createContentFolder({ kind: 'template', name: 'Webinar', description: 'Template webinar', createdBy: 'admin' });
  await crmRepo.updateContentFolder('folder-1', { kind: 'template', name: 'Webinar 2026', description: '' });

  assert.deepEqual(calls[0].values, ['template', 'Webinar', 'Template webinar', 'admin']);
  assert.deepEqual(calls[1].values, ['folder-1', 'Webinar 2026', null, 'template']);
  assert.match(calls[1].sql, /WHERE id=\$1 AND kind=\$4/);
});

test('registra il click e iscrive il contatto alla lista in modo atomico', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id,contact_id FROM crm_email_jobs')) {
        return { rows: [{ id: 'job-1', contact_id: 'contact-1' }] };
      }
      if (sql.includes('FROM crm_lists WHERE lower(name)')) {
        return { rows: [{ id: 'list-1', name: 'Da Ricontattare' }] };
      }
      if (sql.includes('INSERT INTO crm_list_memberships')) return { rows: [{ contact_id: 'contact-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const result = await crmRepo.recordEmailEvent({
    jobId: 'job-1',
    eventType: 'click',
    url: 'https://crm.example.com/email/recontact',
    listName: 'Da Ricontattare',
  });

  assert.equal(result.membershipAdded, true);
  assert.ok(calls.some((call) => call.sql.includes('INSERT INTO crm_email_events')));
  assert.ok(calls.some((call) => call.sql.includes('INSERT INTO crm_list_memberships')));
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('calcola analytics e click unici per una campagna email', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('FROM crm_email_campaigns c')) {
      return { rows: [{ id: 'campaign-1', name: 'Webinar', template_name: 'Invito' }] };
    }
    if (sql.includes('count(*)::int AS total,')) {
      return { rows: [{
        total: 100, accepted: 80, failed: 5, pending: 15, cancelled: 0,
        unique_opens: 40, total_opens: 55, unique_clickers: 20, total_clicks: 31,
      }] };
    }
    if (sql.includes('count(DISTINCT event.job_id)')) {
      return { rows: [{ url: 'https://example.com/iscrizione', total_clicks: 24, unique_clicks: 16 }] };
    }
    return { rows: [] };
  };
  t.after(() => { db.query = originalQuery; });

  const analytics = await crmRepo.emailAnalytics({ campaignId: 'campaign-1' });

  assert.equal(analytics.summary.open_rate, 50);
  assert.equal(analytics.summary.click_rate, 25);
  assert.equal(analytics.links[0].total_click_rate, 30);
  assert.equal(analytics.links[0].unique_click_rate, 20);
  assert.ok(calls.every((call) => call.values[0] === 'campaign-1'));
});

test('limita gli analytics al singolo step della sequenza', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('FROM crm_sequence_steps st')) {
      return { rows: [{ id: 'step-2', name: 'Nurturing', position: 1, template_name: 'Promemoria' }] };
    }
    if (sql.includes('count(*)::int AS total,')) {
      return { rows: [{
        total: 20, accepted: 10, failed: 0, pending: 10, cancelled: 0,
        unique_opens: 4, total_opens: 6, unique_clickers: 2, total_clicks: 3,
      }] };
    }
    if (sql.includes('count(DISTINCT event.job_id)')) return { rows: [] };
    return { rows: [] };
  };
  t.after(() => { db.query = originalQuery; });

  const analytics = await crmRepo.emailAnalytics({ sequenceId: 'sequence-1', sequenceStepId: 'step-2' });

  assert.equal(analytics.context, 'sequence_step');
  assert.equal(analytics.position, 1);
  assert.equal(analytics.summary.open_rate, 40);
  assert.ok(calls.slice(1).every((call) => call.sql.includes('j.sequence_step_id=$2')));
  assert.ok(calls.slice(1).every((call) => call.values[0] === 'sequence-1' && call.values[1] === 'step-2'));
});
