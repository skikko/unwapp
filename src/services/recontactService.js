const db = require('../config/db');
const crmRepo = require('../repos/crmRepo');
const crmService = require('./crmService');

const RECONTACT_LIST_NAME = process.env.CRM_RECONTACT_LIST_NAME || 'Da Ricontattare';

function normalizeManualRequest(input = {}) {
  const contact = crmService.normalizeContact({
    firstName: input.firstName ?? input.first_name ?? input.nome,
    lastName: input.lastName ?? input.last_name ?? input.cognome,
    email: input.email,
    phone: input.phone ?? input.telefono,
    source: 'wordpress-recontact',
    utmSource: input.utmSource ?? input.utm_source,
    utmMedium: input.utmMedium ?? input.utm_medium,
    utmCampaign: input.utmCampaign ?? input.utm_campaign,
    utmTerm: input.utmTerm ?? input.utm_term,
    utmContent: input.utmContent ?? input.utm_content,
  }, { defaultSource: 'wordpress-recontact' });
  if (!contact.firstName || !contact.lastName || !contact.email || !contact.phone) {
    throw Object.assign(new Error('Nome, cognome, email e telefono sono obbligatori'), { status: 400 });
  }
  return contact;
}

async function registerManualRequest(input = {}) {
  if (String(input.website || '').trim()) return { success: true, ignored: true };
  const contact = normalizeManualRequest(input);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id FROM crm_contacts WHERE email_normalized=$1 FOR UPDATE',
      [contact.emailNormalized]
    );
    let saved;
    let created = false;
    if (existing.rows[0]) {
      const result = await client.query(
        `UPDATE crm_contacts SET
           first_name=$2,last_name=$3,email=$4,phone=$5,phone_normalized=$6,
           utm_source=COALESCE($7,utm_source),utm_medium=COALESCE($8,utm_medium),
           utm_campaign=COALESCE($9,utm_campaign),utm_term=COALESCE($10,utm_term),
           utm_content=COALESCE($11,utm_content),updated_at=now()
         WHERE id=$1 RETURNING *`,
        [existing.rows[0].id, contact.firstName, contact.lastName, contact.email,
         contact.phone, contact.phoneNormalized, contact.utmSource, contact.utmMedium,
         contact.utmCampaign, contact.utmTerm, contact.utmContent]
      );
      saved = result.rows[0];
    } else {
      const result = await client.query(
        `INSERT INTO crm_contacts
         (first_name,last_name,email,email_normalized,phone,phone_normalized,source,email_status,
          tags,custom_fields,utm_source,utm_medium,utm_campaign,utm_term,utm_content)
         VALUES ($1,$2,$3,$4,$5,$6,'wordpress-recontact','unknown',$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [contact.firstName, contact.lastName, contact.email, contact.emailNormalized,
         contact.phone, contact.phoneNormalized, [], {}, contact.utmSource, contact.utmMedium,
         contact.utmCampaign, contact.utmTerm, contact.utmContent]
      );
      saved = result.rows[0];
      created = true;
    }
    const list = await crmRepo.ensureListByNameWithClient(client, RECONTACT_LIST_NAME, 'public_recontact');
    const membershipAdded = Boolean(await crmRepo.addContactToListWithClient(
      client,
      list.id,
      saved.id,
      'wordpress-recontact',
      'public_recontact'
    ));
    await client.query(
      `INSERT INTO crm_contact_events (contact_id,event_type,event_data,actor)
       VALUES ($1,'recontact_requested',$2,'public_recontact')`,
      [saved.id, {
        listId: list.id,
        listName: RECONTACT_LIST_NAME,
        membershipAdded,
        source: 'wordpress-recontact',
      }]
    );
    await client.query('COMMIT');
    return { success: true, contactId: saved.id, created, membershipAdded };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { normalizeManualRequest, registerManualRequest };
