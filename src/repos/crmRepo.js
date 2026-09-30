const db = require('../config/db');
const CONTACT_SELECT = `c.*,
  (SELECT status.name FROM crm_contact_statuses status WHERE status.id=c.contact_status_id) AS contact_status_name`;

function compileContactFilters(filters = {}, startIndex = 1) {
  const conditions = [];
  const values = [];
  const add = (value) => {
    values.push(value);
    return `$${startIndex + values.length - 1}`;
  };

  const query = String(filters.query || '').trim().slice(0, 120);
  if (query) {
    const token = add(query);
    conditions.push(`(
      c.first_name ILIKE '%' || ${token} || '%'
      OR c.last_name ILIKE '%' || ${token} || '%'
      OR c.email ILIKE '%' || ${token} || '%'
      OR c.phone ILIKE '%' || ${token} || '%'
    )`);
  }
  if (filters.source) conditions.push(`c.source = ${add(String(filters.source).slice(0, 80))}`);
  if (filters.emailStatus) conditions.push(`c.email_status = ${add(filters.emailStatus)}`);
  if (filters.contactStatusId) conditions.push(`c.contact_status_id = ${add(filters.contactStatusId)}::uuid`);
  if (filters.hasEmail === true) conditions.push('c.email_normalized IS NOT NULL');
  if (filters.hasEmail === false) conditions.push('c.email_normalized IS NULL');
  if (filters.hasPhone === true) conditions.push('c.phone_normalized IS NOT NULL');
  if (filters.hasPhone === false) conditions.push('c.phone_normalized IS NULL');
  if (Array.isArray(filters.tags) && filters.tags.length) {
    conditions.push(`c.tags @> ${add(filters.tags)}::text[]`);
  }
  if (filters.createdFrom) conditions.push(`c.created_at >= ${add(filters.createdFrom)}::timestamptz`);
  if (filters.createdTo) conditions.push(`c.created_at <= ${add(filters.createdTo)}::timestamptz`);

  return { clause: conditions.length ? conditions.join(' AND ') : 'TRUE', values };
}

function compileListFilter(list, startIndex = 1) {
  const dynamic = compileContactFilters(list.filter_json || {}, startIndex);
  const listIndex = startIndex + dynamic.values.length;
  return {
    clause: `((${dynamic.clause} OR EXISTS (
      SELECT 1 FROM crm_list_memberships lm
      WHERE lm.list_id = $${listIndex} AND lm.contact_id = c.id
    )) AND NOT EXISTS (
      SELECT 1 FROM crm_list_exclusions le
      WHERE le.list_id = $${listIndex} AND le.contact_id = c.id
    ))`,
    values: [...dynamic.values, list.id],
  };
}

const SEQUENCE_CONDITION_COLUMNS = {
  contactType: 'c.contact_type',
  contactStatusId: 'c.contact_status_id',
  emailStatus: 'c.email_status',
  source: 'c.source',
  firstName: 'c.first_name',
  lastName: 'c.last_name',
  email: 'c.email',
  phone: 'c.phone',
  webinarRegisteredAt: 'c.webinar_registered_at',
  utmSource: 'c.utm_source',
  utmMedium: 'c.utm_medium',
  utmCampaign: 'c.utm_campaign',
  utmTerm: 'c.utm_term',
  utmContent: 'c.utm_content',
};

function compileSequenceConditions(conditions = [], startIndex = 1) {
  const clauses = [];
  const values = [];
  const add = (value) => {
    values.push(value);
    return `$${startIndex + values.length - 1}`;
  };
  for (const condition of conditions) {
    if (condition.field === 'tags') {
      const token = add(condition.value);
      clauses.push(condition.operator === 'not_contains'
        ? `NOT (${token} = ANY(c.tags))`
        : `${token} = ANY(c.tags)`);
      continue;
    }
    const column = SEQUENCE_CONDITION_COLUMNS[condition.field];
    if (condition.operator === 'is_set') {
      clauses.push(`${column} IS NOT NULL`);
      continue;
    }
    if (condition.operator === 'is_not_set') {
      clauses.push(`${column} IS NULL`);
      continue;
    }
    const token = add(condition.value);
    const typedToken = condition.field === 'contactStatusId'
      ? `${token}::uuid`
      : condition.field === 'webinarRegisteredAt' ? `${token}::date` : token;
    if (condition.operator === 'not_equals') clauses.push(`${column} IS DISTINCT FROM ${typedToken}`);
    else if (condition.operator === 'contains') clauses.push(`COALESCE(${column}::text, '') ILIKE '%' || ${token} || '%'`);
    else if (condition.operator === 'before') clauses.push(`${column} < ${typedToken}`);
    else if (condition.operator === 'after') clauses.push(`${column} > ${typedToken}`);
    else clauses.push(`${column} = ${typedToken}`);
  }
  return { clause: clauses.length ? clauses.join(' AND ') : 'TRUE', values };
}

async function addContactEvent(client, contactId, eventType, eventData = {}, actor = null) {
  await client.query(
    `INSERT INTO crm_contact_events (contact_id,event_type,event_data,actor)
     VALUES ($1,$2,$3,$4)`,
    [contactId, eventType, eventData, actor]
  );
}

