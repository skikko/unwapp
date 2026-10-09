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
  if (filters.contactType) conditions.push(`c.contact_type = ${add(filters.contactType)}`);
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
  return {
    clause: `EXISTS (
      SELECT 1 FROM crm_list_memberships lm
      WHERE lm.list_id = $${startIndex} AND lm.contact_id = c.id
    )`,
    values: [list.id],
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

function contactFieldValue(contact, field) {
  const values = {
    contactType: contact.contact_type,
    contactStatusId: contact.contact_status_id,
    emailStatus: contact.email_status,
    source: contact.source,
    firstName: contact.first_name,
    lastName: contact.last_name,
    email: contact.email,
    phone: contact.phone,
    tags: contact.tags || [],
    webinarRegisteredAt: contact.webinar_registered_at,
    utmSource: contact.utm_source,
    utmMedium: contact.utm_medium,
    utmCampaign: contact.utm_campaign,
    utmTerm: contact.utm_term,
    utmContent: contact.utm_content,
  };
  return values[field];
}

function hasAutomationValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function automationConditionMatches(contact, condition = {}) {
  const value = contactFieldValue(contact, condition.field);
  if (condition.operator === 'is_set') return hasAutomationValue(value);
  if (condition.operator === 'is_not_set') return !hasAutomationValue(value);
  if (condition.field === 'tags') {
    const tags = Array.isArray(value) ? value : [];
    return condition.operator === 'not_contains'
      ? !tags.includes(condition.value)
      : tags.includes(condition.value);
  }
  const actual = value === undefined || value === null ? '' : String(value);
  const expected = String(condition.value ?? '');
  if (condition.operator === 'not_equals') return actual !== expected;
  if (condition.operator === 'contains') return actual.toLowerCase().includes(expected.toLowerCase());
  if (condition.operator === 'not_contains') return !actual.toLowerCase().includes(expected.toLowerCase());
  if (condition.operator === 'before') return actual && actual < expected;
  if (condition.operator === 'after') return actual && actual > expected;
  return actual === expected;
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
    await runContactSavedAutomationsWithClient(client, result.rows[0].id, actor);
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
  await runContactSavedAutomationsWithClient(client, result.rows[0].id, actor);
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
      await runContactSavedAutomationsWithClient(client, id, actor);
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
    `INSERT INTO crm_lists (name,description,filter_json,is_favorite,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [input.name, input.description || null, {}, input.isFavorite === true, input.createdBy]
  );
  return rows[0];
}

async function updateList(id, input) {
  const { rows } = await db.query(
    `UPDATE crm_lists SET name=$2,description=$3,filter_json=$4,is_favorite=$5,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, input.name, input.description || null, {}, input.isFavorite === true]
  );
  return rows[0] || null;
}

