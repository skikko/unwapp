const crypto = require('crypto');
const db = require('../config/db');
const crmRepo = require('../repos/crmRepo');
const crmService = require('./crmService');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isChecked(value) {
  return ['1', 'true', 'yes', 'on', 'accepted', 'accettato'].includes(String(value || '').trim().toLowerCase());
}

function adaptExternalContact(item, receivedAt = new Date()) {
  const names = item.nome_cognome && typeof item.nome_cognome === 'object'
    ? item.nome_cognome : {};
  const fluentPayload = Boolean(item.nome_cognome)
    && Object.prototype.hasOwnProperty.call(item, 'privacy_cookie_consent');
  const marketingConsent = isChecked(item.marketing_consent);
  let emailStatus = item.emailStatus ?? item.email_status;
  if (emailStatus === undefined && fluentPayload) {
    emailStatus = marketingConsent ? 'subscribed' : 'unsubscribed';
  }
  let consentAt = item.consentAt ?? item.consent_at;
  let consentSource = item.consentSource ?? item.consent_source;
  if (marketingConsent) {
    if (consentAt === undefined) consentAt = receivedAt.toISOString();
    if (consentSource === undefined) consentSource = 'fluent-forms';
  }
  const consentProof = item.consentProof && typeof item.consentProof === 'object'
    ? item.consentProof : {};
  return {
    ...item,
    firstName: item.firstName ?? item.first_name ?? names.first_name,
    lastName: item.lastName ?? item.last_name ?? names.last_name,
    contactType: item.contactType ?? item.contact_type ?? item.genitore_studente,
    webinarRegisteredAt: item.webinarRegisteredAt ?? item.webinar_registered_at ?? item.data_scelta,
    listId: item.listId ?? item.list_id,
    listName: item.listName ?? item.list_name,
    emailStatus,
    consentAt: consentAt ?? null,
    consentSource: consentSource ?? null,
    consentProof: fluentPayload ? {
      ...consentProof,
      privacyConsent: isChecked(item.privacy_cookie_consent),
      marketingConsent,
    } : consentProof,
  };
}

function listTarget(item = {}) {
  const listId = String(item.listId || '').trim();
  const listName = String(item.listName || '').trim().slice(0, 120);
  return { listId: listId || null, listName: listName || null };
}

async function ingest({ items, source, apiClient, idempotencyKey }) {
  const prepared = items.map((item) => {
    const adapted = adaptExternalContact(item);
    return {
      contact: crmService.normalizeContact({ ...adapted, source }, { defaultSource: source }),
      list: listTarget(adapted),
    };
  });
  const requestHash = digest(canonicalJson({ source, contacts: items }));
  const idempotencyKeyHash = digest(idempotencyKey);
  const owner = apiClient.id || `legacy:${source}`;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${owner}:${idempotencyKeyHash}`]);
    const existing = await client.query(
      `SELECT request_hash,response_json,status_code
       FROM crm_ingest_requests
       WHERE api_key_id IS NOT DISTINCT FROM $1
         AND legacy_source IS NOT DISTINCT FROM $2
         AND idempotency_key_hash=$3`,
      [apiClient.id, apiClient.id ? null : source, idempotencyKeyHash]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) {
        throw Object.assign(new Error('Idempotency-Key was already used with a different payload'), { status: 409 });
      }
      await client.query('COMMIT');
      return {
        replayed: true,
        statusCode: existing.rows[0].status_code,
        payload: existing.rows[0].response_json,
      };
    }

    await client.query(
      `INSERT INTO crm_ingest_requests
       (api_key_id,legacy_source,idempotency_key_hash,request_hash)
       VALUES ($1,$2,$3,$4)`,
      [apiClient.id, apiClient.id ? null : source, idempotencyKeyHash, requestHash]
    );
    const contacts = [];
    let created = 0;
    let updated = 0;
    let addedToList = 0;
    for (const preparedItem of prepared) {
      const contact = preparedItem.contact;
      const result = await crmRepo.upsertContactWithClient(client, contact, { actor: `api:${apiClient.name}` });
      contacts.push(result.contact);
      if (result.created) created += 1;
      else updated += 1;
      if (preparedItem.list.listId || preparedItem.list.listName) {
        let listId = preparedItem.list.listId;
        if (!listId) {
          const list = await crmRepo.ensureListByNameWithClient(client, preparedItem.list.listName, `api:${apiClient.name}`);
          listId = list.id;
        }
        addedToList += await crmRepo.addContactToListWithClient(
          client,
          listId,
          result.contact.id,
          source,
          `api:${apiClient.name}`
        );
      }
    }
    const payload = { imported: contacts.length, created, updated, addedToList, contacts };
    await client.query(
      `UPDATE crm_ingest_requests SET response_json=$5,status_code=201,completed_at=now()
       WHERE api_key_id IS NOT DISTINCT FROM $1
         AND legacy_source IS NOT DISTINCT FROM $2
         AND idempotency_key_hash=$3 AND request_hash=$4`,
      [apiClient.id, apiClient.id ? null : source, idempotencyKeyHash, requestHash, payload]
    );
    await client.query('COMMIT');
    return { replayed: false, statusCode: 201, payload };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { canonicalJson, adaptExternalContact, ingest };