async function upsertContactWithClient(client, contact, { actor = null } = {}) {
  const found = await client.query(
    `SELECT id FROM crm_contacts
     WHERE ($1::text IS NOT NULL AND email_normalized = $1)
        OR ($2::text IS NOT NULL AND phone_normalized = $2)
     ORDER BY CASE WHEN email_normalized = $1 THEN 0 ELSE 1 END
     FOR UPDATE`,
    [contact.emailNormalized, contact.phoneNormalized]
  );
  if (found.rows.length > 1) {
    throw Object.assign(new Error('Email and phone belong to different contacts'), { status: 409 });
  }
  if (found.rows[0]) {
    const result = await client.query(
      `UPDATE crm_contacts SET
         first_name = COALESCE($2, first_name),
         last_name = COALESCE($3, last_name),
         email = COALESCE($4, email),
         email_normalized = COALESCE($5, email_normalized),
         phone = COALESCE($6, phone),
         phone_normalized = COALESCE($7, phone_normalized),
         source = COALESCE($8, source),
         email_status = COALESCE($9, email_status),
         tags = (SELECT ARRAY(SELECT DISTINCT value FROM unnest(tags || $10::text[]) AS value)),
         custom_fields = custom_fields || $11::jsonb,
         consent_at = COALESCE($12, consent_at),
         consent_source = COALESCE($13, consent_source),
         consent_proof = consent_proof || $14::jsonb,
         contact_status_id = COALESCE($15, contact_status_id),
         contact_type = COALESCE($16, contact_type),
         webinar_registered_at = COALESCE($17, webinar_registered_at),
         utm_source = COALESCE($18, utm_source),
         utm_medium = COALESCE($19, utm_medium),
         utm_campaign = COALESCE($20, utm_campaign),
         utm_term = COALESCE($21, utm_term),
         utm_content = COALESCE($22, utm_content),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [found.rows[0].id, contact.firstName, contact.lastName, contact.email,
       contact.emailNormalized, contact.phone, contact.phoneNormalized, contact.source,
       contact.emailStatus, contact.tags, contact.customFields, contact.consentAt,
       contact.consentSource, contact.consentProof, contact.contactStatusId, contact.contactType,
       contact.webinarRegisteredAt, contact.utmSource, contact.utmMedium, contact.utmCampaign,
       contact.utmTerm, contact.utmContent]
    );
    await addContactEvent(client, result.rows[0].id, 'contact_updated', {
      source: contact.source,
      emailStatus: contact.emailStatus,
      consentAt: contact.consentAt,
      consentSource: contact.consentSource,
      consentProof: contact.consentProof,
      contactStatusId: contact.contactStatusId,
      contactType: contact.contactType,
      webinarRegisteredAt: contact.webinarRegisteredAt,
      utmSource: contact.utmSource,
      utmMedium: contact.utmMedium,
      utmCampaign: contact.utmCampaign,
      utmTerm: contact.utmTerm,
      utmContent: contact.utmContent,
    }, actor);
    return { contact: result.rows[0], created: false };
  }
  const result = await client.query(
    `INSERT INTO crm_contacts
     (first_name,last_name,email,email_normalized,phone,phone_normalized,source,email_status,tags,
      custom_fields,consent_at,consent_source,consent_proof,contact_status_id,contact_type,
      webinar_registered_at,utm_source,utm_medium,utm_campaign,utm_term,utm_content)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [contact.firstName, contact.lastName, contact.email, contact.emailNormalized,
     contact.phone, contact.phoneNormalized, contact.source || 'manual',
     contact.emailStatus || 'unknown', contact.tags, contact.customFields, contact.consentAt,
     contact.consentSource, contact.consentProof, contact.contactStatusId, contact.contactType,
     contact.webinarRegisteredAt, contact.utmSource, contact.utmMedium, contact.utmCampaign,
     contact.utmTerm, contact.utmContent]
  );
  await addContactEvent(client, result.rows[0].id, 'contact_created', {
    source: contact.source,
    emailStatus: contact.emailStatus,
    consentAt: contact.consentAt,
    consentSource: contact.consentSource,
    consentProof: contact.consentProof,
    contactStatusId: contact.contactStatusId,
    contactType: contact.contactType,
    webinarRegisteredAt: contact.webinarRegisteredAt,
    utmSource: contact.utmSource,
    utmMedium: contact.utmMedium,
    utmCampaign: contact.utmCampaign,
    utmTerm: contact.utmTerm,
    utmContent: contact.utmContent,
  }, actor);
  return { contact: result.rows[0], created: true };
}

async function upsertContact(contact, options = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await upsertContactWithClient(client, contact, options);
    await client.query('COMMIT');
    return result.contact;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listContacts(filters, { limit = 100, offset = 0 } = {}) {
  const compiled = compileContactFilters(filters);
  const limitIndex = compiled.values.length + 1;
  const offsetIndex = compiled.values.length + 2;
  const [items, count] = await Promise.all([
    db.query(
      `SELECT ${CONTACT_SELECT} FROM crm_contacts c WHERE ${compiled.clause}
       ORDER BY c.created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...compiled.values, limit, offset]
    ),
    db.query(`SELECT count(*)::int AS count FROM crm_contacts c WHERE ${compiled.clause}`, compiled.values),
  ]);
  return { contacts: await attachListsToContacts(items.rows), total: count.rows[0].count };
}

async function attachListsToContacts(contacts) {
  if (!contacts.length) return contacts;
  const ids = contacts.map((contact) => contact.id);
  const { rows: lists } = await db.query('SELECT * FROM crm_lists ORDER BY name ASC');
  const memberships = new Map(ids.map((id) => [id, []]));
  await Promise.all(lists.map(async (list) => {
    const compiled = compileListFilter(list);
    const idsIndex = compiled.values.length + 1;
    const { rows } = await db.query(
      `SELECT c.id FROM crm_contacts c
       WHERE c.id=ANY($${idsIndex}::uuid[]) AND ${compiled.clause}`,
      [...compiled.values, ids]
    );
    for (const row of rows) memberships.get(row.id)?.push({ id: list.id, name: list.name });
  }));
  return contacts.map((contact) => ({
    ...contact,
    lists: (memberships.get(contact.id) || []).sort((left, right) => left.name.localeCompare(right.name, 'it')),
  }));
}

async function exportContacts(filters = {}) {
  const compiled = compileContactFilters(filters);
  const { rows } = await db.query(
    `SELECT ${CONTACT_SELECT} FROM crm_contacts c WHERE ${compiled.clause} ORDER BY c.created_at DESC`,
    compiled.values
  );
  return attachListsToContacts(rows);
}

async function getContact(id) {
  const { rows } = await db.query(`SELECT ${CONTACT_SELECT} FROM crm_contacts c WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

async function getContactProfile(id) {
  const contact = await getContact(id);
  if (!contact) return null;
  const [withLists] = await attachListsToContacts([contact]);
  const [events, messages, emailJobs, enrollments] = await Promise.all([
    db.query(
      `SELECT id,event_type,event_data,actor,created_at
       FROM crm_contact_events WHERE contact_id=$1
       ORDER BY created_at DESC LIMIT 200`,
      [id]
    ),
    contact.phone_normalized ? db.query(
      `SELECT m.id,m.role,m.content,m.media_url,m.media_type,m.provider_status,m.created_at,
              c.id AS conversation_id,b.name AS bot_name
       FROM messages m
       JOIN conversations c ON c.id=m.conversation_id
       JOIN bots b ON b.id=c.bot_id
       WHERE c.phone_number=$1
       ORDER BY m.created_at DESC LIMIT 100`,
      [contact.phone_normalized]
    ) : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT j.id,j.kind,j.status,j.scheduled_at,j.sent_at,j.last_error,j.provider_message_id,
              t.name AS template_name,ec.name AS campaign_name,s.name AS sequence_name
       FROM crm_email_jobs j
       JOIN crm_email_templates t ON t.id=j.template_id
       LEFT JOIN crm_email_campaigns ec ON ec.id=j.campaign_id
       LEFT JOIN crm_sequence_enrollments e ON e.id=j.enrollment_id
       LEFT JOIN crm_sequences s ON s.id=e.sequence_id
       WHERE j.contact_id=$1
       ORDER BY j.created_at DESC LIMIT 100`,
      [id]
    ),
    db.query(
      `SELECT e.id,e.status,e.current_step,e.next_run_at,e.last_error,e.created_at,e.updated_at,
              s.id AS sequence_id,s.name AS sequence_name
       FROM crm_sequence_enrollments e
       JOIN crm_sequences s ON s.id=e.sequence_id
       WHERE e.contact_id=$1 ORDER BY e.created_at DESC`,
      [id]
    ),
  ]);
  return {
    contact: withLists,
    events: events.rows,
    messages: messages.rows,
    emailJobs: emailJobs.rows,
    enrollments: enrollments.rows,
  };
}

async function updateContact(id, contact, actor = null) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE crm_contacts SET
         first_name=$2,last_name=$3,email=$4,email_normalized=$5,
         phone=$6,phone_normalized=$7,source=$8,email_status=$9,
         tags=$10,custom_fields=$11,consent_at=$12,consent_source=$13,consent_proof=$14,
         contact_status_id=$15,contact_type=$16,webinar_registered_at=$17,
         utm_source=$18,utm_medium=$19,utm_campaign=$20,utm_term=$21,utm_content=$22,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, contact.firstName, contact.lastName, contact.email, contact.emailNormalized,
       contact.phone, contact.phoneNormalized, contact.source, contact.emailStatus || 'unknown',
       contact.tags, contact.customFields, contact.consentAt, contact.consentSource, contact.consentProof,
       contact.contactStatusId, contact.contactType, contact.webinarRegisteredAt, contact.utmSource,
       contact.utmMedium, contact.utmCampaign, contact.utmTerm, contact.utmContent]
    );
    if (rows[0]) {
      await addContactEvent(client, id, 'contact_updated', {
        source: contact.source,
        emailStatus: contact.emailStatus,
        consentAt: contact.consentAt,
        consentSource: contact.consentSource,
        consentProof: contact.consentProof,
        contactStatusId: contact.contactStatusId,
        contactType: contact.contactType,
        webinarRegisteredAt: contact.webinarRegisteredAt,
        utmSource: contact.utmSource,
        utmMedium: contact.utmMedium,
        utmCampaign: contact.utmCampaign,
        utmTerm: contact.utmTerm,
        utmContent: contact.utmContent,
      }, actor);
    }
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteContact(id) {
  const { rows } = await db.query('DELETE FROM crm_contacts WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

async function createList(input) {
  const { rows } = await db.query(
    `INSERT INTO crm_lists (name,description,filter_json,created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.name, input.description || null, input.filters || {}, input.createdBy]
  );
  return rows[0];
}

async function updateList(id, input) {
  const { rows } = await db.query(
    `UPDATE crm_lists SET name=$2,description=$3,filter_json=$4,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, input.name, input.description || null, input.filters || {}]
  );
  return rows[0] || null;
}

async function listLists() {
  const { rows } = await db.query('SELECT * FROM crm_lists ORDER BY updated_at DESC');
  return Promise.all(rows.map(async (list) => {
    const compiled = compileListFilter(list);
    const result = await db.query(
      `SELECT count(*)::int AS count FROM crm_contacts c WHERE ${compiled.clause}`,
      compiled.values
    );
    return { ...list, contact_count: result.rows[0].count };
  }));
}

async function getList(id) {
  const { rows } = await db.query('SELECT * FROM crm_lists WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listContactsForList(list, { limit = 100, offset = 0 } = {}) {
  const compiled = compileListFilter(list);
  const limitIndex = compiled.values.length + 1;
  const offsetIndex = compiled.values.length + 2;
  const [items, count] = await Promise.all([
    db.query(
      `SELECT ${CONTACT_SELECT} FROM crm_contacts c WHERE ${compiled.clause}
       ORDER BY c.created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...compiled.values, limit, offset]
    ),
    db.query(`SELECT count(*)::int AS count FROM crm_contacts c WHERE ${compiled.clause}`, compiled.values),
  ]);
  return { contacts: await attachListsToContacts(items.rows), total: count.rows[0].count };
}

async function exportContactsForList(list) {
  const compiled = compileListFilter(list);
  const { rows } = await db.query(
    `SELECT ${CONTACT_SELECT} FROM crm_contacts c WHERE ${compiled.clause} ORDER BY c.created_at DESC`,
    compiled.values
  );
  return attachListsToContacts(rows);
}

async function bulkUpdateContacts({ ids = [], filters = null, changes, actor = null }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    let selected;
    if (filters) {
      const compiled = compileContactFilters(filters);
      selected = await client.query(
        `SELECT c.id FROM crm_contacts c WHERE ${compiled.clause} FOR UPDATE`,
        compiled.values
      );
    } else {
      selected = await client.query(
        'SELECT id FROM crm_contacts WHERE id=ANY($1::uuid[]) FOR UPDATE',
        [ids]
      );
    }
    const contactIds = selected.rows.map((row) => row.id);
    if (!contactIds.length) {
      await client.query('COMMIT');
      return { updated: 0, membershipChanged: 0 };
    }
    await client.query(
       `UPDATE crm_contacts c SET
         source=COALESCE($1,source),
         email_status=COALESCE($2,email_status),
         contact_status_id=CASE WHEN $3 THEN $4::uuid ELSE contact_status_id END,
         tags=ARRAY(
           SELECT DISTINCT tag FROM unnest(c.tags || $5::text[]) AS tag
           WHERE NOT (tag=ANY($6::text[]))
         ),
         updated_at=now()
       WHERE c.id=ANY($7::uuid[])`,
      [changes.source, changes.emailStatus, changes.contactStatusChanged, changes.contactStatusId,
       changes.addTags, changes.removeTags, contactIds]
    );
    let membershipChanged = 0;
    if (changes.listAction) {
      const list = await client.query('SELECT id FROM crm_lists WHERE id=$1', [changes.listId]);
      if (!list.rows[0]) throw Object.assign(new Error('Target list not found'), { status: 404 });
      if (changes.listAction === 'add') {
        await client.query(
          'DELETE FROM crm_list_exclusions WHERE list_id=$1 AND contact_id=ANY($2::uuid[])',
          [changes.listId, contactIds]
        );
        const result = await client.query(
          `INSERT INTO crm_list_memberships (list_id,contact_id,source)
           SELECT $1,contact_id,'bulk' FROM unnest($2::uuid[]) AS contact_id
           ON CONFLICT DO NOTHING`,
          [changes.listId, contactIds]
        );
        membershipChanged = result.rowCount;
      } else {
        const removed = await client.query(
          'DELETE FROM crm_list_memberships WHERE list_id=$1 AND contact_id=ANY($2::uuid[])',
          [changes.listId, contactIds]
        );
        const excluded = await client.query(
          `INSERT INTO crm_list_exclusions (list_id,contact_id,source)
           SELECT $1,contact_id,'bulk' FROM unnest($2::uuid[]) AS contact_id
           ON CONFLICT DO NOTHING`,
          [changes.listId, contactIds]
        );
        membershipChanged = removed.rowCount + excluded.rowCount;
      }
    }
    await client.query(
      `INSERT INTO crm_contact_events (contact_id,event_type,event_data,actor)
       SELECT contact_id,'bulk_updated',$1::jsonb,$2 FROM unnest($3::uuid[]) AS contact_id`,
      [JSON.stringify(changes), actor, contactIds]
    );
    await client.query('COMMIT');
    return { updated: contactIds.length, membershipChanged };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function importContacts(contacts, { listId = null, actor = null } = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (listId) {
      const list = await client.query('SELECT id FROM crm_lists WHERE id=$1', [listId]);
      if (!list.rows[0]) throw Object.assign(new Error('Target list not found'), { status: 404 });
    }
    let created = 0;
    let updated = 0;
    let addedToList = 0;
    for (const contact of contacts) {
      const result = await upsertContactWithClient(client, contact, { actor });
      if (result.created) created += 1;
      else updated += 1;
      if (listId) {
        await client.query(
          'DELETE FROM crm_list_exclusions WHERE list_id=$1 AND contact_id=$2',
          [listId, result.contact.id]
        );
        const membership = await client.query(
          `INSERT INTO crm_list_memberships (list_id,contact_id,source)
           VALUES ($1,$2,'csv') ON CONFLICT DO NOTHING RETURNING contact_id`,
          [listId, result.contact.id]
        );
        addedToList += membership.rowCount;
        if (membership.rowCount) {
          await addContactEvent(client, result.contact.id, 'list_joined', { listId, source: 'csv' }, actor);
        }
      }
    }
    await client.query('COMMIT');
    return { imported: contacts.length, created, updated, addedToList };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteList(id) {
  const { rows } = await db.query('DELETE FROM crm_lists WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

async function listContactStatuses() {
  const { rows } = await db.query(
    `SELECT status.*, count(contact.id)::int AS contact_count
     FROM crm_contact_statuses status
     LEFT JOIN crm_contacts contact ON contact.contact_status_id=status.id
     GROUP BY status.id
     ORDER BY status.sort_order ASC, status.name ASC`
  );
  return rows;
}

async function createContactStatus(name) {
  const { rows } = await db.query(
    `INSERT INTO crm_contact_statuses (name,sort_order)
     VALUES ($1,(SELECT COALESCE(max(sort_order),0)+10 FROM crm_contact_statuses))
     RETURNING *`,
    [name]
  );
  return rows[0];
}

async function deleteContactStatus(id) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('DELETE FROM crm_contact_statuses WHERE id=$1 RETURNING id', [id]);
    if (rows[0]) {
      await client.query(
        `UPDATE crm_lists SET filter_json=filter_json-'contactStatusId',updated_at=now()
         WHERE filter_json->>'contactStatusId'=$1`,
        [id]
      );
    }
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createTemplate(input) {
  const { rows } = await db.query(
    `INSERT INTO crm_email_templates (name,subject,preheader,html_body,text_body,created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.name, input.subject, input.preheader || null, input.htmlBody, input.textBody || null, input.createdBy]
  );
  return rows[0];
}

async function updateTemplate(id, input) {
  const { rows } = await db.query(
    `UPDATE crm_email_templates SET name=$2,subject=$3,preheader=$4,html_body=$5,text_body=$6,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, input.name, input.subject, input.preheader || null, input.htmlBody, input.textBody || null]
  );
  return rows[0] || null;
}

async function listTemplates() {
  const { rows } = await db.query('SELECT * FROM crm_email_templates ORDER BY updated_at DESC');
  return rows;
}

async function getTemplate(id) {
  const { rows } = await db.query('SELECT * FROM crm_email_templates WHERE id=$1', [id]);
  return rows[0] || null;
}

async function deleteTemplate(id) {
  const { rows } = await db.query('DELETE FROM crm_email_templates WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

async function createSequence(input) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    let triggerList = null;
    if (input.triggerListId) {
      const result = await client.query('SELECT * FROM crm_lists WHERE id=$1', [input.triggerListId]);
      triggerList = result.rows[0];
      if (!triggerList) throw Object.assign(new Error('Trigger list not found'), { status: 404 });
    }
    const sequenceResult = await client.query(
      `INSERT INTO crm_sequences
       (name,description,active,trigger_type,trigger_list_id,trigger_started_at,trigger_conditions,created_by)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $4='list_joined' THEN now() ELSE NULL END,$6,$7)
       RETURNING *`,
      [input.name, input.description || null, input.active, input.triggerType,
       input.triggerListId, JSON.stringify(input.triggerConditions), input.createdBy]
    );
    const sequence = sequenceResult.rows[0];
    for (const [position, step] of input.steps.entries()) {
      await client.query(
        `INSERT INTO crm_sequence_steps (sequence_id,position,delay_minutes,template_id)
         VALUES ($1,$2,$3,$4)`,
        [sequence.id, position, step.delayMinutes, step.templateId]
      );
    }
    if (triggerList) await seedSequenceTriggerState(client, sequence.id, triggerList);
    await client.query('COMMIT');
    return sequence;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateSequence(id, input) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM crm_sequences WHERE id=$1 FOR UPDATE', [id]);
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const enrollment = await client.query(
      'SELECT count(*)::int AS count FROM crm_sequence_enrollments WHERE sequence_id=$1',
      [id]
    );
    if (enrollment.rows[0].count > 0) {
      throw Object.assign(new Error('A sequence with enrollments cannot change its steps'), { status: 409 });
    }
    let triggerList = null;
    if (input.triggerListId) {
      const result = await client.query('SELECT * FROM crm_lists WHERE id=$1', [input.triggerListId]);
      triggerList = result.rows[0];
      if (!triggerList) throw Object.assign(new Error('Trigger list not found'), { status: 404 });
    }
    const sequence = await client.query(
      `UPDATE crm_sequences SET
         name=$2,description=$3,active=$4,trigger_type=$5,trigger_list_id=$6,
         trigger_started_at=CASE WHEN $5='list_joined' THEN now() ELSE NULL END,
         trigger_conditions=$7,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, input.name, input.description || null, input.active, input.triggerType,
       input.triggerListId, JSON.stringify(input.triggerConditions)]
    );
    await client.query('DELETE FROM crm_sequence_steps WHERE sequence_id=$1', [id]);
    await client.query('DELETE FROM crm_sequence_trigger_state WHERE sequence_id=$1', [id]);
    for (const [position, step] of input.steps.entries()) {
      await client.query(
        `INSERT INTO crm_sequence_steps (sequence_id,position,delay_minutes,template_id)
         VALUES ($1,$2,$3,$4)`,
        [id, position, step.delayMinutes, step.templateId]
      );
    }
    if (triggerList) await seedSequenceTriggerState(client, id, triggerList);
    await client.query('COMMIT');
    return sequence.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedSequenceTriggerState(client, sequenceId, list) {
  const compiled = compileListFilter(list, 2);
  await client.query(
    `INSERT INTO crm_sequence_trigger_state (sequence_id,contact_id,is_member)
     SELECT $1,c.id,TRUE FROM crm_contacts c WHERE ${compiled.clause}
     ON CONFLICT (sequence_id,contact_id) DO UPDATE
     SET is_member=TRUE,observed_at=now()`,
    [sequenceId, ...compiled.values]
  );
}

async function setSequenceActive(id, active) {
  const { rows } = await db.query(
    'UPDATE crm_sequences SET active=$2,updated_at=now() WHERE id=$1 RETURNING *',
    [id, Boolean(active)]
  );
  return rows[0] || null;
}

async function listSequences() {
  const { rows } = await db.query(
    `SELECT s.*,
            l.name AS trigger_list_name,
            COALESCE(jsonb_agg(jsonb_build_object(
              'id', st.id, 'position', st.position, 'delayMinutes', st.delay_minutes,
              'templateId', st.template_id, 'templateName', t.name
            ) ORDER BY st.position) FILTER (WHERE st.id IS NOT NULL), '[]'::jsonb) AS steps,
            count(DISTINCT e.id)::int AS enrollment_count,
            count(DISTINCT e.id) FILTER (WHERE e.status='active')::int AS active_count,
            count(DISTINCT e.id) FILTER (WHERE e.status='completed')::int AS completed_count,
            count(DISTINCT e.id) FILTER (WHERE e.status='failed')::int AS failed_count
     FROM crm_sequences s
     LEFT JOIN crm_lists l ON l.id = s.trigger_list_id
     LEFT JOIN crm_sequence_steps st ON st.sequence_id = s.id
     LEFT JOIN crm_email_templates t ON t.id = st.template_id
     LEFT JOIN crm_sequence_enrollments e ON e.sequence_id = s.id
     GROUP BY s.id,l.name ORDER BY s.updated_at DESC`
  );
  return rows;
}

async function listSequenceEnrollments(sequenceId, { limit = 100, offset = 0 } = {}) {
  const [items, count] = await Promise.all([
    db.query(
      `SELECT e.id,e.status,e.current_step,e.next_run_at,e.last_error,e.created_at,e.updated_at,
              c.id AS contact_id,c.first_name,c.last_name,c.email,c.phone,
              (SELECT count(*)::int FROM crm_sequence_steps WHERE sequence_id=e.sequence_id) AS step_count
       FROM crm_sequence_enrollments e
       JOIN crm_contacts c ON c.id=e.contact_id
       WHERE e.sequence_id=$1
       ORDER BY e.created_at DESC LIMIT $2 OFFSET $3`,
      [sequenceId, limit, offset]
    ),
    db.query('SELECT count(*)::int AS count FROM crm_sequence_enrollments WHERE sequence_id=$1', [sequenceId]),
  ]);
  return { enrollments: items.rows, total: count.rows[0].count };
}

async function setEnrollmentStatus(sequenceId, enrollmentId, status) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id FROM crm_sequence_enrollments
       WHERE id=$1 AND sequence_id=$2 AND status IN ('active','paused')
       FOR UPDATE`,
      [enrollmentId, sequenceId]
    );
    if (!current.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    if (status === 'paused' || status === 'cancelled') {
      const sending = await client.query(
        `SELECT 1 FROM crm_email_jobs
         WHERE enrollment_id=$1 AND status='sending' LIMIT 1`,
        [enrollmentId]
      );
      if (sending.rows[0]) {
        throw Object.assign(new Error('Cannot change enrollment status while an email is being sent'), { status: 409 });
      }
    }
    const { rows } = await client.query(
      `UPDATE crm_sequence_enrollments
       SET status=$3,next_run_at=CASE WHEN $3='cancelled' THEN NULL ELSE next_run_at END,
           updated_at=now()
       WHERE id=$1 AND sequence_id=$2
       RETURNING *`,
      [enrollmentId, sequenceId, status]
    );
    if (rows[0] && status === 'cancelled') {
      await client.query(
        `UPDATE crm_email_jobs SET status='cancelled',last_error='Cancelled by user'
         WHERE enrollment_id=$1 AND status='pending'`,
        [enrollmentId]
      );
    }
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteSequence(id) {
  const { rows } = await db.query('DELETE FROM crm_sequences WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

async function enrollList(sequenceId, listId) {
  const [sequenceResult, list] = await Promise.all([
    db.query(
      `SELECT s.id, st.id AS step_id, st.template_id, st.delay_minutes
       FROM crm_sequences s
       JOIN crm_sequence_steps st ON st.sequence_id = s.id AND st.position = 0
       WHERE s.id = $1 AND s.active = TRUE`,
      [sequenceId]
    ),
    getList(listId),
  ]);
  const firstStep = sequenceResult.rows[0];
  if (!firstStep || !list) return null;
  const compiled = compileListFilter(list);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const contacts = await client.query(
      `SELECT c.id FROM crm_contacts c
       WHERE ${compiled.clause} AND c.email_normalized IS NOT NULL AND c.email_status = 'subscribed'`,
      compiled.values
    );
    const enrolled = await enrollContacts(client, sequenceId, firstStep, contacts.rows);
    await client.query('COMMIT');
    return { enrolled, eligible: contacts.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function enrollContacts(client, sequenceId, firstStep, contacts) {
  let enrolled = 0;
  for (const contact of contacts) {
    const enrollment = await client.query(
      `INSERT INTO crm_sequence_enrollments (sequence_id,contact_id,next_run_at)
       VALUES ($1,$2,now() + ($3 * interval '1 minute'))
       ON CONFLICT (sequence_id,contact_id) DO NOTHING RETURNING *`,
      [sequenceId, contact.id, firstStep.delay_minutes]
    );
    if (!enrollment.rows[0]) continue;
    await client.query(
      `INSERT INTO crm_email_jobs
       (kind,enrollment_id,sequence_step_id,contact_id,template_id,scheduled_at)
       VALUES ('sequence',$1,$2,$3,$4,$5)`,
      [enrollment.rows[0].id, firstStep.step_id, contact.id, firstStep.template_id,
       enrollment.rows[0].next_run_at]
    );
    enrolled += 1;
  }
  return enrolled;
}

async function processSequenceTriggers() {
  const { rows: sequences } = await db.query(
    `SELECT s.id,s.trigger_started_at,s.trigger_conditions,l.id AS list_id,l.filter_json,
            st.id AS step_id,st.template_id,st.delay_minutes
     FROM crm_sequences s
     JOIN crm_lists l ON l.id=s.trigger_list_id
     JOIN crm_sequence_steps st ON st.sequence_id=s.id AND st.position=0
     WHERE s.active=TRUE AND s.trigger_type='list_joined'`
  );
  let enrolled = 0;
  for (const sequence of sequences) {
    const compiled = compileListFilter({ id: sequence.list_id, filter_json: sequence.filter_json || {} });
    const conditionFilter = compileSequenceConditions(
      sequence.trigger_conditions || [],
      compiled.values.length + 1
    );
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT c.id,c.email_normalized,c.email_status,(${conditionFilter.clause}) AS matches_conditions
         FROM crm_contacts c WHERE ${compiled.clause}`,
        [...compiled.values, ...conditionFilter.values]
      );
      const currentIds = current.rows.map((contact) => contact.id);
      const previous = currentIds.length ? await client.query(
        `SELECT contact_id,is_member FROM crm_sequence_trigger_state
         WHERE sequence_id=$1 AND contact_id=ANY($2::uuid[])`,
        [sequence.id, currentIds]
      ) : { rows: [] };
      const activeBefore = new Set(previous.rows.filter((item) => item.is_member).map((item) => item.contact_id));
      const entered = current.rows.filter((contact) => !activeBefore.has(contact.id)
        && contact.matches_conditions && contact.email_normalized && contact.email_status === 'subscribed');
      if (currentIds.length) {
        await client.query(
          `INSERT INTO crm_sequence_trigger_state (sequence_id,contact_id,is_member)
           SELECT $1,contact_id,TRUE FROM unnest($2::uuid[]) AS contact_id
           ON CONFLICT (sequence_id,contact_id) DO UPDATE
           SET is_member=TRUE,observed_at=now()`,
          [sequence.id, currentIds]
        );
      }
      await client.query(
        `UPDATE crm_sequence_trigger_state SET is_member=FALSE,observed_at=now()
         WHERE sequence_id=$1 AND is_member=TRUE
           AND NOT (contact_id=ANY($2::uuid[]))`,
        [sequence.id, currentIds]
      );
      enrolled += await enrollContacts(client, sequence.id, sequence, entered);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return { enrolled };
}

async function createCampaign(input) {
  const list = await getList(input.listId);
  const template = await getTemplate(input.templateId);
  if (!list || !template) return null;
  const compiled = compileListFilter(list);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const campaignResult = await client.query(
      `INSERT INTO crm_email_campaigns
       (name,list_id,template_id,scheduled_at,created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.name, input.listId, input.templateId, input.scheduledAt, input.createdBy]
    );
    const campaign = campaignResult.rows[0];
    const contacts = await client.query(
      `SELECT c.id FROM crm_contacts c
       WHERE ${compiled.clause} AND c.email_normalized IS NOT NULL AND c.email_status = 'subscribed'`,
      compiled.values
    );
    for (const contact of contacts.rows) {
      await client.query(
        `INSERT INTO crm_email_jobs
         (kind,campaign_id,contact_id,template_id,scheduled_at)
         VALUES ('campaign',$1,$2,$3,$4)`,
        [campaign.id, contact.id, input.templateId, input.scheduledAt]
      );
    }
    const updated = await client.query(
      `UPDATE crm_email_campaigns
       SET total_count=$2,
           status=CASE WHEN $2=0 THEN 'completed' ELSE status END,
           completed_at=CASE WHEN $2=0 THEN now() ELSE completed_at END
       WHERE id=$1 RETURNING *`,
      [campaign.id, contacts.rowCount]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function countEligibleContactsForList(list) {
  const compiled = compileListFilter(list);
  const { rows } = await db.query(
    `SELECT count(*)::int AS count FROM crm_contacts c
     WHERE ${compiled.clause} AND c.email_normalized IS NOT NULL AND c.email_status='subscribed'`,
    compiled.values
  );
  return rows[0].count;
}

async function listCampaigns() {
  const { rows } = await db.query(
    `SELECT c.*, l.name AS list_name, t.name AS template_name
     FROM crm_email_campaigns c
     LEFT JOIN crm_lists l ON l.id = c.list_id
     LEFT JOIN crm_email_templates t ON t.id = c.template_id
     ORDER BY c.created_at DESC LIMIT 100`
  );
  return rows;
}

async function listCampaignJobs(campaignId, { limit = 250, offset = 0 } = {}) {
  const [items, count] = await Promise.all([
    db.query(
      `SELECT j.id,j.status,j.attempts,j.scheduled_at,j.sent_at,j.last_error,j.provider_message_id,
              c.id AS contact_id,c.first_name,c.last_name,c.email
       FROM crm_email_jobs j
       JOIN crm_contacts c ON c.id=j.contact_id
       WHERE j.campaign_id=$1
       ORDER BY j.created_at ASC LIMIT $2 OFFSET $3`,
      [campaignId, limit, offset]
    ),
    db.query('SELECT count(*)::int AS count FROM crm_email_jobs WHERE campaign_id=$1', [campaignId]),
  ]);
  return { jobs: items.rows, total: count.rows[0].count };
}

async function claimDueJob() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT j.*, c.first_name, c.last_name, c.email, c.phone, c.source, c.tags, c.custom_fields,
              t.subject, t.preheader, t.html_body, t.text_body,
              st.position AS step_position, st.sequence_id
       FROM crm_email_jobs j
       JOIN crm_contacts c ON c.id = j.contact_id
       JOIN crm_email_templates t ON t.id = j.template_id
       LEFT JOIN crm_sequence_steps st ON st.id = j.sequence_step_id
       LEFT JOIN crm_sequences s ON s.id = st.sequence_id
       LEFT JOIN crm_sequence_enrollments e ON e.id = j.enrollment_id
       WHERE j.status = 'pending' AND j.scheduled_at <= now()
         AND (j.kind = 'campaign' OR (s.active = TRUE AND e.status = 'active'))
       ORDER BY j.scheduled_at ASC
       LIMIT 1 FOR UPDATE OF j SKIP LOCKED`
    );
    const job = result.rows[0];
    if (!job) {
      await client.query('COMMIT');
      return null;
    }
    const claim = await client.query(
      `UPDATE crm_email_jobs
       SET status='sending', attempts=attempts+1,claimed_at=now(),claim_token=gen_random_uuid()
       WHERE id=$1 RETURNING claim_token,claimed_at`,
      [job.id]
    );
    if (job.campaign_id) {
      await client.query(
        `UPDATE crm_email_campaigns SET status='running'
         WHERE id=$1 AND status='queued'`,
        [job.campaign_id]
      );
    }
    await client.query('COMMIT');
    return {
      ...job,
      status: 'sending',
      attempts: job.attempts + 1,
      claim_token: claim.rows[0].claim_token,
      claimed_at: claim.rows[0].claimed_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recoverStaleEmailJobs(timeoutMinutes = 30) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const recovered = await client.query(
      `UPDATE crm_email_jobs SET
         status=CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
         scheduled_at=CASE WHEN attempts >= 3 THEN scheduled_at ELSE now() END,
         last_error='Worker interrupted before delivery confirmation',
         claimed_at=NULL,
         claim_token=NULL
       WHERE status='sending' AND claimed_at < now() - ($1 * interval '1 minute')
       RETURNING campaign_id,enrollment_id,status`,
      [timeoutMinutes]
    );
    for (const job of recovered.rows) {
      if (job.status === 'failed' && job.enrollment_id) {
        await client.query(
          `UPDATE crm_sequence_enrollments
           SET status='failed',next_run_at=NULL,last_error='Worker interrupted before delivery confirmation',
               updated_at=now()
           WHERE id=$1 AND status IN ('active','paused')`,
          [job.enrollment_id]
        );
      }
    }
    const campaignIds = [...new Set(recovered.rows.map((job) => job.campaign_id).filter(Boolean))];
    for (const campaignId of campaignIds) await refreshCampaign(client, campaignId);
    await client.query('COMMIT');
    return recovered.rowCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markJobSent(job, messageId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const marked = await client.query(
      `UPDATE crm_email_jobs SET
         status='sent',provider_message_id=$3,sent_at=now(),last_error=NULL,claimed_at=NULL,claim_token=NULL
       WHERE id=$1 AND claim_token=$2 AND status='sending'`,
      [job.id, job.claim_token, messageId || null]
    );
    if (marked.rowCount !== 1) throw new Error('Email job claim lost before confirmation');
    if (job.campaign_id) await refreshCampaign(client, job.campaign_id);
    if (job.enrollment_id) await advanceEnrollment(client, job);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function advanceEnrollment(client, job) {
  const enrollmentState = await client.query(
    'SELECT status FROM crm_sequence_enrollments WHERE id=$1 FOR UPDATE',
    [job.enrollment_id]
  );
  if (!enrollmentState.rows[0] || enrollmentState.rows[0].status === 'cancelled') return;
  const next = await client.query(
    `SELECT id, template_id, position, delay_minutes
     FROM crm_sequence_steps WHERE sequence_id=$1 AND position > $2
     ORDER BY position ASC LIMIT 1`,
    [job.sequence_id, job.step_position]
  );
  if (!next.rows[0]) {
    await client.query(
      `UPDATE crm_sequence_enrollments
       SET status='completed',current_step=$2,next_run_at=NULL,last_error=NULL,updated_at=now()
       WHERE id=$1`,
      [job.enrollment_id, job.step_position]
    );
    return;
  }
  const step = next.rows[0];
  const enrollment = await client.query(
    `UPDATE crm_sequence_enrollments
     SET current_step=$2,next_run_at=now() + ($3 * interval '1 minute'),last_error=NULL,
         updated_at=now()
     WHERE id=$1 RETURNING next_run_at`,
    [job.enrollment_id, job.step_position, step.delay_minutes]
  );
  await client.query(
    `INSERT INTO crm_email_jobs
     (kind,enrollment_id,sequence_step_id,contact_id,template_id,scheduled_at)
     VALUES ('sequence',$1,$2,$3,$4,$5)
     ON CONFLICT (enrollment_id,sequence_step_id) DO NOTHING`,
    [job.enrollment_id, step.id, job.contact_id, step.template_id, enrollment.rows[0].next_run_at]
  );
}

async function markJobFailed(job, errorMessage) {
  const finalFailure = job.attempts >= 3;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (finalFailure) {
      await client.query(
        `UPDATE crm_email_jobs SET
           status='failed',last_error=$3,claimed_at=NULL,claim_token=NULL
         WHERE id=$1 AND claim_token=$2 AND status='sending'`,
        [job.id, job.claim_token, errorMessage]
      );
      if (job.enrollment_id) {
        await client.query(
          `UPDATE crm_sequence_enrollments
           SET status='failed',next_run_at=NULL,last_error=$2,updated_at=now() WHERE id=$1`,
          [job.enrollment_id, errorMessage]
        );
      }
    } else {
      await client.query(
        `UPDATE crm_email_jobs
         SET status='pending',scheduled_at=now() + (($3 * 5) * interval '1 minute'),last_error=$4,
             claimed_at=NULL,claim_token=NULL
         WHERE id=$1 AND claim_token=$2 AND status='sending'`,
        [job.id, job.claim_token, job.attempts, errorMessage]
      );
    }
    if (job.campaign_id) await refreshCampaign(client, job.campaign_id);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function refreshCampaign(client, campaignId) {
  await client.query(
    `UPDATE crm_email_campaigns c SET
       sent_count = stats.sent,
       failed_count = stats.failed,
       status = CASE
         WHEN stats.pending > 0 THEN 'running'
         WHEN stats.failed > 0 AND stats.sent > 0 THEN 'completed_with_errors'
         WHEN stats.failed > 0 THEN 'failed'
         ELSE 'completed'
       END,
       completed_at = CASE WHEN stats.pending = 0 THEN now() ELSE NULL END
     FROM (
       SELECT campaign_id,
              count(*) FILTER (WHERE status IN ('pending','sending'))::int AS pending,
              count(*) FILTER (WHERE status='sent')::int AS sent,
              count(*) FILTER (WHERE status='failed')::int AS failed
       FROM crm_email_jobs WHERE campaign_id=$1 GROUP BY campaign_id
     ) stats
     WHERE c.id=stats.campaign_id`,
    [campaignId]
  );
}

async function summary() {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*)::int FROM crm_contacts) AS contacts,
       (SELECT count(*)::int FROM crm_lists) AS lists,
       (SELECT count(*)::int FROM crm_email_templates) AS templates,
       (SELECT count(*)::int FROM crm_sequences WHERE active=TRUE) AS sequences,
       (SELECT count(*)::int FROM crm_email_jobs WHERE status='pending') AS pending_jobs`
  );
  return rows[0];
}

module.exports = {
  compileContactFilters,
  compileListFilter,
  compileSequenceConditions,
  upsertContactWithClient,
  upsertContact,
  listContacts,
  exportContacts,
  getContact,
  getContactProfile,
  updateContact,
  bulkUpdateContacts,
  deleteContact,
  createList,
  updateList,
  listLists,
  getList,
  listContactsForList,
  exportContactsForList,
  importContacts,
  deleteList,
  listContactStatuses,
  createContactStatus,
  deleteContactStatus,
  createTemplate,
  updateTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  createSequence,
  updateSequence,
  setSequenceActive,
  listSequences,
  listSequenceEnrollments,
  setEnrollmentStatus,
  deleteSequence,
  enrollList,
  processSequenceTriggers,
  createCampaign,
  countEligibleContactsForList,
  listCampaigns,
  listCampaignJobs,
  claimDueJob,
  recoverStaleEmailJobs,
  markJobSent,
  markJobFailed,
  summary,
};