async function setListFavorite(id, isFavorite) {
  const { rows } = await db.query(
    `UPDATE crm_lists SET is_favorite=$2,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, isFavorite]
  );
  return rows[0] || null;
}

async function listLists() {
  const { rows } = await db.query(
    `SELECT l.*, count(lm.contact_id)::int AS contact_count,
            max(lm.created_at) AS last_contact_joined_at
     FROM crm_lists l
     LEFT JOIN crm_list_memberships lm ON lm.list_id=l.id
     GROUP BY l.id
     ORDER BY l.is_favorite DESC,max(lm.created_at) DESC NULLS LAST,l.updated_at DESC`
  );
  return rows;
}

async function getList(id) {
  const { rows } = await db.query('SELECT * FROM crm_lists WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getListByNameWithClient(client, name) {
  const { rows } = await client.query(
    'SELECT * FROM crm_lists WHERE lower(name)=lower($1) LIMIT 1',
    [String(name || '').trim()]
  );
  return rows[0] || null;
}

async function ensureListByNameWithClient(client, name, actor = null) {
  const normalizedName = String(name || '').trim().slice(0, 120);
  if (!normalizedName) throw Object.assign(new Error('List name is required'), { status: 400 });
  const existing = await getListByNameWithClient(client, normalizedName);
  if (existing) return existing;
  const { rows } = await client.query(
    `INSERT INTO crm_lists (name,description,filter_json,created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [normalizedName, null, {}, actor || 'api']
  );
  return rows[0];
}

async function addContactToListWithClient(client, listId, contactId, source = 'api', actor = null) {
  const membership = await client.query(
    `INSERT INTO crm_list_memberships (list_id,contact_id,source)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING contact_id`,
    [listId, contactId, String(source || 'api').slice(0, 80)]
  );
  if (membership.rowCount) {
    await addContactEvent(client, contactId, 'list_joined', { listId, source }, actor);
    await runListJoinedAutomationsWithClient(client, listId, contactId, actor);
  }
  return membership.rowCount;
}

async function addContactToList(listId, contactId, source = 'manual', actor = null) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const list = await client.query('SELECT id FROM crm_lists WHERE id=$1 FOR UPDATE', [listId]);
    if (!list.rows[0]) throw Object.assign(new Error('Target list not found'), { status: 404 });
    const contact = await client.query('SELECT id FROM crm_contacts WHERE id=$1 FOR UPDATE', [contactId]);
    if (!contact.rows[0]) throw Object.assign(new Error('Contact not found'), { status: 404 });
    const added = await addContactToListWithClient(client, listId, contactId, source, actor);
    await client.query('COMMIT');
    return { added };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setContactLists(contactId, listIds = [], actor = null) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const contact = await client.query('SELECT id FROM crm_contacts WHERE id=$1 FOR UPDATE', [contactId]);
    if (!contact.rows[0]) throw Object.assign(new Error('Contact not found'), { status: 404 });
    const targetIds = [...new Set(listIds)];
    if (targetIds.length) {
      const lists = await client.query('SELECT id FROM crm_lists WHERE id=ANY($1::uuid[])', [targetIds]);
      if (lists.rowCount !== targetIds.length) throw Object.assign(new Error('One or more lists were not found'), { status: 404 });
    }
    const current = await client.query('SELECT list_id FROM crm_list_memberships WHERE contact_id=$1', [contactId]);
    const currentIds = new Set(current.rows.map((row) => row.list_id));
    const targetSet = new Set(targetIds);
    for (const listId of targetIds) {
      if (!currentIds.has(listId)) await addContactToListWithClient(client, listId, contactId, 'manual', actor);
    }
    const removeIds = [...currentIds].filter((listId) => !targetSet.has(listId));
    if (removeIds.length) {
      await client.query(
        'DELETE FROM crm_list_memberships WHERE contact_id=$1 AND list_id=ANY($2::uuid[])',
        [contactId, removeIds]
      );
      await addContactEvent(client, contactId, 'list_memberships_removed', { listIds: removeIds }, actor);
    }
    await client.query('COMMIT');
    return { added: targetIds.filter((listId) => !currentIds.has(listId)).length, removed: removeIds.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listContactsForList(list, { limit = 100, offset = 0 } = {}) {
  const [items, count] = await Promise.all([
    db.query(
      `SELECT ${CONTACT_SELECT}, lm.created_at AS list_joined_at
       FROM crm_list_memberships lm
       JOIN crm_contacts c ON c.id=lm.contact_id
       WHERE lm.list_id=$1
       ORDER BY lm.created_at DESC,c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [list.id, limit, offset]
    ),
    db.query('SELECT count(*)::int AS count FROM crm_list_memberships WHERE list_id=$1', [list.id]),
  ]);
  return { contacts: await attachListsToContacts(items.rows), total: count.rows[0].count };
}

async function exportContactsForList(list) {
  const { rows } = await db.query(
    `SELECT ${CONTACT_SELECT}, lm.created_at AS list_joined_at
     FROM crm_list_memberships lm
     JOIN crm_contacts c ON c.id=lm.contact_id
     WHERE lm.list_id=$1
     ORDER BY lm.created_at DESC,c.created_at DESC`,
    [list.id]
  );
  return attachListsToContacts(rows);
}

async function unsubscribeContact(contactId, emailNormalized, actor = 'unsubscribe') {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE crm_contacts SET email_status='unsubscribed',updated_at=now()
       WHERE id=$1 AND email_normalized=$2
       RETURNING id,email,email_normalized,email_status`,
      [contactId, emailNormalized]
    );
    if (rows[0]) {
      await addContactEvent(client, rows[0].id, 'email_unsubscribed', { email: rows[0].email }, actor);
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
        const result = await client.query(
          `INSERT INTO crm_list_memberships (list_id,contact_id,source)
           SELECT $1,contact_id,'bulk' FROM unnest($2::uuid[]) AS contact_id
           ON CONFLICT DO NOTHING RETURNING contact_id`,
          [changes.listId, contactIds]
        );
        membershipChanged = result.rowCount;
        for (const row of result.rows) {
          await addContactEvent(client, row.contact_id, 'list_joined', {
            listId: changes.listId,
            source: 'bulk',
          }, actor);
          await runListJoinedAutomationsWithClient(client, changes.listId, row.contact_id, actor);
        }
      } else {
        const removed = await client.query(
          'DELETE FROM crm_list_memberships WHERE list_id=$1 AND contact_id=ANY($2::uuid[])',
          [changes.listId, contactIds]
        );
        membershipChanged = removed.rowCount;
      }
    }
    await client.query(
      `INSERT INTO crm_contact_events (contact_id,event_type,event_data,actor)
       SELECT contact_id,'bulk_updated',$1::jsonb,$2 FROM unnest($3::uuid[]) AS contact_id`,
      [JSON.stringify(changes), actor, contactIds]
    );
    for (const contactId of contactIds) {
      await runContactSavedAutomationsWithClient(client, contactId, actor);
    }
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
        addedToList += await addContactToListWithClient(client, listId, result.contact.id, 'csv', actor);
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
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const list = await client.query('SELECT id FROM crm_lists WHERE id=$1 FOR UPDATE', [id]);
    if (!list.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const sequences = await client.query(
      `UPDATE crm_sequences SET
         active=FALSE,trigger_type='manual',trigger_list_id=NULL,
         trigger_started_at=NULL,trigger_conditions='[]'::jsonb,updated_at=now()
       WHERE trigger_list_id=$1 RETURNING id`,
      [id]
    );
    if (sequences.rows.length) {
      await client.query(
        'DELETE FROM crm_sequence_trigger_state WHERE sequence_id=ANY($1::uuid[])',
        [sequences.rows.map((sequence) => sequence.id)]
      );
    }
    const { rows } = await client.query('DELETE FROM crm_lists WHERE id=$1 RETURNING id', [id]);
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
  const { rows } = await db.query('DELETE FROM crm_contact_statuses WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}

async function verifyContentFolder(folderId, kind, queryable = db) {
  if (!folderId) return null;
  const { rows } = await queryable.query(
    'SELECT id FROM crm_content_folders WHERE id=$1 AND kind=$2',
    [folderId, kind]
  );
  if (!rows[0]) throw Object.assign(new Error('Content folder not found'), { status: 404 });
  return rows[0];
}

async function listContentFolders(kind = null) {
  const values = kind ? [kind] : [];
  const where = kind ? 'WHERE folder.kind=$1' : '';
  const { rows } = await db.query(
    `SELECT folder.*,
            CASE folder.kind
              WHEN 'template' THEN (SELECT count(*)::int FROM crm_email_templates item WHERE item.folder_id=folder.id)
              ELSE (SELECT count(*)::int FROM crm_sequences item WHERE item.folder_id=folder.id)
            END AS item_count
     FROM crm_content_folders folder
     ${where}
     ORDER BY folder.kind ASC,folder.name ASC`,
    values
  );
  return rows;
}

async function createContentFolder(input) {
  const { rows } = await db.query(
    `INSERT INTO crm_content_folders (kind,name,description,created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.kind, input.name, input.description || null, input.createdBy]
  );
  return rows[0];
}

async function updateContentFolder(id, input) {
  const { rows } = await db.query(
    `UPDATE crm_content_folders SET name=$2,description=$3,updated_at=now()
     WHERE id=$1 AND kind=$4 RETURNING *`,
    [id, input.name, input.description || null, input.kind]
  );
  return rows[0] || null;
}

async function deleteContentFolder(id) {
  const { rows } = await db.query('DELETE FROM crm_content_folders WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}

async function createTemplate(input) {
  await verifyContentFolder(input.folderId, 'template');
  const slug = await uniqueTemplateSlug(input.slug);
  const { rows } = await db.query(
    `INSERT INTO crm_email_templates
       (name,slug,template_type,editor_mode,subject,preheader,html_body,text_body,builder_json,
        description,tags,attachments,folder_id,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
    [input.name, slug, input.templateType, input.editorMode, input.subject, input.preheader || null,
     input.htmlBody, input.textBody || null, input.builderModel, input.description || null, input.tags,
     JSON.stringify(input.attachments || []), input.folderId, input.createdBy]
  );
  return rows[0];
}

async function updateTemplate(id, input) {
  await verifyContentFolder(input.folderId, 'template');
  const slug = await uniqueTemplateSlug(input.slug, id);
  const { rows } = await db.query(
    `UPDATE crm_email_templates SET name=$2,slug=$3,template_type=$4,editor_mode=$5,subject=$6,
       preheader=$7,html_body=$8,text_body=$9,builder_json=$10,description=$11,tags=$12,
       attachments=$13,folder_id=$14,updated_by=$15,version=version+1,updated_at=now()
     WHERE id=$1 AND version=$16 RETURNING *`,
    [id, input.name, slug, input.templateType, input.editorMode, input.subject,
     input.preheader || null, input.htmlBody, input.textBody || null, input.builderModel,
     input.description || null, input.tags, JSON.stringify(input.attachments || []), input.folderId,
     input.updatedBy, input.version]
  );
  if (!rows[0]) {
    const current = await db.query('SELECT version,updated_at,updated_by FROM crm_email_templates WHERE id=$1', [id]);
    if (current.rows[0]) {
      const error = Object.assign(new Error('Template version conflict'), { status: 409 });
      error.detail = current.rows[0];
      throw error;
    }
  }
  return rows[0] || null;
}

async function uniqueTemplateSlug(base, excludedId = null) {
  let candidate = base || 'template';
  let suffix = 2;
  while (true) {
    const { rows } = await db.query(
      'SELECT 1 FROM crm_email_templates WHERE slug=$1 AND ($2::uuid IS NULL OR id<>$2) LIMIT 1',
      [candidate, excludedId]
    );
    if (!rows[0]) return candidate;
    candidate = `${base}-${suffix}`.slice(0, 120);
    suffix += 1;
  }
}

async function listTemplates() {
  const { rows } = await db.query(
    `SELECT template.*,folder.name AS folder_name
     FROM crm_email_templates template
     LEFT JOIN crm_content_folders folder ON folder.id=template.folder_id
     ORDER BY template.updated_at DESC`
  );
  return rows;
}

async function getTemplate(id) {
  const { rows } = await db.query('SELECT * FROM crm_email_templates WHERE id=$1', [id]);
  return rows[0] || null;
}

async function duplicateTemplate(id, createdBy) {
  const { rows } = await db.query(
    `INSERT INTO crm_email_templates
       (name,slug,template_type,editor_mode,subject,preheader,html_body,text_body,builder_json,
        description,tags,attachments,folder_id,created_by,updated_by)
     SELECT name || ' - copia',slug || '-copia-' || left(gen_random_uuid()::text,8),template_type,
       editor_mode,subject,preheader,html_body,text_body,builder_json,description,tags,attachments,folder_id,$2,$2
     FROM crm_email_templates WHERE id=$1
     RETURNING *`,
    [id, createdBy]
  );
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
    await verifyContentFolder(input.folderId, 'sequence', client);
    let triggerList = null;
    if (input.triggerListId) {
      const result = await client.query('SELECT * FROM crm_lists WHERE id=$1', [input.triggerListId]);
      triggerList = result.rows[0];
      if (!triggerList) throw Object.assign(new Error('Trigger list not found'), { status: 404 });
    }
    const sequenceResult = await client.query(
      `INSERT INTO crm_sequences
       (name,description,active,trigger_type,trigger_list_id,trigger_started_at,trigger_conditions,folder_id,created_by)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $4='list_joined' THEN now() ELSE NULL END,$6,$7,$8)
       RETURNING *`,
      [input.name, input.description || null, input.active, input.triggerType,
       input.triggerListId, JSON.stringify(input.triggerConditions), input.folderId, input.createdBy]
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

async function duplicateSequence(id, createdBy) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const source = await client.query('SELECT * FROM crm_sequences WHERE id=$1 FOR UPDATE', [id]);
    if (!source.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const sequenceResult = await client.query(
      `INSERT INTO crm_sequences
       (name,description,active,trigger_type,trigger_list_id,trigger_started_at,trigger_conditions,folder_id,created_by)
       SELECT name || ' - copia',description,FALSE,trigger_type,trigger_list_id,
              CASE WHEN trigger_type='list_joined' THEN now() ELSE NULL END,
              trigger_conditions,folder_id,$2
       FROM crm_sequences WHERE id=$1
       RETURNING *`,
      [id, createdBy]
    );
    const sequence = sequenceResult.rows[0];
    await client.query(
      `INSERT INTO crm_sequence_steps (sequence_id,position,delay_minutes,template_id)
       SELECT $2,position,delay_minutes,template_id
       FROM crm_sequence_steps WHERE sequence_id=$1 ORDER BY position`,
      [id, sequence.id]
    );
    if (sequence.trigger_list_id) {
      const list = await client.query('SELECT * FROM crm_lists WHERE id=$1', [sequence.trigger_list_id]);
      if (list.rows[0]) await seedSequenceTriggerState(client, sequence.id, list.rows[0]);
    }
    await client.query('COMMIT');
    return sequence;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateSequence(id, input, { includeCompletedEnrollments = false } = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM crm_sequences WHERE id=$1 FOR UPDATE', [id]);
    const currentSequence = existing.rows[0];
    if (!currentSequence) {
      await client.query('ROLLBACK');
      return null;
    }
    const enrollment = await client.query(
      'SELECT count(*)::int AS count FROM crm_sequence_enrollments WHERE sequence_id=$1',
      [id]
    );
    const enrollmentCount = enrollment.rows[0].count;
    await verifyContentFolder(input.folderId, 'sequence', client);
    let triggerList = null;
    if (input.triggerListId) {
      const result = await client.query('SELECT * FROM crm_lists WHERE id=$1', [input.triggerListId]);
      triggerList = result.rows[0];
      if (!triggerList) throw Object.assign(new Error('Trigger list not found'), { status: 404 });
    }
    const triggerChanged = currentSequence.trigger_type !== input.triggerType
      || currentSequence.trigger_list_id !== input.triggerListId
      || JSON.stringify(currentSequence.trigger_conditions || []) !== JSON.stringify(input.triggerConditions || []);
    const sequence = await client.query(
      `UPDATE crm_sequences SET
         name=$2,description=$3,active=$4,trigger_type=$5,trigger_list_id=$6,
         trigger_started_at=CASE WHEN $5='list_joined' THEN
           CASE WHEN $8 THEN now() ELSE COALESCE(trigger_started_at,now()) END
         ELSE NULL END,
         trigger_conditions=$7,
         folder_id=$9,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, input.name, input.description || null, input.active, input.triggerType,
       input.triggerListId, JSON.stringify(input.triggerConditions), triggerChanged, input.folderId]
    );
    let addedSteps = false;
    if (enrollmentCount > 0) {
      const existingSteps = await client.query(
        'SELECT id,position FROM crm_sequence_steps WHERE sequence_id=$1 ORDER BY position ASC FOR UPDATE',
        [id]
      );
      if (input.steps.length < existingSteps.rows.length) {
        throw Object.assign(new Error('Cannot remove sequence steps while enrollments exist'), { status: 409 });
      }
      addedSteps = input.steps.length > existingSteps.rows.length;
      for (const [position, step] of input.steps.entries()) {
        const existingStep = existingSteps.rows[position];
        if (existingStep) {
          await client.query(
            `UPDATE crm_sequence_steps SET position=$3,delay_minutes=$4,template_id=$5
             WHERE id=$1 AND sequence_id=$2`,
            [existingStep.id, id, position, step.delayMinutes, step.templateId]
          );
        } else {
          await client.query(
            `INSERT INTO crm_sequence_steps (sequence_id,position,delay_minutes,template_id)
             VALUES ($1,$2,$3,$4)`,
            [id, position, step.delayMinutes, step.templateId]
          );
        }
      }
    } else {
      await client.query('DELETE FROM crm_sequence_steps WHERE sequence_id=$1', [id]);
      for (const [position, step] of input.steps.entries()) {
        await client.query(
          `INSERT INTO crm_sequence_steps (sequence_id,position,delay_minutes,template_id)
           VALUES ($1,$2,$3,$4)`,
          [id, position, step.delayMinutes, step.templateId]
        );
      }
    }
    let resumedEnrollmentCount = 0;
    if (includeCompletedEnrollments && addedSteps) {
      const resumed = await client.query(
        `WITH completed AS (
           SELECT e.id,e.contact_id,e.current_step
           FROM crm_sequence_enrollments e
           WHERE e.sequence_id=$1 AND e.status='completed'
           FOR UPDATE
         ), next_steps AS (
           SELECT completed.id AS enrollment_id,completed.contact_id,
                  step.id AS sequence_step_id,step.template_id,step.delay_minutes
           FROM completed
           JOIN LATERAL (
             SELECT id,template_id,delay_minutes
             FROM crm_sequence_steps
             WHERE sequence_id=$1 AND position > completed.current_step
             ORDER BY position ASC LIMIT 1
           ) step ON TRUE
         ), jobs AS (
           INSERT INTO crm_email_jobs
             (kind,enrollment_id,sequence_step_id,contact_id,template_id,scheduled_at)
           SELECT 'sequence',enrollment_id,sequence_step_id,contact_id,template_id,
                  now() + (delay_minutes * interval '1 minute')
           FROM next_steps
           ON CONFLICT (enrollment_id,sequence_step_id) DO NOTHING
           RETURNING enrollment_id,scheduled_at
         )
         UPDATE crm_sequence_enrollments e
         SET status='active',next_run_at=jobs.scheduled_at,last_error=NULL,updated_at=now()
         FROM jobs
         WHERE e.id=jobs.enrollment_id AND e.status='completed'
         RETURNING e.id`,
        [id]
      );
      resumedEnrollmentCount = resumed.rowCount;
    }
    if (triggerChanged) {
      await client.query('DELETE FROM crm_sequence_trigger_state WHERE sequence_id=$1', [id]);
      if (triggerList) await seedSequenceTriggerState(client, id, triggerList);
    }
    await client.query('COMMIT');
    return { ...sequence.rows[0], resumedEnrollmentCount };
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

async function pauseSequence(id) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const sequence = await client.query(
      'UPDATE crm_sequences SET active=FALSE,updated_at=now() WHERE id=$1 RETURNING *',
      [id]
    );
    if (!sequence.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE crm_sequence_enrollments
       SET status='paused',updated_at=now()
       WHERE sequence_id=$1 AND status='active'`,
      [id]
    );
    await client.query('COMMIT');
    return sequence.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listSequences() {
  const { rows } = await db.query(
    `SELECT s.*,
            l.name AS trigger_list_name,
            folder.name AS folder_name,
            COALESCE(steps.steps, '[]'::jsonb) AS steps,
            COALESCE(stats.enrollment_count, 0)::int AS enrollment_count,
            COALESCE(stats.active_count, 0)::int AS active_count,
            COALESCE(stats.completed_count, 0)::int AS completed_count,
            COALESCE(stats.failed_count, 0)::int AS failed_count
     FROM crm_sequences s
     LEFT JOIN crm_lists l ON l.id = s.trigger_list_id
     LEFT JOIN crm_content_folders folder ON folder.id = s.folder_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
                'id', st.id,
                'position', st.position,
                'delayMinutes', st.delay_minutes,
                'templateId', st.template_id,
                'templateName', t.name
              ) ORDER BY st.position) AS steps
       FROM crm_sequence_steps st
       LEFT JOIN crm_email_templates t ON t.id = st.template_id
       WHERE st.sequence_id = s.id
     ) steps ON TRUE
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS enrollment_count,
              count(*) FILTER (WHERE e.status='active')::int AS active_count,
              count(*) FILTER (WHERE e.status='completed')::int AS completed_count,
              count(*) FILTER (WHERE e.status='failed')::int AS failed_count
       FROM crm_sequence_enrollments e
       WHERE e.sequence_id = s.id
     ) stats ON TRUE
     ORDER BY s.updated_at DESC`
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
    `SELECT s.id,s.trigger_started_at,s.trigger_conditions,l.id AS list_id,
            st.id AS step_id,st.template_id,st.delay_minutes
     FROM crm_sequences s
     JOIN crm_lists l ON l.id=s.trigger_list_id
     JOIN crm_sequence_steps st ON st.sequence_id=s.id AND st.position=0
     WHERE s.active=TRUE AND s.trigger_type='list_joined'`
  );
  let enrolled = 0;
  for (const sequence of sequences) {
    const compiled = compileListFilter({ id: sequence.list_id });
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

async function listEmailJobs(filters = {}, { limit = 100, offset = 0 } = {}) {
  const conditions = [];
  const values = [];
  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.status) conditions.push(`j.status = ${add(filters.status)}`);
  if (filters.kind) conditions.push(`j.kind = ${add(filters.kind)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;
  const [items, count] = await Promise.all([
    db.query(
      `SELECT j.id,j.kind,j.status,j.scheduled_at,j.sent_at,j.attempts,j.provider_message_id,
              j.last_error,j.open_count,j.first_opened_at,j.last_opened_at,
              j.click_count,j.first_clicked_at,j.last_clicked_at,j.created_at,
              c.id AS contact_id,c.first_name,c.last_name,c.email,c.contact_type,c.tags,
              t.name AS template_name,ec.name AS campaign_name,s.name AS sequence_name
       FROM crm_email_jobs j
       JOIN crm_contacts c ON c.id=j.contact_id
       JOIN crm_email_templates t ON t.id=j.template_id
       LEFT JOIN crm_email_campaigns ec ON ec.id=j.campaign_id
       LEFT JOIN crm_sequence_enrollments e ON e.id=j.enrollment_id
       LEFT JOIN crm_sequences s ON s.id=e.sequence_id
       ${where}
       ORDER BY j.created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...values, limit, offset]
    ),
    db.query(`SELECT count(*)::int AS count FROM crm_email_jobs j ${where}`, values),
  ]);
  return { jobs: items.rows, total: count.rows[0].count };
}

function dashboardPeriodStart(period, now = new Date()) {
  const days = period === 'week' ? 7 : period === 'month' ? 30 : null;
  return days ? new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)).toISOString() : null;
}

async function emailDashboard(period = 'all') {
  const periodStart = dashboardPeriodStart(period);
  const values = [periodStart];
  const [summaryResult, favoriteListResult, listResult, tagResult, typeResult, sourceResult, eventResult] = await Promise.all([
    db.query(
      `SELECT
         count(*)::int AS total_jobs,
         count(*) FILTER (WHERE status='pending')::int AS pending_jobs,
         count(*) FILTER (WHERE status='sending')::int AS sending_jobs,
         count(*) FILTER (WHERE status='sent')::int AS sent_jobs,
         count(*) FILTER (WHERE status='failed')::int AS failed_jobs,
         count(*) FILTER (WHERE status='cancelled')::int AS cancelled_jobs,
         count(*) FILTER (WHERE open_count > 0)::int AS opened_jobs,
         COALESCE(sum(open_count),0)::int AS total_opens,
         count(*) FILTER (WHERE click_count > 0)::int AS clicked_jobs,
         COALESCE(sum(click_count),0)::int AS total_clicks,
         (SELECT count(*)::int FROM crm_contacts c
          WHERE $1::timestamptz IS NULL OR c.created_at >= $1) AS contacts,
         (SELECT count(*)::int FROM crm_lists WHERE is_favorite=TRUE) AS favorite_lists
       FROM crm_email_jobs
       WHERE $1::timestamptz IS NULL OR created_at >= $1`,
      values
    ),
    db.query(
      `SELECT l.id,l.name,l.description,
              count(lm.contact_id)::int AS total_contacts,
              count(lm.contact_id) FILTER (
                WHERE $1::timestamptz IS NULL OR lm.created_at >= $1
              )::int AS period_contacts,
              max(lm.created_at) AS last_contact_joined_at
       FROM crm_lists l
       LEFT JOIN crm_list_memberships lm ON lm.list_id=l.id
       WHERE l.is_favorite=TRUE
       GROUP BY l.id,l.name,l.description
       ORDER BY period_contacts DESC,l.name ASC`,
      values
    ),
    db.query(
      `SELECT l.id,l.name,
              count(DISTINCT lm.contact_id) FILTER (
                WHERE $1::timestamptz IS NULL OR lm.created_at >= $1
              )::int AS contacts,
              count(j.id)::int AS email_jobs,
              count(j.id) FILTER (WHERE j.status='sent')::int AS sent_jobs,
              count(j.id) FILTER (WHERE j.status='pending')::int AS pending_jobs,
              count(j.id) FILTER (WHERE j.open_count > 0)::int AS opened_jobs,
              count(j.id) FILTER (WHERE j.click_count > 0)::int AS clicked_jobs
       FROM crm_lists l
       LEFT JOIN crm_list_memberships lm ON lm.list_id=l.id
       LEFT JOIN crm_email_jobs j ON j.contact_id=lm.contact_id
         AND ($1::timestamptz IS NULL OR j.created_at >= $1)
       GROUP BY l.id,l.name
       ORDER BY contacts DESC,l.name ASC LIMIT 25`,
      values
    ),
    db.query(
      `SELECT tag,
              count(DISTINCT c.id) FILTER (
                WHERE $1::timestamptz IS NULL OR c.created_at >= $1
              )::int AS contacts,
              count(j.id)::int AS email_jobs,
              count(j.id) FILTER (WHERE j.open_count > 0)::int AS opened_jobs,
              count(j.id) FILTER (WHERE j.click_count > 0)::int AS clicked_jobs
       FROM crm_contacts c
       CROSS JOIN LATERAL unnest(c.tags) AS tag
       LEFT JOIN crm_email_jobs j ON j.contact_id=c.id
         AND ($1::timestamptz IS NULL OR j.created_at >= $1)
       GROUP BY tag
       HAVING count(DISTINCT c.id) FILTER (
         WHERE $1::timestamptz IS NULL OR c.created_at >= $1
       ) > 0 OR count(j.id) > 0
       ORDER BY contacts DESC,tag ASC LIMIT 25`,
      values
    ),
    db.query(
      `SELECT COALESCE(c.contact_type,'n/a') AS contact_type,
              count(DISTINCT c.id) FILTER (
                WHERE $1::timestamptz IS NULL OR c.created_at >= $1
              )::int AS contacts,
              count(j.id)::int AS email_jobs,
              count(j.id) FILTER (WHERE j.status='sent')::int AS sent_jobs,
              count(j.id) FILTER (WHERE j.open_count > 0)::int AS opened_jobs,
              count(j.id) FILTER (WHERE j.click_count > 0)::int AS clicked_jobs
       FROM crm_contacts c
       LEFT JOIN crm_email_jobs j ON j.contact_id=c.id
         AND ($1::timestamptz IS NULL OR j.created_at >= $1)
       GROUP BY COALESCE(c.contact_type,'n/a')
       HAVING count(DISTINCT c.id) FILTER (
         WHERE $1::timestamptz IS NULL OR c.created_at >= $1
       ) > 0 OR count(j.id) > 0
       ORDER BY contacts DESC`,
      values
    ),
    db.query(
      `SELECT COALESCE(NULLIF(c.source,''),'n/a') AS source,
              count(DISTINCT c.id) FILTER (
                WHERE $1::timestamptz IS NULL OR c.created_at >= $1
              )::int AS contacts,
              count(j.id)::int AS email_jobs,
              count(j.id) FILTER (WHERE j.status='sent')::int AS sent_jobs,
              count(j.id) FILTER (WHERE j.open_count > 0)::int AS opened_jobs,
              count(j.id) FILTER (WHERE j.click_count > 0)::int AS clicked_jobs
       FROM crm_contacts c
       LEFT JOIN crm_email_jobs j ON j.contact_id=c.id
         AND ($1::timestamptz IS NULL OR j.created_at >= $1)
       GROUP BY COALESCE(NULLIF(c.source,''),'n/a')
       HAVING count(DISTINCT c.id) FILTER (
         WHERE $1::timestamptz IS NULL OR c.created_at >= $1
       ) > 0 OR count(j.id) > 0
       ORDER BY contacts DESC,source ASC LIMIT 25`,
      values
    ),
    db.query(
      `SELECT ev.id,ev.event_type,ev.url,ev.created_at,
              c.first_name,c.last_name,c.email,t.name AS template_name
       FROM crm_email_events ev
       JOIN crm_email_jobs j ON j.id=ev.job_id
       JOIN crm_contacts c ON c.id=j.contact_id
       JOIN crm_email_templates t ON t.id=j.template_id
       WHERE $1::timestamptz IS NULL OR ev.created_at >= $1
       ORDER BY ev.created_at DESC LIMIT 25`,
      values
    ),
  ]);
  return {
    period,
    periodStart,
    summary: summaryResult.rows[0],
    favoriteLists: favoriteListResult.rows,
    byList: listResult.rows,
    byTag: tagResult.rows,
    byContactType: typeResult.rows,
    bySource: sourceResult.rows,
    recentEvents: eventResult.rows,
  };
}

async function getRecontactContact({ jobId, email }) {
  if (jobId) {
    const { rows } = await db.query(
      `SELECT c.first_name,c.last_name,c.email,c.phone,t.tags AS template_tags
       FROM crm_email_jobs j
       JOIN crm_contacts c ON c.id=j.contact_id
       LEFT JOIN crm_email_templates t ON t.id=j.template_id
       WHERE j.id=$1`,
      [jobId]
    );
    return rows[0] || null;
  }
  const { rows } = await db.query(
    'SELECT first_name,last_name,email,phone FROM crm_contacts WHERE email_normalized=$1',
    [email]
  );
  return rows[0] || null;
}

async function recordEmailEvent({ jobId, eventType, url = null, userAgent = null, ip = null, listName = null, phone = null, tags = [] }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const job = await client.query('SELECT id,contact_id FROM crm_email_jobs WHERE id=$1 FOR UPDATE', [jobId]);
    if (!job.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `INSERT INTO crm_email_events (job_id,event_type,url,user_agent,ip)
       VALUES ($1,$2,$3,$4,$5)`,
      [jobId, eventType, url || null, userAgent || null, ip || null]
    );
    if (eventType === 'open') {
      await client.query(
        `UPDATE crm_email_jobs
         SET open_count=open_count+1,
             first_opened_at=COALESCE(first_opened_at,now()),
             last_opened_at=now()
         WHERE id=$1`,
        [jobId]
      );
    } else if (eventType === 'click') {
      await client.query(
        `UPDATE crm_email_jobs
         SET click_count=click_count+1,
             first_clicked_at=COALESCE(first_clicked_at,now()),
             last_clicked_at=now()
         WHERE id=$1`,
        [jobId]
      );
    }
    let membershipAdded = false;
    if (listName) {
      if (phone || tags.length) {
        await client.query(
          `UPDATE crm_contacts SET phone=COALESCE($2,phone),
             phone_normalized=COALESCE($2,phone_normalized),
             tags=ARRAY(SELECT DISTINCT unnest(tags || $3::text[])),updated_at=now()
           WHERE id=$1`,
          [job.rows[0].contact_id, phone, tags]
        );
      }
      const list = await ensureListByNameWithClient(client, listName, 'email_recontact');
      membershipAdded = Boolean(await addContactToListWithClient(
        client,
        list.id,
        job.rows[0].contact_id,
        'email_cta',
        'email_recontact'
      ));
      await addContactEvent(client, job.rows[0].contact_id, 'recontact_requested', {
        jobId,
        listId: list.id,
        listName,
        membershipAdded,
        url,
        tags,
      }, 'email_recontact');
    }
    await client.query('COMMIT');
    return { id: jobId, membershipAdded };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordEmailTestRecontact({ email, userAgent = null, ip = null, listName, phone = null, tags = [] }) {
  const emailNormalized = String(email || '').trim().toLowerCase();
  if (!emailNormalized) throw Object.assign(new Error('Email is required'), { status: 400 });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const contact = await upsertContactWithClient(client, {
      firstName: null,
      lastName: null,
      email: emailNormalized,
      emailNormalized,
      phone,
      phoneNormalized: phone,
      source: 'email-test',
      emailStatus: null,
      tags,
      customFields: {},
      consentAt: null,
      consentSource: null,
      consentProof: {},
      contactStatusId: null,
      contactType: null,
      webinarRegisteredAt: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    }, { actor: 'email_test_recontact' });
    const list = await ensureListByNameWithClient(client, listName, 'email_test_recontact');
    const membershipAdded = Boolean(await addContactToListWithClient(
      client,
      list.id,
      contact.contact.id,
      'email_test_cta',
      'email_test_recontact'
    ));
    await addContactEvent(client, contact.contact.id, 'recontact_requested', {
      listId: list.id,
      listName,
      membershipAdded,
      url: '/api/public/recontact-request',
      testEmail: true,
      userAgent,
      ip,
    }, 'email_test_recontact');
    await client.query('COMMIT');
    return { contactId: contact.contact.id, membershipAdded };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function defaultAutomationNotificationBody(automation, contact) {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Senza nome';
  return [
    `Automazione: ${automation.name}`,
    `Contatto: ${name}`,
    `Email: ${contact.email || 'n/a'}`,
    `Telefono: ${contact.phone || 'n/a'}`,
    `Origine: ${contact.source || 'n/a'}`,
  ].join('\n');
}

async function queueAutomationNotificationWithClient(client, automation, action, contact) {
  const body = String(action.body || '').trim() || defaultAutomationNotificationBody(automation, contact);
  await client.query(
    `INSERT INTO crm_automation_notifications
     (automation_id,contact_id,to_email,subject,body)
     VALUES ($1,$2,$3,$4,$5)`,
    [automation.id, contact.id, action.to_email, action.subject, body]
  );
}

async function automationActions(client, automationId) {
  const { rows } = await client.query(
    `SELECT * FROM crm_automation_actions
     WHERE automation_id=$1
     ORDER BY position ASC`,
    [automationId]
  );
  return rows;
}

async function runAutomationActionsWithClient(client, automation, contact, actor = null) {
  const actions = await automationActions(client, automation.id);
  let executed = 0;
  for (const action of actions) {
    if (action.action_type === 'add_to_list' && action.target_list_id) {
      const added = await addContactToListWithClient(
        client,
        action.target_list_id,
        contact.id,
        'automation',
        actor || 'automation'
      );
      executed += added;
      continue;
    }
    if (action.action_type === 'notify_email' && action.to_email) {
      await queueAutomationNotificationWithClient(client, automation, action, contact);
      executed += 1;
    }
  }
  if (executed) {
    await addContactEvent(client, contact.id, 'automation_executed', {
      automationId: automation.id,
      automationName: automation.name,
      triggerType: automation.trigger_type,
      actions: actions.map((action) => action.action_type),
    }, actor || 'automation');
  }
  return executed;
}

async function runContactSavedAutomationsWithClient(client, contactId, actor = null) {
  const contactResult = await client.query(`SELECT ${CONTACT_SELECT} FROM crm_contacts c WHERE c.id=$1`, [contactId]);
  const contact = contactResult.rows[0];
  if (!contact) return 0;
  const automations = await client.query(
    `SELECT * FROM crm_automations
     WHERE active=TRUE AND trigger_type='contact_saved'
     ORDER BY created_at ASC`
  );
  let executed = 0;
  for (const automation of automations.rows) {
    const matches = automationConditionMatches(contact, automation.trigger_condition || {});
    const state = await client.query(
      `SELECT is_match FROM crm_automation_trigger_state
       WHERE automation_id=$1 AND contact_id=$2`,
      [automation.id, contact.id]
    );
    const matchedBefore = Boolean(state.rows[0]?.is_match);
    if (matches && !matchedBefore) {
      executed += await runAutomationActionsWithClient(client, automation, contact, actor);
    }
    await client.query(
      `INSERT INTO crm_automation_trigger_state (automation_id,contact_id,is_match)
       VALUES ($1,$2,$3)
       ON CONFLICT (automation_id,contact_id) DO UPDATE
       SET is_match=$3,observed_at=now()`,
      [automation.id, contact.id, matches]
    );
  }
  return executed;
}

async function runListJoinedAutomationsWithClient(client, listId, contactId, actor = null) {
  const contactResult = await client.query(`SELECT ${CONTACT_SELECT} FROM crm_contacts c WHERE c.id=$1`, [contactId]);
  const contact = contactResult.rows[0];
  if (!contact) return 0;
  const automations = await client.query(
    `SELECT * FROM crm_automations
     WHERE active=TRUE AND trigger_type='list_joined' AND trigger_list_id=$1
     ORDER BY created_at ASC`,
    [listId]
  );
  let executed = 0;
  for (const automation of automations.rows) {
    executed += await runAutomationActionsWithClient(client, automation, contact, actor);
  }
  return executed;
}

async function seedAutomationTriggerState(client, automation) {
  if (automation.trigger_type !== 'contact_saved') return;
  const contacts = await client.query(`SELECT ${CONTACT_SELECT} FROM crm_contacts c`);
  for (const contact of contacts.rows) {
    await client.query(
      `INSERT INTO crm_automation_trigger_state (automation_id,contact_id,is_match)
       VALUES ($1,$2,$3)
       ON CONFLICT (automation_id,contact_id) DO UPDATE
       SET is_match=$3,observed_at=now()`,
      [automation.id, contact.id, automationConditionMatches(contact, automation.trigger_condition || {})]
    );
  }
}

async function writeAutomationActions(client, automationId, actions) {
  await client.query('DELETE FROM crm_automation_actions WHERE automation_id=$1', [automationId]);
  for (const [position, action] of actions.entries()) {
    await client.query(
      `INSERT INTO crm_automation_actions
       (automation_id,position,action_type,target_list_id,to_email,subject,body)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [automationId, position, action.type, action.targetListId || null, action.toEmail || null,
       action.subject || null, action.body || null]
    );
  }
}

async function listAutomations() {
  const { rows } = await db.query(
    `SELECT automation.*,
            trigger_list.name AS trigger_list_name,
            COALESCE(actions.actions, '[]'::jsonb) AS actions,
            COALESCE(stats.notification_count,0)::int AS notification_count,
            COALESCE(stats.sent_notification_count,0)::int AS sent_notification_count
     FROM crm_automations automation
     LEFT JOIN crm_lists trigger_list ON trigger_list.id=automation.trigger_list_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
                'id', action.id,
                'type', action.action_type,
                'targetListId', action.target_list_id,
                'targetListName', target_list.name,
                'toEmail', action.to_email,
                'subject', action.subject,
                'body', action.body
              ) ORDER BY action.position) AS actions
       FROM crm_automation_actions action
       LEFT JOIN crm_lists target_list ON target_list.id=action.target_list_id
       WHERE action.automation_id=automation.id
     ) actions ON TRUE
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS notification_count,
              count(*) FILTER (WHERE status='sent')::int AS sent_notification_count
       FROM crm_automation_notifications notification
       WHERE notification.automation_id=automation.id
     ) stats ON TRUE
     ORDER BY automation.updated_at DESC`
  );
  return rows;
}

async function createAutomation(input) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (input.triggerListId) {
      const list = await client.query('SELECT id FROM crm_lists WHERE id=$1', [input.triggerListId]);
      if (!list.rows[0]) throw Object.assign(new Error('Trigger list not found'), { status: 404 });
    }
    for (const action of input.actions) {
      if (action.targetListId) {
        const list = await client.query('SELECT id FROM crm_lists WHERE id=$1', [action.targetListId]);
        if (!list.rows[0]) throw Object.assign(new Error('Target list not found'), { status: 404 });
      }
    }
    const automation = await client.query(
      `INSERT INTO crm_automations
       (name,description,active,trigger_type,trigger_list_id,trigger_condition,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.name, input.description || null, input.active, input.triggerType, input.triggerListId,
       JSON.stringify(input.triggerCondition || {}), input.createdBy]
    );
    await writeAutomationActions(client, automation.rows[0].id, input.actions);
    await seedAutomationTriggerState(client, automation.rows[0]);
    await client.query('COMMIT');
    return automation.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateAutomation(id, input) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM crm_automations WHERE id=$1 FOR UPDATE', [id]);
    if (!current.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    if (input.triggerListId) {
      const list = await client.query('SELECT id FROM crm_lists WHERE id=$1', [input.triggerListId]);
      if (!list.rows[0]) throw Object.assign(new Error('Trigger list not found'), { status: 404 });
    }
    for (const action of input.actions) {
      if (action.targetListId) {
        const list = await client.query('SELECT id FROM crm_lists WHERE id=$1', [action.targetListId]);
        if (!list.rows[0]) throw Object.assign(new Error('Target list not found'), { status: 404 });
      }
    }
    const triggerChanged = current.rows[0].trigger_type !== input.triggerType
      || current.rows[0].trigger_list_id !== input.triggerListId
      || JSON.stringify(current.rows[0].trigger_condition || {}) !== JSON.stringify(input.triggerCondition || {});
    const automation = await client.query(
      `UPDATE crm_automations SET
         name=$2,description=$3,active=$4,trigger_type=$5,trigger_list_id=$6,
         trigger_condition=$7,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, input.name, input.description || null, input.active, input.triggerType, input.triggerListId,
       JSON.stringify(input.triggerCondition || {})]
    );
    await writeAutomationActions(client, id, input.actions);
    if (triggerChanged) {
      await client.query('DELETE FROM crm_automation_trigger_state WHERE automation_id=$1', [id]);
      await seedAutomationTriggerState(client, automation.rows[0]);
    }
    await client.query('COMMIT');
    return automation.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setAutomationActive(id, active) {
  const { rows } = await db.query(
    'UPDATE crm_automations SET active=$2,updated_at=now() WHERE id=$1 RETURNING *',
    [id, Boolean(active)]
  );
  return rows[0] || null;
}

async function deleteAutomation(id) {
  const { rows } = await db.query('DELETE FROM crm_automations WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}

async function claimDueAutomationNotification() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT notification.*, contact.first_name, contact.last_name, contact.email, contact.phone,
              contact.source, automation.name AS automation_name
       FROM crm_automation_notifications notification
       JOIN crm_contacts contact ON contact.id=notification.contact_id
       JOIN crm_automations automation ON automation.id=notification.automation_id
       WHERE notification.status='pending' AND notification.scheduled_at <= now()
       ORDER BY notification.scheduled_at ASC
       LIMIT 1 FOR UPDATE OF notification SKIP LOCKED`
    );
    const notification = result.rows[0];
    if (!notification) {
      await client.query('COMMIT');
      return null;
    }
    const claim = await client.query(
      `UPDATE crm_automation_notifications
       SET status='sending',attempts=attempts+1,claimed_at=now(),claim_token=gen_random_uuid()
       WHERE id=$1 RETURNING claim_token,claimed_at`,
      [notification.id]
    );
    await client.query('COMMIT');
    return {
      ...notification,
      status: 'sending',
      attempts: notification.attempts + 1,
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

async function markAutomationNotificationSent(notification, messageId) {
  const { rowCount } = await db.query(
    `UPDATE crm_automation_notifications SET
       status='sent',provider_message_id=$3,sent_at=now(),last_error=NULL,claimed_at=NULL,claim_token=NULL
     WHERE id=$1 AND claim_token=$2 AND status='sending'`,
    [notification.id, notification.claim_token, messageId || null]
  );
  if (rowCount !== 1) throw new Error('Automation notification claim lost before confirmation');
}

async function markAutomationNotificationFailed(notification, errorMessage) {
  const finalFailure = notification.attempts >= 3;
  await db.query(
    `UPDATE crm_automation_notifications SET
       status=$3,
       scheduled_at=CASE WHEN $3='pending' THEN now() + (($4 * 5) * interval '1 minute') ELSE scheduled_at END,
       last_error=$5,
       claimed_at=NULL,
       claim_token=NULL
     WHERE id=$1 AND claim_token=$2 AND status='sending'`,
    [notification.id, notification.claim_token, finalFailure ? 'failed' : 'pending',
     notification.attempts, errorMessage]
  );
}

async function claimDueJob() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT j.*, c.first_name, c.last_name, c.email, c.phone, c.source, c.tags, c.custom_fields,
              t.subject, t.preheader, t.html_body, t.text_body, t.attachments,
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
  setListFavorite,
  listLists,
  getList,
  getListByNameWithClient,
  ensureListByNameWithClient,
  addContactToListWithClient,
  addContactToList,
  setContactLists,
  listContactsForList,
  exportContactsForList,
  unsubscribeContact,
  importContacts,
  deleteList,
  listContactStatuses,
  createContactStatus,
  deleteContactStatus,
  listContentFolders,
  createContentFolder,
  updateContentFolder,
  deleteContentFolder,
  createTemplate,
  updateTemplate,
  listTemplates,
  getTemplate,
  duplicateTemplate,
  deleteTemplate,
  createSequence,
  duplicateSequence,
  updateSequence,
  setSequenceActive,
  pauseSequence,
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
  listEmailJobs,
  dashboardPeriodStart,
  emailDashboard,
  recordEmailEvent,
  getRecontactContact,
  recordEmailTestRecontact,
  listAutomations,
  createAutomation,
  updateAutomation,
  setAutomationActive,
  deleteAutomation,
  claimDueAutomationNotification,
  markAutomationNotificationSent,
  markAutomationNotificationFailed,
  claimDueJob,
  recoverStaleEmailJobs,
  markJobSent,
  markJobFailed,
  summary,
};
