const state = {
  user: null,
  contacts: [],
  lists: [],
  templates: [],
  sequences: [],
  campaigns: [],
  emailDashboard: null,
  emailLogs: [],
  contactStatuses: [],
  contactImport: null,
  templateAttachments: [],
  selectedContacts: new Set(),
  selectAllMatching: false,
  totalContacts: 0,
  totalEmailLogs: 0,
};

const $ = (id) => document.getElementById(id);
let savedEditorRange = null;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function can(permission) {
  return state.user?.permissions.includes('*') || state.user?.permissions.includes(permission);
}

function toast(message, type = 'ok') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  document.body.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

async function api(path, options = {}) {
  const headers = options.body instanceof FormData
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers,
    ...options,
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error || `Request failed with status ${response.status}`);
  return payload;
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function statusLabel(status) {
  return {
    unknown: 'Email assente',
    subscribed: 'Iscritto',
    unsubscribed: 'Disiscritto',
    bounced: 'Non recapitabile',
    queued: 'In coda',
    pending: 'In attesa',
    sending: 'Invio in corso',
    sent: 'Inviato',
    running: 'In corso',
    completed: 'Completato',
    completed_with_errors: 'Completato con errori',
    failed: 'Fallito',
    cancelled: 'Annullato',
  }[status] || status;
}

function contactTypeLabel(contactType, fallback = 'n/a') {
  if (contactType === 'parent') return 'Genitore';
  if (contactType === 'student') return 'Studente';
  return fallback;
}

function emailKindLabel(kind) {
  if (kind === 'campaign') return 'Campagna';
  if (kind === 'sequence') return 'Sequenza';
  return kind || 'n/a';
}

function eventTypeLabel(eventType) {
  if (eventType === 'open') return 'Apertura';
  if (eventType === 'click') return 'Click';
  return eventType || 'n/a';
}

function numberValue(value) {
  return Number(value || 0);
}

function percentage(part, total) {
  const base = numberValue(total);
  if (!base) return '0%';
  return `${Math.round((numberValue(part) / base) * 100)}%`;
}

const sequenceConditionFields = {
  contactType: { label: 'Tipo contatto', operators: ['equals', 'not_equals'] },
  contactStatusId: { label: 'Stato contatto', operators: ['equals', 'not_equals'] },
  emailStatus: { label: 'Stato email', operators: ['equals', 'not_equals'] },
  source: { label: 'Origine', operators: ['equals', 'not_equals', 'contains'] },
  firstName: { label: 'Nome', operators: ['equals', 'not_equals', 'contains'] },
  lastName: { label: 'Cognome', operators: ['equals', 'not_equals', 'contains'] },
  email: { label: 'Email', operators: ['equals', 'not_equals', 'contains'] },
  phone: { label: 'Telefono', operators: ['equals', 'not_equals', 'contains'] },
  tags: { label: 'Tag', operators: ['contains', 'not_contains'] },
  webinarRegisteredAt: { label: 'Data iscrizione webinar', operators: ['equals', 'before', 'after', 'is_set', 'is_not_set'] },
  utmSource: { label: 'UTM source', operators: ['equals', 'not_equals', 'contains'] },
  utmMedium: { label: 'UTM medium', operators: ['equals', 'not_equals', 'contains'] },
  utmCampaign: { label: 'UTM campaign', operators: ['equals', 'not_equals', 'contains'] },
  utmTerm: { label: 'UTM term', operators: ['equals', 'not_equals', 'contains'] },
  utmContent: { label: 'UTM content', operators: ['equals', 'not_equals', 'contains'] },
};

const sequenceConditionOperatorLabels = {
  equals: 'è uguale a',
  not_equals: 'è diverso da',
  contains: 'contiene',
  not_contains: 'non contiene',
  before: 'è precedente a',
  after: 'è successiva a',
  is_set: 'è valorizzata',
  is_not_set: 'non è valorizzata',
};

async function loadMe() {
  const { user } = await api('/api/me');
  state.user = user;
  document.querySelectorAll('[data-permission]').forEach((item) => { item.hidden = !can(item.dataset.permission); });
  document.querySelectorAll('[data-write]').forEach((item) => { item.hidden = !can('crm:write'); });
  $('userEmail').innerHTML = `<span>${esc(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
  $('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/login';
  });
}

function currentFilters() {
  const filters = new URLSearchParams();
  if ($('filterQuery').value.trim()) filters.set('query', $('filterQuery').value.trim());
  if ($('filterSource').value.trim()) filters.set('source', $('filterSource').value.trim());
  if ($('filterStatus').value) filters.set('emailStatus', $('filterStatus').value);
  if ($('filterContactStatus').value) filters.set('contactStatusId', $('filterContactStatus').value);
  if ($('filterContactType').value) filters.set('contactType', $('filterContactType').value);
  if ($('filterTags').value.trim()) filters.set('tags', $('filterTags').value.trim());
  return filters;
}

async function loadSummary() {
  const { summary } = await api('/api/crm/summary');
  $('summaryContacts').textContent = summary.contacts;
  $('summaryLists').textContent = summary.lists;
  $('summaryTemplates').textContent = summary.templates;
  $('summaryJobs').textContent = summary.pending_jobs;
}

function dashboardMetric(label, value, detail = '') {
  return `<article><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</article>`;
}

function dashboardTable(headers, rows, emptyMessage) {
  if (!rows.length) return `<div class="crm-empty">${esc(emptyMessage)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

async function loadEmailDashboard() {
  const { dashboard } = await api('/api/crm/email-dashboard');
  state.emailDashboard = dashboard;
  const summary = dashboard.summary || {};
  const sent = numberValue(summary.sent_jobs);
  $('emailDashboardSummary').innerHTML = [
    dashboardMetric('Email totali', numberValue(summary.total_jobs), `${numberValue(summary.pending_jobs)} in attesa`),
    dashboardMetric('Inviate', sent, `${numberValue(summary.failed_jobs)} fallite`),
    dashboardMetric('Aperte', numberValue(summary.opened_jobs), `${percentage(summary.opened_jobs, sent)} sugli invii`),
    dashboardMetric('Click', numberValue(summary.clicked_jobs), `${percentage(summary.clicked_jobs, sent)} sugli invii`),
    dashboardMetric('Eventi', numberValue(summary.total_opens) + numberValue(summary.total_clicks), `${numberValue(summary.total_opens)} aperture, ${numberValue(summary.total_clicks)} click`),
  ].join('');
  $('emailDashboardLists').innerHTML = dashboardTable(['Lista', 'Contatti', 'Email', 'Aperte', 'Click'], (dashboard.byList || []).map((row) => (
    `<tr><td>${esc(row.name)}</td><td>${numberValue(row.contacts)}</td><td>${numberValue(row.email_jobs)}</td><td>${numberValue(row.opened_jobs)}</td><td>${numberValue(row.clicked_jobs)}</td></tr>`
  )), 'Nessun dato per lista.');
  $('emailDashboardTags').innerHTML = dashboardTable(['Tag', 'Contatti', 'Email', 'Aperte', 'Click'], (dashboard.byTag || []).map((row) => (
    `<tr><td>${esc(row.tag)}</td><td>${numberValue(row.contacts)}</td><td>${numberValue(row.email_jobs)}</td><td>${numberValue(row.opened_jobs)}</td><td>${numberValue(row.clicked_jobs)}</td></tr>`
  )), 'Nessun dato per tag.');
  $('emailDashboardContactTypes').innerHTML = dashboardTable(['Tipo', 'Contatti', 'Email', 'Inviate', 'Aperte', 'Click'], (dashboard.byContactType || []).map((row) => (
    `<tr><td>${esc(contactTypeLabel(row.contact_type))}</td><td>${numberValue(row.contacts)}</td><td>${numberValue(row.email_jobs)}</td><td>${numberValue(row.sent_jobs)}</td><td>${numberValue(row.opened_jobs)}</td><td>${numberValue(row.clicked_jobs)}</td></tr>`
  )), 'Nessun dato per tipo contatto.');
  $('emailDashboardEvents').innerHTML = dashboardTable(['Data', 'Evento', 'Contatto', 'Template', 'URL'], (dashboard.recentEvents || []).map((event) => {
    const name = [event.first_name, event.last_name].filter(Boolean).join(' ') || event.email || 'Senza nome';
    return `<tr><td>${esc(new Date(event.created_at).toLocaleString('it-IT'))}</td><td>${esc(eventTypeLabel(event.event_type))}</td><td>${esc(name)}</td><td>${esc(event.template_name || 'n/a')}</td><td>${esc(event.url || 'n/a')}</td></tr>`;
  }), 'Nessun evento email registrato.');
}

function currentEmailLogFilters() {
  const filters = new URLSearchParams({ limit: '100' });
  if ($('emailLogStatus').value) filters.set('status', $('emailLogStatus').value);
  if ($('emailLogKind').value) filters.set('kind', $('emailLogKind').value);
  return filters;
}

async function loadEmailLogs() {
  const { jobs, total } = await api(`/api/crm/email-logs?${currentEmailLogFilters()}`);
  state.emailLogs = jobs;
  state.totalEmailLogs = total;
  $('emailLogsCount').textContent = `${total} ${total === 1 ? 'email' : 'email'}`;
  $('emailLogsBody').innerHTML = jobs.length ? jobs.map((job) => {
    const name = [job.first_name, job.last_name].filter(Boolean).join(' ') || job.email || 'Senza nome';
    const origin = job.campaign_name || job.sequence_name || emailKindLabel(job.kind);
    const opened = job.last_opened_at ? `Ultima ${new Date(job.last_opened_at).toLocaleString('it-IT')}` : 'n/a';
    const clicked = job.last_clicked_at ? `Ultimo ${new Date(job.last_clicked_at).toLocaleString('it-IT')}` : 'n/a';
    return `<tr>
      <td>${job.sent_at ? esc(new Date(job.sent_at).toLocaleString('it-IT')) : esc(new Date(job.scheduled_at).toLocaleString('it-IT'))}</td>
      <td><div class="crm-contact-name"><strong>${esc(name)}</strong><small>${esc(job.email || 'n/a')}</small></div></td>
      <td>${esc(origin)}</td>
      <td>${esc(job.template_name || 'n/a')}</td>
      <td><span class="badge ${job.status === 'sent' ? 'on' : ['failed', 'cancelled'].includes(job.status) ? 'off' : 'warn'}">${esc(statusLabel(job.status))}</span></td>
      <td><strong>${numberValue(job.open_count)}</strong><br><small>${esc(opened)}</small></td>
      <td><strong>${numberValue(job.click_count)}</strong><br><small>${esc(clicked)}</small></td>
      <td>${esc(job.last_error || '')}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8"><div class="crm-empty">Nessuna email corrisponde ai filtri.</div></td></tr>';
}

async function loadContacts() {
  const { contacts, total } = await api(`/api/crm/contacts?${currentFilters()}`);
  state.contacts = contacts;
  state.totalContacts = total;
  state.selectedContacts.clear();
  state.selectAllMatching = false;
  $('contactsCount').textContent = `${total} ${total === 1 ? 'contatto' : 'contatti'}`;
  $('contactsBody').innerHTML = contacts.length ? contacts.map((contact) => {
    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Senza nome';
    const tags = (contact.tags || []).map((tag) => `<span>${esc(tag)}</span>`).join('');
    const lists = (contact.lists || []).map((list) => `<span>${esc(list.name)}</span>`).join('');
    return `<tr>
      ${can('crm:write') ? `<td><input type="checkbox" data-select-contact="${contact.id}" aria-label="Seleziona ${esc(fullName)}"></td>` : '<td hidden></td>'}
      <td><div class="crm-contact-name"><strong>${esc(fullName)}</strong><small>${esc(new Date(contact.created_at).toLocaleDateString('it-IT'))}</small></div></td>
      <td>${esc(contactTypeLabel(contact.contact_type))}</td>
      <td>${esc(contact.email || 'n/a')}</td>
      <td>${esc(contact.phone || 'n/a')}</td>
      <td><span class="crm-source">${esc(contact.source)}</span></td>
      <td>${esc(contact.utm_source || 'n/a')}</td>
      <td><div class="crm-tags">${tags || '<span>n/a</span>'}</div></td>
      <td><div class="crm-lists">${lists || '<span>n/a</span>'}</div></td>
      <td>${esc(contact.contact_status_name || 'n/a')}</td>
      <td><span class="badge ${contact.email_status === 'subscribed' ? 'on' : contact.email_status === 'bounced' ? 'off' : 'warn'}">${esc(statusLabel(contact.email_status))}</span></td>
      <td><div class="row-actions"><button class="secondary" data-view-contact="${contact.id}">Profilo</button>${can('crm:write') ? `<button class="secondary" data-edit-contact="${contact.id}">Modifica</button><button class="danger" data-delete-contact="${contact.id}">Elimina</button>` : ''}</div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="12"><div class="crm-empty">Nessun contatto corrisponde ai filtri.</div></td></tr>';

  document.querySelectorAll('[data-view-contact]').forEach((button) => button.addEventListener('click', () => loadContactProfile(button.dataset.viewContact)));
  document.querySelectorAll('[data-edit-contact]').forEach((button) => button.addEventListener('click', () => editContact(button.dataset.editContact)));
  document.querySelectorAll('[data-delete-contact]').forEach((button) => button.addEventListener('click', () => removeContact(button.dataset.deleteContact)));
  document.querySelectorAll('[data-select-contact]').forEach((checkbox) => checkbox.addEventListener('change', () => {
    state.selectAllMatching = false;
    if (checkbox.checked) state.selectedContacts.add(checkbox.dataset.selectContact);
    else state.selectedContacts.delete(checkbox.dataset.selectContact);
    updateContactSelectionUi();
  }));
  updateContactSelectionUi();
}

function profileSection(title, rows, emptyMessage) {
  return `<section><div class="section-heading compact"><div><h3>${esc(title)}</h3></div></div>${rows || `<div class="crm-empty">${esc(emptyMessage)}</div>`}</section>`;
}

async function loadContactProfile(id) {
  $('contactsListView').hidden = true;
  $('contactProfile').hidden = false;
  $('contactProfileTitle').textContent = 'Profilo contatto';
  $('contactProfileMeta').textContent = 'Caricamento...';
  $('contactProfileSummary').innerHTML = '';
  $('contactProfileSections').innerHTML = '';
  try {
    const profile = await api(`/api/crm/contacts/${id}/profile`);
    const contact = profile.contact;
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Senza nome';
    $('contactProfileTitle').textContent = name;
    $('contactProfileMeta').textContent = `Creato ${new Date(contact.created_at).toLocaleString('it-IT')}`;
    $('contactProfileSummary').innerHTML = `
      <div><span>Email</span><strong>${esc(contact.email || 'n/a')}</strong></div>
      <div><span>Telefono</span><strong>${esc(contact.phone || 'n/a')}</strong></div>
      <div><span>Origine</span><strong>${esc(contact.source)}</strong></div>
      <div><span>Stato email</span><strong>${esc(statusLabel(contact.email_status))}</strong></div>
      <div><span>Stato contatto</span><strong>${esc(contact.contact_status_name || 'n/a')}</strong></div>
      <div><span>Studente/Genitore</span><strong>${esc(contactTypeLabel(contact.contact_type))}</strong></div>
      <div><span>Iscrizione webinar</span><strong>${contact.webinar_registered_at ? esc(new Date(`${contact.webinar_registered_at}T00:00:00`).toLocaleDateString('it-IT')) : 'n/a'}</strong></div>
      <div><span>Liste</span><strong>${esc((contact.lists || []).map((list) => list.name).join(', ') || 'n/a')}</strong></div>
      <div><span>Consenso</span><strong>${contact.consent_at ? esc(new Date(contact.consent_at).toLocaleString('it-IT')) : 'Non registrato'}</strong><small>${esc(contact.consent_source || '')}</small></div>
      <div><span>UTM</span><strong>${esc([contact.utm_source, contact.utm_medium, contact.utm_campaign].filter(Boolean).join(' / ') || 'n/a')}</strong><small>${esc([contact.utm_term, contact.utm_content].filter(Boolean).join(' / '))}</small></div>`;
    const eventRows = profile.events.map((event) => `<tr><td>${esc(new Date(event.created_at).toLocaleString('it-IT'))}</td><td>${esc(event.event_type)}</td><td>${esc(event.actor || 'sistema')}</td><td>${esc(JSON.stringify(event.event_data || {}))}</td></tr>`).join('');
    const messageRows = profile.messages.map((message) => `<tr><td>${esc(new Date(message.created_at).toLocaleString('it-IT'))}</td><td>${esc(message.bot_name)}</td><td>${esc(message.role)}</td><td>${esc(message.content)}</td><td>${esc(message.provider_status || 'n/a')}</td></tr>`).join('');
    const emailRows = profile.emailJobs.map((job) => `<tr><td>${esc(new Date(job.scheduled_at).toLocaleString('it-IT'))}</td><td>${esc(job.campaign_name || job.sequence_name || job.kind)}</td><td>${esc(job.template_name)}</td><td>${esc(statusLabel(job.status))}</td><td>${esc(job.last_error || '')}</td></tr>`).join('');
    const enrollmentRows = profile.enrollments.map((enrollment) => `<tr><td>${esc(enrollment.sequence_name)}</td><td>${esc(enrollmentStatusLabel(enrollment.status))}</td><td>${enrollment.next_run_at ? esc(new Date(enrollment.next_run_at).toLocaleString('it-IT')) : 'n/a'}</td><td>${esc(enrollment.last_error || '')}</td></tr>`).join('');
    $('contactProfileSections').innerHTML = [
      profileSection('Storico', eventRows ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Evento</th><th>Autore</th><th>Dettagli</th></tr></thead><tbody>${eventRows}</tbody></table></div>` : '', 'Nessun evento registrato.'),
      profileSection('Messaggi WhatsApp', messageRows ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>BOT</th><th>Ruolo</th><th>Messaggio</th><th>Consegna</th></tr></thead><tbody>${messageRows}</tbody></table></div>` : '', 'Nessun messaggio associato.'),
      profileSection('Invii email', emailRows ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Invio</th><th>Template</th><th>Stato</th><th>Errore</th></tr></thead><tbody>${emailRows}</tbody></table></div>` : '', 'Nessuna email associata.'),
      profileSection('Sequenze', enrollmentRows ? `<div class="table-wrap"><table><thead><tr><th>Sequenza</th><th>Stato</th><th>Prossima attività</th><th>Errore</th></tr></thead><tbody>${enrollmentRows}</tbody></table></div>` : '', 'Nessuna sequenza associata.'),
    ].join('');
    $('contactProfile').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    $('contactProfileMeta').textContent = '';
    $('contactProfileSections').innerHTML = `<div class="crm-empty">${esc(error.message)}</div>`;
  }
}

function closeContactProfile() {
  $('contactProfile').hidden = true;
  $('contactsListView').hidden = false;
  $('contactProfileTitle').textContent = 'Profilo contatto';
  $('contactProfileMeta').textContent = '';
  $('contactProfileSummary').innerHTML = '';
  $('contactProfileSections').innerHTML = '';
  $('panel-contacts').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateContactSelectionUi() {
  const selected = state.selectAllMatching ? state.totalContacts : state.selectedContacts.size;
  $('contactBulkBar').hidden = !selected;
  $('contactBulkCount').textContent = state.selectAllMatching
    ? `${selected} risultati selezionati`
    : `${selected} ${selected === 1 ? 'contatto selezionato' : 'contatti selezionati'}`;
  $('selectAllFilteredBtn').hidden = state.selectAllMatching || selected === state.totalContacts;
  $('selectPageContacts').checked = Boolean(state.contacts.length)
    && state.contacts.every((contact) => state.selectedContacts.has(contact.id));
  $('selectPageContacts').indeterminate = !state.selectAllMatching && selected > 0 && !$('selectPageContacts').checked;
}

function clearContactSelection() {
  state.selectedContacts.clear();
  state.selectAllMatching = false;
  document.querySelectorAll('[data-select-contact]').forEach((checkbox) => { checkbox.checked = false; });
  $('contactBulkEditor').hidden = true;
  updateContactSelectionUi();
}

function selectAllFilteredContacts() {
  state.selectedContacts.clear();
  state.selectAllMatching = state.totalContacts > 0;
  document.querySelectorAll('[data-select-contact]').forEach((checkbox) => { checkbox.checked = true; });
  updateContactSelectionUi();
}

function openBulkContactEditor() {
  $('contactBulkEditor').reset();
  $('contactBulkScope').textContent = state.selectAllMatching
    ? `La modifica verrà applicata a tutti i ${state.totalContacts} risultati filtrati.`
    : `La modifica verrà applicata a ${state.selectedContacts.size} contatti.`;
  openEditor('contactBulkEditor');
}

async function saveBulkContacts(event) {
  event.preventDefault();
  try {
    const result = await api('/api/crm/contacts/bulk', {
      method: 'PATCH',
      body: JSON.stringify({
        allMatching: state.selectAllMatching,
        ids: [...state.selectedContacts],
        filters: Object.fromEntries(currentFilters()),
        changes: {
          source: $('bulkContactSource').value,
          emailStatus: $('bulkContactStatus').value,
          ...($('bulkContactCrmStatus').value === '__unchanged__' ? {} : { contactStatusId: $('bulkContactCrmStatus').value }),
          addTags: $('bulkContactAddTags').value,
          removeTags: $('bulkContactRemoveTags').value,
          listAction: $('bulkContactListAction').value,
          listId: $('bulkContactList').value,
        },
      }),
    });
    toast(`${result.updated} contatti aggiornati`);
    $('contactBulkEditor').hidden = true;
    await Promise.all([loadContacts(), loadLists(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function downloadCsv(path, fallbackName) {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportFilteredContacts() {
  try {
    await downloadCsv(`/api/crm/contacts/export?${currentFilters()}`, 'contatti-crm.csv');
  } catch (error) {
    toast(error.message, 'err');
  }
}

function downloadContactTemplate() {
  const csv = '\uFEFFemail,telefono,nome,cognome,origine,stato_email,tag,data_iscrizione_webinar,genitore_studente,utm_source,utm_medium,utm_campaign,utm_term,utm_content\n'
    + 'mario.rossi@example.com,+393331234567,Mario,Rossi,evento,subscribed,"newsletter|webinar",15/09/2026,Studente,google,cpc,webinar_settembre,orientamento,annuncio_a\n'
    + 'giulia.bianchi@example.com,+393491234567,Giulia,Bianchi,partner,unknown,lead,16/09/2026,Genitore,meta,social,webinar_settembre,,video\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modello-import-contatti-crm.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function importMapping() {
  return Object.fromEntries([...document.querySelectorAll('[data-import-field]')].map((select) => [
    select.dataset.importField,
    select.value,
  ]));
}

function contactImportFormData() {
  const [file] = $('contactCsvFile').files;
  if (!file) throw new Error('Seleziona un file CSV');
  const form = new FormData();
  form.append('contacts', file);
  form.append('mapping', JSON.stringify(importMapping()));
  form.append('source', $('contactImportSource').value.trim());
  form.append('tags', $('contactImportTags').value.trim());
  form.append('listId', $('contactImportList').value);
  return form;
}

function setContactImportStatus(message = '', type = 'info') {
  const status = $('contactImportStatus');
  status.hidden = !message;
  status.className = `contact-import-status ${type}`;
  status.textContent = message;
}

function setContactImportBusy(busy, operation = 'analysis') {
  $('contactImportEditor').setAttribute('aria-busy', String(busy));
  $('contactCsvDropzone').classList.toggle('is-loading', busy);
  $('previewContactImportBtn').disabled = busy;
  $('runContactImportBtn').disabled = busy || !state.contactImport?.validCount;
  $('previewContactImportBtn').textContent = busy && operation === 'analysis' ? 'Analisi in corso...' : 'Analizza di nuovo';
  $('runContactImportBtn').textContent = busy && operation === 'import' ? 'Importazione in corso...' : 'Importa contatti';
}

function importColumnOptions(headers, selected = '') {
  return `<option value="">Non importare</option>${headers.map((header) => `<option value="${esc(header)}" ${header === selected ? 'selected' : ''}>${esc(header)}</option>`).join('')}`;
}

function renderContactImportPreview(result) {
  state.contactImport = result;
  $('contactImportMapping').hidden = false;
  $('contactImportPreview').hidden = false;
  $('contactImportFilename').textContent = `${result.filename} | separatore ${result.delimiter === 'tab' ? 'tab' : result.delimiter}`;
  document.querySelectorAll('[data-import-field]').forEach((select) => {
    select.innerHTML = importColumnOptions(result.headers, result.mapping[select.dataset.importField]);
  });
  const warnings = [];
  if (!result.mapping.phone) warnings.push('Il CSV non contiene una colonna telefono riconosciuta. I contatti saranno identificati e importati tramite email.');
  if (!result.mapping.email) warnings.push('Il CSV non contiene una colonna email riconosciuta. I contatti saranno identificati e importati tramite telefono.');
  $('contactImportWarnings').hidden = !warnings.length;
  $('contactImportWarnings').innerHTML = warnings.map((warning) => `<div>${esc(warning)}</div>`).join('');
  $('importTotalCount').textContent = result.totalRows;
  $('importValidCount').textContent = result.validCount;
  $('importDuplicateCount').textContent = result.duplicateCount;
  $('importInvalidCount').textContent = result.invalidCount;
  $('contactImportPreviewBody').innerHTML = result.preview.length ? result.preview.map((contact) => `<tr><td>${contact.rowNumber}</td><td>${esc([contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'n/a')}</td><td>${esc(contact.email || 'n/a')}</td><td>${esc(contact.phone || 'n/a')}</td><td>${esc(contactTypeLabel(contact.contactType))}</td><td>${esc(contact.webinarRegisteredAt || 'n/a')}</td><td>${esc(contact.source)}</td><td>${esc((contact.tags || []).join(', ') || 'n/a')}</td></tr>`).join('') : '<tr><td colspan="8">Nessun contatto valido.</td></tr>';
  $('contactImportErrors').hidden = !result.invalid.length;
  $('contactImportErrors').innerHTML = result.invalid.length
    ? `<strong>Righe da correggere</strong><span>${result.invalid.map((item) => `Riga ${item.rowNumber}: ${esc(item.error)}`).join('<br>')}</span>`
    : '';
  $('runContactImportBtn').disabled = !result.validCount;
  setContactImportStatus(
    warnings.length
      ? `Analisi completata con avvisi. ${result.validCount} contatti pronti per l’importazione.`
      : `Analisi completata. ${result.validCount} contatti pronti per l’importazione.`,
    warnings.length ? 'warn' : 'ok'
  );
}

async function previewContactImport() {
  setContactImportBusy(true, 'analysis');
  setContactImportStatus('Caricamento e analisi del CSV in corso...', 'info');
  try {
    const result = await api('/api/crm/contacts/import/preview', { method: 'POST', body: contactImportFormData() });
    renderContactImportPreview(result);
    toast(`${result.validCount} contatti pronti per l’importazione`);
  } catch (error) {
    state.contactImport = null;
    setContactImportStatus(error.message, 'err');
    toast(error.message, 'err');
  } finally {
    setContactImportBusy(false);
  }
}

async function runContactImport(event) {
  event.preventDefault();
  if (!state.contactImport) {
    await previewContactImport();
    return;
  }
  setContactImportBusy(true, 'import');
  setContactImportStatus('Importazione dei contatti in corso...', 'info');
  try {
    const result = await api('/api/crm/contacts/import', { method: 'POST', body: contactImportFormData() });
    $('contactImportEditor').hidden = true;
    toast(`${result.imported} contatti importati: ${result.created} nuovi, ${result.updated} aggiornati`);
    await Promise.all([loadContacts(), loadLists(), loadSummary()]);
  } catch (error) {
    setContactImportStatus(error.message, 'err');
    toast(error.message, 'err');
  } finally {
    setContactImportBusy(false);
  }
}

function resetContactImport(listId = '') {
  $('contactImportEditor').reset();
  $('contactImportSource').value = 'csv';
  $('contactImportMapping').hidden = true;
  $('contactImportPreview').hidden = true;
  $('contactImportPreviewBody').innerHTML = '';
  $('contactImportWarnings').hidden = true;
  $('contactImportWarnings').innerHTML = '';
  $('contactCsvFilename').textContent = 'Nessun file selezionato';
  setContactImportStatus();
  $('runContactImportBtn').disabled = true;
  state.contactImport = null;
  refreshSelects();
  if (listId && state.lists.some((list) => list.id === listId)) $('contactImportList').value = listId;
  openEditor('contactImportEditor');
}

function editContact(id) {
  const contact = state.contacts.find((item) => item.id === id);
  if (!contact) return;
  $('contactId').value = contact.id;
  $('contactFirstName').value = contact.first_name || '';
  $('contactLastName').value = contact.last_name || '';
  $('contactEmail').value = contact.email || '';
  $('contactPhone').value = contact.phone || '';
  $('contactSource').value = contact.source || 'manual';
  $('contactEmailStatus').value = contact.email_status;
  $('contactCrmStatus').value = contact.contact_status_id || '';
  $('contactType').value = contact.contact_type || '';
  $('contactWebinarRegisteredAt').value = contact.webinar_registered_at || '';
  $('contactUtmSource').value = contact.utm_source || '';
  $('contactUtmMedium').value = contact.utm_medium || '';
  $('contactUtmCampaign').value = contact.utm_campaign || '';
  $('contactUtmTerm').value = contact.utm_term || '';
  $('contactUtmContent').value = contact.utm_content || '';
  $('contactTags').value = (contact.tags || []).join(', ');
  $('contactConsentAt').value = contact.consent_at ? localDateTimeValue(new Date(contact.consent_at)) : '';
  $('contactConsentSource').value = contact.consent_source || '';
  $('contactEditorTitle').textContent = 'Modifica contatto';
  $('contactEditor').hidden = false;
  $('contactFirstName').focus();
}

async function removeContact(id) {
  if (!confirm('Eliminare definitivamente il contatto?')) return;
  try {
    await api(`/api/crm/contacts/${id}`, { method: 'DELETE' });
    toast('Contatto eliminato');
    await Promise.all([loadContacts(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function saveContact(event) {
  event.preventDefault();
  const id = $('contactId').value;
  const body = {
    firstName: $('contactFirstName').value,
    lastName: $('contactLastName').value,
    email: $('contactEmail').value,
    phone: $('contactPhone').value,
    source: $('contactSource').value,
    emailStatus: $('contactEmailStatus').value,
    contactStatusId: $('contactCrmStatus').value,
    contactType: $('contactType').value,
    webinarRegisteredAt: $('contactWebinarRegisteredAt').value,
    utmSource: $('contactUtmSource').value,
    utmMedium: $('contactUtmMedium').value,
    utmCampaign: $('contactUtmCampaign').value,
    utmTerm: $('contactUtmTerm').value,
    utmContent: $('contactUtmContent').value,
    tags: $('contactTags').value,
    consentAt: $('contactConsentAt').value ? new Date($('contactConsentAt').value).toISOString() : null,
    consentSource: $('contactConsentSource').value,
  };
  try {
    await api(id ? `/api/crm/contacts/${id}` : '/api/crm/contacts', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    $('contactEditor').hidden = true;
    toast(id ? 'Contatto aggiornato' : 'Contatto creato');
    await Promise.all([loadContacts(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function loadLists() {
  const { lists } = await api('/api/crm/lists');
  state.lists = lists;
  $('listsGrid').innerHTML = lists.length ? lists.map((list) => {
    return `<article class="crm-object-card wide"><div class="crm-object-top"><div><span class="crm-object-kicker">Lista manuale</span><h3>${esc(list.name)}</h3></div><strong class="crm-object-count">${list.contact_count}</strong></div><p>${esc(list.description || 'Aggiungi contatti dalla rubrica o importali da CSV.')}</p><div class="crm-object-meta"><span>${list.contact_count === 1 ? '1 contatto' : `${list.contact_count} contatti`}</span><div class="row-actions"><button class="secondary" data-view-list="${list.id}">Vedi contatti</button><button class="secondary" data-export-list="${list.id}">Esporta CSV</button>${can('crm:write') ? `<button class="secondary" data-edit-list="${list.id}">Modifica</button><button class="secondary" data-import-list="${list.id}">Importa CSV</button><button class="danger" data-delete-list="${list.id}">Elimina</button>` : ''}</div></div><div class="list-contacts" id="listContacts-${list.id}" hidden></div></article>`;
  }).join('') : '<div class="crm-empty-card">Non ci sono liste. Crea una lista e aggiungi i contatti dalla rubrica o tramite CSV.</div>';
  document.querySelectorAll('[data-delete-list]').forEach((button) => button.addEventListener('click', () => removeList(button.dataset.deleteList)));
  document.querySelectorAll('[data-edit-list]').forEach((button) => button.addEventListener('click', () => editList(button.dataset.editList)));
  document.querySelectorAll('[data-view-list]').forEach((button) => button.addEventListener('click', () => loadListContacts(button.dataset.viewList)));
  document.querySelectorAll('[data-export-list]').forEach((button) => button.addEventListener('click', () => exportListContacts(button.dataset.exportList)));
  document.querySelectorAll('[data-import-list]').forEach((button) => button.addEventListener('click', () => {
    changeTab('contacts');
    resetContactImport(button.dataset.importList);
  }));
  refreshSelects();
}

async function loadListContacts(id) {
  const container = $(`listContacts-${id}`);
  if (!container) return;
  if (!container.hidden) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = '<div class="crm-empty">Caricamento contatti...</div>';
  try {
    const { contacts, total } = await api(`/api/crm/lists/${id}/contacts?limit=250`);
    container.innerHTML = contacts.length
      ? `<div class="section-heading compact"><div><h3>Contatti iscritti</h3><span>${total} ${total === 1 ? 'contatto' : 'contatti'}</span></div></div><div class="table-wrap"><table><thead><tr><th>Contatto</th><th>Email</th><th>Telefono</th><th>Origine</th><th>Tag</th><th>Stato</th></tr></thead><tbody>${contacts.map((contact) => {
        const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Senza nome';
        return `<tr><td><div class="crm-contact-name"><strong>${esc(name)}</strong><small>${esc(new Date(contact.created_at).toLocaleDateString('it-IT'))}</small></div></td><td>${esc(contact.email || 'n/a')}</td><td>${esc(contact.phone || 'n/a')}</td><td>${esc(contact.source)}</td><td><div class="crm-tags">${(contact.tags || []).map((tag) => `<span>${esc(tag)}</span>`).join('') || '<span>n/a</span>'}</div></td><td><span class="badge ${contact.email_status === 'subscribed' ? 'on' : contact.email_status === 'bounced' ? 'off' : 'warn'}">${esc(statusLabel(contact.email_status))}</span></td></tr>`;
      }).join('')}</tbody></table></div>`
      : '<div class="crm-empty">Nessun contatto è iscritto a questa lista.</div>';
  } catch (error) {
    container.innerHTML = `<div class="crm-empty">${esc(error.message)}</div>`;
  }
}

async function exportListContacts(id) {
  try {
    await downloadCsv(`/api/crm/lists/${id}/export`, 'contatti-lista.csv');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function saveList(event) {
  event.preventDefault();
  const id = $('listId').value;
  try {
    await api(id ? `/api/crm/lists/${id}` : '/api/crm/lists', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: $('listName').value,
        description: $('listDescription').value,
      }),
    });
    $('listEditor').hidden = true;
    $('listEditor').reset();
    $('listId').value = '';
    toast(id ? 'Lista aggiornata' : 'Lista creata');
    await Promise.all([loadLists(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

function resetListEditor() {
  $('listEditor').reset();
  $('listId').value = '';
  $('listEditorTitle').textContent = 'Nuova lista';
  $('saveListBtn').textContent = 'Crea lista';
  openEditor('listEditor');
}

function editList(id) {
  const list = state.lists.find((item) => item.id === id);
  if (!list) return;
  $('listEditor').reset();
  $('listId').value = list.id;
  $('listName').value = list.name;
  $('listDescription').value = list.description || '';
  $('listEditorTitle').textContent = 'Modifica lista';
  $('saveListBtn').textContent = 'Salva modifiche';
  openEditor('listEditor');
}

async function removeList(id) {
  if (!confirm('Eliminare la lista? I contatti non verranno eliminati.')) return;
  try {
    await api(`/api/crm/lists/${id}`, { method: 'DELETE' });
    toast('Lista eliminata');
    await Promise.all([loadLists(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function loadTemplates() {
  const { templates } = await api('/api/crm/templates');
  state.templates = templates;
  $('templatesGrid').innerHTML = templates.length ? templates.map((template) => {
    const attachmentsCount = (template.attachments || []).length;
    return `<article class="crm-object-card"><div class="crm-object-top"><div><span class="crm-object-kicker">Template email</span><h3>${esc(template.name)}</h3></div><span class="badge">${attachmentsCount ? `${attachmentsCount} allegati` : 'HTML'}</span></div><p><strong>${esc(template.subject)}</strong><small class="template-preheader-copy">${esc(template.preheader || 'Nessun preheader')}</small></p><div class="crm-object-meta"><span>Aggiornato ${esc(new Date(template.updated_at).toLocaleDateString('it-IT'))}</span>${can('crm:write') ? `<div class="row-actions"><button class="secondary" data-edit-template="${template.id}">Apri builder</button><button class="danger" data-delete-template="${template.id}">Elimina</button></div>` : ''}</div></article>`;
  }).join('') : '<div class="crm-empty-card">Non ci sono template email.</div>';
  document.querySelectorAll('[data-edit-template]').forEach((button) => button.addEventListener('click', () => editTemplate(button.dataset.editTemplate)));
  document.querySelectorAll('[data-delete-template]').forEach((button) => button.addEventListener('click', () => removeTemplate(button.dataset.deleteTemplate)));
  refreshSelects();
  renderSequenceSteps();
}

function sampleTemplate(value) {
  const samples = {
    first_name: 'Mario',
    last_name: 'Rossi',
    full_name: 'Mario Rossi',
    email: 'mario.rossi@example.com',
    phone: '+393331234567',
    source: 'newsletter',
  };
  return String(value || '').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key) => esc(samples[key] || `{{${key}}}`));
}

function currentTemplateHtml() {
  if (!$('templateVisual').hidden) $('templateHtml').value = $('templateVisual').innerHTML.trim();
  return $('templateHtml').value.trim();
}

function updateTemplatePreview() {
  const body = sampleTemplate(currentTemplateHtml()) || '<p style="color:#858b9b">Inizia a scrivere per vedere l’anteprima.</p>';
  const preheader = sampleTemplate($('templatePreheader').value);
  $('previewSubject').textContent = sampleTemplate($('templateSubject').value) || 'Oggetto email';
  $('templatePreview').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:28px;background:#f3f4f6;color:#171a23;font-family:Arial,sans-serif}.email{max-width:640px;margin:0 auto;padding:32px;background:#fff;border-radius:14px;box-shadow:0 4px 18px rgba(23,26,35,.08)}img{max-width:100%;height:auto}a{color:#e64a26}.preheader{display:none!important}</style></head><body><span class="preheader">${preheader}</span><main class="email">${body}</main></body></html>`;
  $('templateSaveState').textContent = 'Modifiche non salvate';
}

function setEditorMode(mode) {
  const visual = mode === 'visual';
  if (visual) $('templateVisual').innerHTML = $('templateHtml').value;
  else $('templateHtml').value = $('templateVisual').innerHTML.trim();
  $('templateVisual').hidden = !visual;
  $('templateHtml').hidden = visual;
  $('emailToolbar').hidden = !visual;
  $('emailBlockLibrary').hidden = !visual;
  document.querySelectorAll('[data-editor-mode]').forEach((button) => button.classList.toggle('active', button.dataset.editorMode === mode));
  updateTemplatePreview();
}

function editorRange() {
  const selection = window.getSelection();
  const editor = $('templateVisual');
  let range = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    if (savedEditorRange) range = savedEditorRange.cloneRange();
    else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return { selection, range, editor };
}

function rememberEditorRange() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if ($('templateVisual').contains(range.commonAncestorContainer)) savedEditorRange = range.cloneRange();
}

function selectAfter(node, selection, range) {
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function wrapEditorSelection(tagName, attributes = {}) {
  const context = editorRange();
  if (!context) return;
  const element = document.createElement(tagName);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  if (context.range.collapsed) {
    element.appendChild(document.createTextNode('\u200B'));
  } else {
    element.appendChild(context.range.extractContents());
  }
  context.range.insertNode(element);
  const nextRange = document.createRange();
  nextRange.selectNodeContents(element);
  nextRange.collapse(false);
  context.selection.removeAllRanges();
  context.selection.addRange(nextRange);
}

function insertEditorNode(node) {
  const context = editorRange();
  if (!context) return;
  const lastInserted = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? node.lastChild : node;
  context.range.deleteContents();
  context.range.insertNode(node);
  if (lastInserted) selectAfter(lastInserted, context.selection, context.range);
}

function selectedEditorBlock() {
  const context = editorRange();
  if (!context) return null;
  let node = context.range.startContainer.nodeType === Node.ELEMENT_NODE
    ? context.range.startContainer : context.range.startContainer.parentElement;
  while (node && node.parentElement !== context.editor) node = node.parentElement;
  return node && node !== context.editor ? node : null;
}

function runEditorCommand(command, value = null) {
  $('templateVisual').focus();
  if (command === 'bold') wrapEditorSelection('strong');
  else if (command === 'italic') wrapEditorSelection('em');
  else if (command === 'underline') wrapEditorSelection('u');
  else if (command === 'createLink') wrapEditorSelection('a', { href: value, rel: 'noopener noreferrer' });
  else if (command === 'foreColor') wrapEditorSelection('span', { style: `color:${value}` });
  else if (command === 'insertText') insertEditorNode(document.createTextNode(value));
  else if (command === 'insertHorizontalRule') insertEditorNode(document.createElement('hr'));
  else if (command === 'insertHTML') {
    const template = document.createElement('template');
    template.innerHTML = value;
    insertEditorNode(template.content);
  } else if (command === 'formatBlock') {
    const block = selectedEditorBlock();
    if (block) {
      const replacement = document.createElement(value);
      replacement.innerHTML = block.innerHTML;
      block.replaceWith(replacement);
    }
  } else if (['justifyLeft', 'justifyCenter', 'justifyRight'].includes(command)) {
    const block = selectedEditorBlock();
    if (block) block.style.textAlign = command.replace('justify', '').toLowerCase();
  } else if (['insertUnorderedList', 'insertOrderedList'].includes(command)) {
    const block = selectedEditorBlock();
    if (block) {
      const list = document.createElement(command === 'insertOrderedList' ? 'ol' : 'ul');
      const item = document.createElement('li');
      item.innerHTML = block.innerHTML;
      list.appendChild(item);
      block.replaceWith(list);
    }
  } else if (command === 'removeFormat') {
    const context = editorRange();
    if (context && !context.range.collapsed) {
      const text = document.createTextNode(context.range.toString());
      context.range.deleteContents();
      context.range.insertNode(text);
      selectAfter(text, context.selection, context.range);
    }
  }
  updateTemplatePreview();
  rememberEditorRange();
}

async function uploadTemplateImage(file) {
  const form = new FormData();
  form.append('media', file);
  const { media } = await api('/media/upload/crm', { method: 'POST', body: form });
  runEditorCommand('insertHTML', `<img src="${esc(media.url)}" alt="${esc(media.name)}" style="display:block;max-width:100%;height:auto;margin:18px auto">`);
  toast('Immagine inserita');
}

function normalizeTemplateAttachments(attachments = []) {
  return (attachments || []).map((attachment) => ({
    url: attachment.url,
    name: attachment.name,
    type: attachment.type,
    size: Number(attachment.size || 0),
  })).filter((attachment) => attachment.url && attachment.name);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return 'Dimensione n/a';
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderTemplateAttachments() {
  const container = $('templateAttachments');
  if (!container) return;
  container.innerHTML = state.templateAttachments.length
    ? state.templateAttachments.map((attachment, index) => `<div class="template-attachment"><div><strong>${esc(attachment.name)}</strong><small>${esc(attachment.type || 'file')} - ${esc(formatBytes(attachment.size))}</small></div><button class="secondary" type="button" data-remove-template-attachment="${index}">Rimuovi</button></div>`).join('')
    : '<div class="template-attachment-empty">Nessun allegato aggiunto.</div>';
  document.querySelectorAll('[data-remove-template-attachment]').forEach((button) => button.addEventListener('click', () => {
    state.templateAttachments.splice(Number(button.dataset.removeTemplateAttachment), 1);
    renderTemplateAttachments();
    $('templateSaveState').textContent = 'Modifiche non salvate';
  }));
}

async function uploadTemplateAttachment(file) {
  const form = new FormData();
  form.append('media', file);
  const { media } = await api('/media/upload/crm', { method: 'POST', body: form });
  state.templateAttachments.push({
    url: media.url,
    name: media.name,
    type: media.type,
    size: media.size,
  });
  renderTemplateAttachments();
  $('templateSaveState').textContent = 'Modifiche non salvate';
  toast('Allegato aggiunto');
}

function insertEmailBlock(type) {
  const blocks = {
    header: '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#85294f"><tbody><tr><td style="padding:20px;text-align:center;color:#ffffff"><div style="font-family:Arial,sans-serif;font-size:34px;font-weight:bold;line-height:1">UN</div><div style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;line-height:1.2">UNITED NETWORK</div><div style="font-family:Arial,sans-serif;font-size:9px;line-height:1.4">Empower your talent</div></td></tr></tbody></table>',
    title: '<h2 style="margin:0 0 18px;color:#333333;font-family:Arial,sans-serif;font-size:22px;line-height:1.3;text-align:center">Titolo della sezione</h2>',
    text: '<p style="margin:0 0 16px;color:#333333;font-family:Arial,sans-serif;font-size:15px;line-height:1.6">Scrivi qui il contenuto della tua email.</p>',
    spacer: '<div style="height:24px;line-height:24px">&nbsp;</div>',
    divider: '<hr style="margin:24px 0;border:0;border-top:1px solid #d6d6d6">',
    social: '<p style="margin:0;text-align:center;font-family:Arial,sans-serif;font-size:12px;line-height:1.8"><a href="https://www.facebook.com/unitednetwork.eu" style="color:#85294f;text-decoration:underline">Facebook</a>&nbsp;&nbsp; <a href="https://www.instagram.com/unitednetworkeu" style="color:#85294f;text-decoration:underline">Instagram</a>&nbsp;&nbsp; <a href="https://www.linkedin.com/company/united-network-europa" style="color:#85294f;text-decoration:underline">LinkedIn</a>&nbsp;&nbsp; <a href="https://open.spotify.com/show/1aLlejLxalrKOWcPFmVWjI" style="color:#85294f;text-decoration:underline">Spotify</a></p>',
    footer: '<div style="padding:24px 12px;text-align:center;color:#6b6b6b;font-family:Arial,sans-serif;font-size:11px;line-height:1.6"><strong style="color:#85294f;font-size:22px">UN</strong><br>United Network, Via Parigi 11, 00185 Roma, Italia<br><a href="https://www.unitednetwork.it/" style="color:#85294f;text-decoration:underline">unitednetwork.it</a><br><a href="mailto:info@unitednetwork.it?subject=Disiscrizione" style="color:#85294f;text-decoration:underline">Annulla l’iscrizione</a></div>',
  };
  if (type === 'image') {
    $('templateImageFile').click();
    return;
  }
  if (type === 'button') {
    const label = prompt('Testo del pulsante', 'Scopri di più');
    if (!label) return;
    const href = prompt('URL completo del pulsante', 'https://www.unitednetwork.it/');
    if (!href) return;
    try {
      const url = new URL(href);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol');
      blocks.button = `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px auto"><tbody><tr><td style="background-color:#9b3047;border-radius:3px;text-align:center"><a href="${esc(url.toString())}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;text-decoration:none">${esc(label)}</a></td></tr></tbody></table>`;
    } catch {
      toast('URL non valido', 'err');
      return;
    }
  }
  if (!blocks[type]) return;
  const context = editorRange();
  if (!context) return;
  const template = document.createElement('template');
  template.innerHTML = blocks[type];
  const lastInserted = template.content.lastChild;
  let anchor = context.range.startContainer.nodeType === Node.ELEMENT_NODE
    ? context.range.startContainer : context.range.startContainer.parentElement;
  while (anchor && anchor.parentElement !== context.editor) anchor = anchor.parentElement;
  if (anchor && anchor !== context.editor) anchor.after(template.content);
  else context.range.insertNode(template.content);
  if (lastInserted) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(lastInserted);
    nextRange.collapse(true);
    context.selection.removeAllRanges();
    context.selection.addRange(nextRange);
  }
  updateTemplatePreview();
  rememberEditorRange();
}

function templatePayload() {
  const htmlBody = currentTemplateHtml();
  const temporary = document.createElement('div');
  temporary.innerHTML = htmlBody;
  const textBody = $('templateText').value.trim() || temporary.innerText.trim();
  return {
    name: $('templateName').value,
    subject: $('templateSubject').value,
    preheader: $('templatePreheader').value,
    htmlBody,
    textBody,
    attachments: state.templateAttachments,
  };
}

function editTemplate(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;
  $('templateId').value = template.id;
  $('templateName').value = template.name;
  $('templateSubject').value = template.subject;
  $('templatePreheader').value = template.preheader || '';
  $('templateHtml').value = template.html_body;
  $('templateVisual').innerHTML = template.html_body;
  $('templateText').value = template.text_body || '';
  state.templateAttachments = normalizeTemplateAttachments(template.attachments);
  renderTemplateAttachments();
  savedEditorRange = null;
  $('templateEditorTitle').textContent = 'Modifica template';
  $('templateEditor').hidden = false;
  setEditorMode('visual');
  $('templateSaveState').textContent = `Salvato ${new Date(template.updated_at).toLocaleString('it-IT')}`;
  $('templateName').focus();
}

async function saveTemplate(event) {
  event.preventDefault();
  const id = $('templateId').value;
  try {
    await api(id ? `/api/crm/templates/${id}` : '/api/crm/templates', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(templatePayload()),
    });
    $('templateEditor').hidden = true;
    $('templateEditor').reset();
    $('templateId').value = '';
    state.templateAttachments = [];
    renderTemplateAttachments();
    toast(id ? 'Template aggiornato' : 'Template creato');
    await Promise.all([loadTemplates(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function sendTemplateTest() {
  const to = $('templateTestEmail').value.trim();
  if (!to) {
    toast('Inserisci l’indirizzo destinatario', 'err');
    return;
  }
  $('sendTemplateTestBtn').disabled = true;
  try {
    await api('/api/crm/templates/test', {
      method: 'POST',
      body: JSON.stringify({ ...templatePayload(), to }),
    });
    toast(`Email di test inviata a ${to}`);
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    $('sendTemplateTestBtn').disabled = false;
  }
}

async function removeTemplate(id) {
  if (!confirm('Eliminare il template?')) return;
  try {
    await api(`/api/crm/templates/${id}`, { method: 'DELETE' });
    toast('Template eliminato');
    await Promise.all([loadTemplates(), loadSummary()]);
  } catch (error) {
    toast('Il template è usato da un invio o da una sequenza e non può essere eliminato.', 'err');
  }
}

function templateOptions(selected = '') {
  return state.templates.map((template) => `<option value="${template.id}" ${template.id === selected ? 'selected' : ''}>${esc(template.name)}</option>`).join('');
}

function addSequenceStep(templateId = '', delayMinutes = 0) {
  if (!state.templates.length) {
    toast('Crea prima almeno un template email', 'err');
    return;
  }
  let unit = 'hours';
  let amount = delayMinutes / 60;
  if (delayMinutes > 0 && delayMinutes % 1440 === 0) {
    unit = 'days';
    amount = delayMinutes / 1440;
  } else if (delayMinutes > 0 && delayMinutes % 60 !== 0) {
    unit = 'minutes';
    amount = delayMinutes;
  }
  const row = document.createElement('div');
  row.className = 'sequence-step';
  row.innerHTML = `<div class="sequence-step-marker"><span class="sequence-step-index"></span><i></i></div><div class="sequence-step-content"><label><span>Template email</span><select data-step-template required>${templateOptions(templateId)}</select></label><div class="sequence-delay"><label><span>Attesa prima dell’invio</span><input data-step-delay type="number" min="0" step="1" value="${amount}" /></label><label><span>Unità</span><select data-step-unit><option value="minutes" ${unit === 'minutes' ? 'selected' : ''}>Minuti</option><option value="hours" ${unit === 'hours' ? 'selected' : ''}>Ore</option><option value="days" ${unit === 'days' ? 'selected' : ''}>Giorni</option></select></label></div></div><div class="sequence-step-actions"><button class="secondary" type="button" data-move-step="up">Su</button><button class="secondary" type="button" data-move-step="down">Giù</button><button class="danger" type="button" data-remove-step>Rimuovi</button></div>`;
  row.querySelector('[data-remove-step]').addEventListener('click', () => {
    row.remove();
    renumberSequenceSteps();
  });
  row.querySelectorAll('[data-move-step]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.moveStep === 'up' && row.previousElementSibling) row.before(row.previousElementSibling);
    if (button.dataset.moveStep === 'down' && row.nextElementSibling) row.after(row.nextElementSibling);
    renumberSequenceSteps();
  }));
  row.querySelectorAll('input, select').forEach((input) => input.addEventListener('change', renumberSequenceSteps));
  $('sequenceSteps').appendChild(row);
  renumberSequenceSteps();
}

function renumberSequenceSteps() {
  const rows = [...document.querySelectorAll('.sequence-step')];
  let totalMinutes = 0;
  rows.forEach((row, index) => {
    row.querySelector('.sequence-step-index').textContent = String(index + 1).padStart(2, '0');
    totalMinutes += sequenceStepMinutes(row);
    row.querySelector('[data-move-step="up"]').disabled = index === 0;
    row.querySelector('[data-move-step="down"]').disabled = index === rows.length - 1;
  });
  $('sequenceStepCount').textContent = `${rows.length} ${rows.length === 1 ? 'passaggio' : 'passaggi'}`;
  $('sequenceTotalDuration').textContent = totalMinutes ? `Durata ${formatDuration(totalMinutes)}` : 'Durata immediata';
}

function sequenceStepMinutes(row) {
  const amount = Math.max(0, Math.floor(Number(row.querySelector('[data-step-delay]').value || 0)));
  const unit = row.querySelector('[data-step-unit]').value;
  if (unit === 'days') return amount * 1440;
  if (unit === 'hours') return amount * 60;
  return amount;
}

function formatDuration(minutes) {
  if (!minutes) return 'immediata';
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? 'giorno' : 'giorni'}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'ora' : 'ore'}`;
  return `${minutes} minuti`;
}

function enrollmentStatusLabel(status) {
  return {
    active: 'In corso',
    paused: 'In pausa',
    completed: 'Completata',
    failed: 'Fallita',
    cancelled: 'Annullata',
  }[status] || status;
}

function renderSequenceSteps() {
  document.querySelectorAll('[data-step-template]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = templateOptions(selected);
  });
}

function sequenceConditionFieldOptions(selected = '') {
  return Object.entries(sequenceConditionFields).map(([value, config]) => (
    `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(config.label)}</option>`
  )).join('');
}

function sequenceConditionOperatorOptions(field, selected = '') {
  return sequenceConditionFields[field].operators.map((operator) => (
    `<option value="${operator}" ${operator === selected ? 'selected' : ''}>${esc(sequenceConditionOperatorLabels[operator])}</option>`
  )).join('');
}

function sequenceConditionValueControl(field, value = '') {
  if (field === 'contactType') {
    return `<select data-condition-value><option value="parent" ${value === 'parent' ? 'selected' : ''}>Genitore</option><option value="student" ${value === 'student' ? 'selected' : ''}>Studente</option></select>`;
  }
  if (field === 'contactStatusId') {
    return `<select data-condition-value>${state.contactStatuses.map((status) => `<option value="${status.id}" ${value === status.id ? 'selected' : ''}>${esc(status.name)}</option>`).join('')}</select>`;
  }
  if (field === 'emailStatus') {
    const statuses = [['unknown', 'Email assente'], ['subscribed', 'Iscritto'], ['unsubscribed', 'Disiscritto'], ['bounced', 'Non recapitabile']];
    return `<select data-condition-value>${statuses.map(([status, label]) => `<option value="${status}" ${value === status ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  }
  const type = field === 'webinarRegisteredAt' ? 'date' : 'text';
  return `<input data-condition-value type="${type}" value="${esc(value)}" />`;
}

function syncSequenceCondition(row, condition = {}) {
  const field = row.querySelector('[data-condition-field]').value;
  const operatorSelect = row.querySelector('[data-condition-operator]');
  const operator = sequenceConditionFields[field].operators.includes(condition.operator)
    ? condition.operator
    : sequenceConditionFields[field].operators[0];
  operatorSelect.innerHTML = sequenceConditionOperatorOptions(field, operator);
  const valueWrap = row.querySelector('[data-condition-value-wrap]');
  const noValue = operator === 'is_set' || operator === 'is_not_set';
  valueWrap.hidden = noValue;
  valueWrap.innerHTML = noValue ? '' : `<span>Valore</span>${sequenceConditionValueControl(field, condition.value || '')}`;
}

function addSequenceCondition(condition = {}) {
  if (document.querySelectorAll('.sequence-condition').length >= 10) {
    toast('Puoi aggiungere al massimo 10 condizioni', 'err');
    return;
  }
  const field = sequenceConditionFields[condition.field] ? condition.field : 'contactType';
  const row = document.createElement('div');
  row.className = 'sequence-condition';
  row.innerHTML = `<label><span>Campo</span><select data-condition-field>${sequenceConditionFieldOptions(field)}</select></label><label><span>Operatore</span><select data-condition-operator></select></label><label data-condition-value-wrap></label><button class="danger" type="button" data-remove-condition>Rimuovi</button>`;
  syncSequenceCondition(row, condition);
  row.querySelector('[data-condition-field]').addEventListener('change', () => syncSequenceCondition(row));
  row.querySelector('[data-condition-operator]').addEventListener('change', () => {
    const currentValue = row.querySelector('[data-condition-value]')?.value || '';
    syncSequenceCondition(row, { operator: row.querySelector('[data-condition-operator]').value, value: currentValue });
  });
  row.querySelector('[data-remove-condition]').addEventListener('click', () => row.remove());
  $('sequenceConditions').appendChild(row);
}

function readSequenceConditions() {
  return [...document.querySelectorAll('.sequence-condition')].map((row) => ({
    field: row.querySelector('[data-condition-field]').value,
    operator: row.querySelector('[data-condition-operator]').value,
    value: row.querySelector('[data-condition-value]')?.value || null,
  }));
}

function sequenceConditionSummary(conditions = []) {
  if (!conditions.length) return '';
  return conditions.map((condition) => {
    const field = sequenceConditionFields[condition.field]?.label || condition.field;
    const operator = sequenceConditionOperatorLabels[condition.operator] || condition.operator;
    let value = condition.value;
    if (condition.field === 'contactType') value = contactTypeLabel(value);
    if (condition.field === 'contactStatusId') {
      value = state.contactStatuses.find((status) => status.id === value)?.name || 'stato rimosso';
    }
    return `${esc(field)} ${esc(operator)}${value ? ` ${esc(value)}` : ''}`;
  }).join(' AND ');
}

async function loadSequences() {
  const { sequences } = await api('/api/crm/sequences');
  state.sequences = sequences;
  const listOptions = state.lists.map((list) => `<option value="${list.id}">${esc(list.name)} (${list.contact_count})</option>`).join('');
  $('sequencesGrid').innerHTML = sequences.length ? sequences.map((sequence) => {
    let elapsed = 0;
    const timeline = sequence.steps.map((step, index) => {
      elapsed += step.delayMinutes;
      return `<li><span class="sequence-timeline-index">${String(index + 1).padStart(2, '0')}</span><div><strong>${esc(step.templateName)}</strong><span>${step.delayMinutes ? `Attesa ${formatDuration(step.delayMinutes)}` : 'Invio immediato'} | ${elapsed ? `T+ ${formatDuration(elapsed)}` : 'T+ 0'}</span></div></li>`;
    }).join('');
    const editDisabled = sequence.enrollment_count > 0;
    const automaticTrigger = sequence.trigger_type === 'list_joined';
    const triggerLabel = automaticTrigger
      ? `Contatto entrato nella lista ${esc(sequence.trigger_list_name || 'rimossa')}`
      : 'Iscrizione manuale';
    const conditionsLabel = sequenceConditionSummary(sequence.trigger_conditions || []);
    const manualEnrollment = !automaticTrigger && can('crm:write')
      ? `<select data-enroll-list="${sequence.id}">${listOptions}</select><button data-enroll-sequence="${sequence.id}" ${state.lists.length && sequence.active ? '' : 'disabled'}>Iscrivi lista</button>`
      : '';
    const writeActions = can('crm:write')
      ? `${sequence.active ? `<button class="secondary" data-pause-sequence="${sequence.id}">Pausa</button><button class="secondary" data-toggle-sequence="${sequence.id}" data-active="true">Disattiva</button>` : `<button class="secondary" data-toggle-sequence="${sequence.id}" data-active="false">Riattiva</button>`}<button class="secondary" data-edit-sequence="${sequence.id}" ${editDisabled ? 'disabled' : ''}>Modifica</button><button class="danger" data-delete-sequence="${sequence.id}">Elimina</button>`
      : '';
    return `<article class="crm-object-card wide sequence-card"><div class="crm-object-top"><div><span class="crm-object-kicker">Workflow email</span><h3>${esc(sequence.name)}</h3><p>${esc(sequence.description || 'Nessuna descrizione')}</p></div><span class="badge ${sequence.active ? 'on' : 'off'}">${sequence.active ? 'Attiva' : 'Disattivata'}</span></div><div class="sequence-trigger"><span>Trigger</span><strong>${triggerLabel}${conditionsLabel ? `<small>${conditionsLabel}</small>` : ''}</strong></div><ol class="sequence-timeline">${timeline}</ol><div class="sequence-card-stats"><div><strong>${sequence.steps.length}</strong><span>email</span></div><div><strong>${formatDuration(sequence.steps.reduce((sum, step) => sum + step.delayMinutes, 0))}</strong><span>durata</span></div><div><strong>${sequence.enrollment_count}</strong><span>entrati</span></div><div><strong>${sequence.active_count}</strong><span>in corso</span></div><div><strong>${sequence.completed_count}</strong><span>completati</span></div></div><div class="crm-object-meta"><span>${editDisabled ? 'I passaggi non sono modificabili dopo il primo ingresso.' : 'Workflow modificabile.'}</span><div class="crm-inline-action">${manualEnrollment}<button class="secondary" data-view-sequence-contacts="${sequence.id}">Vedi contatti</button>${writeActions}</div></div><div class="sequence-enrollments" id="sequenceEnrollments-${sequence.id}" hidden></div></article>`;
  }).join('') : '<div class="crm-empty-card">Non ci sono sequenze.</div>';
  document.querySelectorAll('[data-enroll-sequence]').forEach((button) => button.addEventListener('click', () => enrollSequence(button.dataset.enrollSequence)));
  document.querySelectorAll('[data-view-sequence-contacts]').forEach((button) => button.addEventListener('click', () => loadSequenceEnrollments(button.dataset.viewSequenceContacts)));
  document.querySelectorAll('[data-edit-sequence]').forEach((button) => button.addEventListener('click', () => editSequence(button.dataset.editSequence)));
  document.querySelectorAll('[data-toggle-sequence]').forEach((button) => button.addEventListener('click', () => toggleSequence(button.dataset.toggleSequence, button.dataset.active !== 'true')));
  document.querySelectorAll('[data-pause-sequence]').forEach((button) => button.addEventListener('click', () => pauseSequence(button.dataset.pauseSequence)));
  document.querySelectorAll('[data-delete-sequence]').forEach((button) => button.addEventListener('click', () => removeSequence(button.dataset.deleteSequence)));
}

function editSequence(id) {
  const sequence = state.sequences.find((item) => item.id === id);
  if (!sequence || sequence.enrollment_count > 0) return;
  $('sequenceEditor').reset();
  $('sequenceId').value = sequence.id;
  $('sequenceName').value = sequence.name;
  $('sequenceDescription').value = sequence.description || '';
  $('sequenceActive').checked = sequence.active;
  $('sequenceTriggerType').value = sequence.trigger_type || 'manual';
  $('sequenceTriggerList').value = sequence.trigger_list_id || '';
  $('sequenceConditions').innerHTML = '';
  (sequence.trigger_conditions || []).forEach((condition) => addSequenceCondition(condition));
  syncSequenceTriggerFields();
  $('sequenceSteps').innerHTML = '';
  sequence.steps.forEach((step) => addSequenceStep(step.templateId, step.delayMinutes));
  $('sequenceEditorTitle').textContent = 'Modifica sequenza';
  $('saveSequenceBtn').textContent = 'Salva modifiche';
  openEditor('sequenceEditor');
}

async function toggleSequence(id, active) {
  try {
    await api(`/api/crm/sequences/${id}/status`, { method: 'PATCH', body: JSON.stringify({ active }) });
    toast(active ? 'Sequenza attivata' : 'Sequenza disattivata');
    await loadSequences();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function pauseSequence(id) {
  if (!confirm('Mettere in pausa la sequenza e le iscrizioni attive?')) return;
  try {
    await api(`/api/crm/sequences/${id}/pause`, { method: 'POST' });
    toast('Sequenza messa in pausa');
    await loadSequences();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function saveSequence(event) {
  event.preventDefault();
  const steps = [...document.querySelectorAll('.sequence-step')].map((row) => ({
    templateId: row.querySelector('[data-step-template]').value,
    delayMinutes: sequenceStepMinutes(row),
  }));
  const id = $('sequenceId').value;
  try {
    await api(id ? `/api/crm/sequences/${id}` : '/api/crm/sequences', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: $('sequenceName').value,
        description: $('sequenceDescription').value,
        active: $('sequenceActive').checked,
        trigger: {
          type: $('sequenceTriggerType').value,
          listId: $('sequenceTriggerList').value,
          conditions: readSequenceConditions(),
        },
        steps,
      }),
    });
    $('sequenceEditor').hidden = true;
    $('sequenceEditor').reset();
    $('sequenceSteps').innerHTML = '';
    $('sequenceId').value = '';
    toast(id ? 'Sequenza aggiornata' : 'Sequenza creata');
    await Promise.all([loadSequences(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function loadSequenceEnrollments(id) {
  const container = $(`sequenceEnrollments-${id}`);
  if (!container) return;
  if (!container.hidden) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = '<div class="crm-empty">Caricamento contatti...</div>';
  try {
    const { enrollments, total } = await api(`/api/crm/sequences/${id}/enrollments?limit=100`);
    container.innerHTML = enrollments.length
      ? `<div class="section-heading compact"><div><h3>Contatti nell’automazione</h3><span>${total} ${total === 1 ? 'contatto' : 'contatti'}</span></div></div><div class="table-wrap"><table><thead><tr><th>Contatto</th><th>Ingresso</th><th>Stato</th><th>Avanzamento</th><th>Prossima attività</th><th>Azioni</th></tr></thead><tbody>${enrollments.map((enrollment) => {
        const name = [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' ') || enrollment.email || enrollment.phone || 'Senza nome';
        const progress = enrollment.status === 'completed'
          ? `${enrollment.step_count}/${enrollment.step_count}`
          : `${Math.max(0, enrollment.current_step + 1)}/${enrollment.step_count}`;
        const controls = can('crm:write') && ['active', 'paused'].includes(enrollment.status)
          ? `<div class="row-actions"><button class="secondary" data-enrollment-status="${enrollment.status === 'active' ? 'paused' : 'active'}" data-sequence-id="${id}" data-enrollment-id="${enrollment.id}">${enrollment.status === 'active' ? 'Pausa' : 'Riprendi'}</button><button class="danger" data-enrollment-status="cancelled" data-sequence-id="${id}" data-enrollment-id="${enrollment.id}">Annulla</button></div>`
          : 'n/a';
        return `<tr><td><div class="crm-contact-name"><strong>${esc(name)}</strong><small>${esc(enrollment.email || enrollment.phone || 'n/a')}</small></div></td><td>${esc(new Date(enrollment.created_at).toLocaleString('it-IT'))}</td><td><span class="badge ${enrollment.status === 'completed' ? 'on' : ['failed', 'cancelled'].includes(enrollment.status) ? 'off' : 'warn'}">${esc(enrollmentStatusLabel(enrollment.status))}</span></td><td>${progress}</td><td>${enrollment.next_run_at ? esc(new Date(enrollment.next_run_at).toLocaleString('it-IT')) : 'n/a'}</td><td>${controls}</td></tr>`;
      }).join('')}</tbody></table></div>`
      : '<div class="crm-empty">Nessun contatto è ancora entrato nell’automazione.</div>';
    container.querySelectorAll('[data-enrollment-status]').forEach((button) => button.addEventListener('click', () => updateEnrollmentStatus(
      button.dataset.sequenceId,
      button.dataset.enrollmentId,
      button.dataset.enrollmentStatus
    )));
  } catch (error) {
    container.innerHTML = `<div class="crm-empty">${esc(error.message)}</div>`;
  }
}

async function updateEnrollmentStatus(sequenceId, enrollmentId, status) {
  if (status === 'cancelled' && !confirm('Annullare definitivamente questo contatto nella sequenza?')) return;
  try {
    await api(`/api/crm/sequences/${sequenceId}/enrollments/${enrollmentId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    toast(status === 'active' ? 'Iscrizione ripresa' : status === 'paused' ? 'Iscrizione in pausa' : 'Iscrizione annullata');
    await loadSequences();
    await loadSequenceEnrollments(sequenceId);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function enrollSequence(id) {
  const select = document.querySelector(`[data-enroll-list="${id}"]`);
  if (!select?.value) return;
  try {
    const result = await api(`/api/crm/sequences/${id}/enroll`, { method: 'POST', body: JSON.stringify({ listId: select.value }) });
    toast(`${result.enrolled} contatti iscritti alla sequenza`);
    await Promise.all([loadSequences(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function removeSequence(id) {
  if (!confirm('Eliminare la sequenza e le iscrizioni associate?')) return;
  try {
    await api(`/api/crm/sequences/${id}`, { method: 'DELETE' });
    toast('Sequenza eliminata');
    await Promise.all([loadSequences(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

function refreshSelects() {
  $('campaignList').innerHTML = state.lists.map((list) => `<option value="${list.id}">${esc(list.name)} (${list.contact_count})</option>`).join('');
  $('campaignTemplate').innerHTML = templateOptions();
  const importList = $('contactImportList');
  const selectedList = importList.value;
  importList.innerHTML = `<option value="">Nessuna lista</option>${state.lists.map((list) => `<option value="${list.id}">${esc(list.name)} (${list.contact_count})</option>`).join('')}`;
  if (state.lists.some((list) => list.id === selectedList)) importList.value = selectedList;
  const bulkList = $('bulkContactList');
  const selectedBulkList = bulkList.value;
  bulkList.innerHTML = state.lists.map((list) => `<option value="${list.id}">${esc(list.name)} (${list.contact_count})</option>`).join('');
  if (state.lists.some((list) => list.id === selectedBulkList)) bulkList.value = selectedBulkList;
  const triggerList = $('sequenceTriggerList');
  const selectedTriggerList = triggerList.value;
  triggerList.innerHTML = state.lists.map((list) => `<option value="${list.id}">${esc(list.name)} (${list.contact_count})</option>`).join('');
  if (state.lists.some((list) => list.id === selectedTriggerList)) triggerList.value = selectedTriggerList;
  syncSequenceTriggerFields();
}

function refreshContactStatusSelects() {
  const options = state.contactStatuses.map((status) => `<option value="${status.id}">${esc(status.name)}</option>`).join('');
  const configurations = [
    ['filterContactStatus', '<option value="">Tutti</option>'],
    ['contactCrmStatus', '<option value="">Nessuno stato</option>'],
    ['bulkContactCrmStatus', '<option value="__unchanged__">Nessuna modifica</option><option value="">Nessuno stato</option>'],
  ];
  configurations.forEach(([id, prefix]) => {
    const select = $(id);
    const selected = select.value;
    select.innerHTML = `${prefix}${options}`;
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  });
}

async function loadContactStatuses() {
  const { statuses } = await api('/api/crm/contact-statuses');
  state.contactStatuses = statuses;
  refreshContactStatusSelects();
}

function syncSequenceTriggerFields() {
  const automatic = $('sequenceTriggerType').value === 'list_joined';
  $('sequenceTriggerListWrap').hidden = !automatic;
  $('sequenceConditionsWrap').hidden = !automatic;
  $('sequenceTriggerList').required = automatic;
}

async function loadCampaigns() {
  const { campaigns } = await api('/api/crm/campaigns');
  state.campaigns = campaigns;
  $('campaignsGrid').innerHTML = campaigns.length ? campaigns.map((campaign) => {
    const done = campaign.sent_count + campaign.failed_count;
    const percentage = campaign.total_count ? Math.round((done / campaign.total_count) * 100) : 100;
    return `<article class="crm-object-card wide"><div class="crm-object-top"><div><span class="crm-object-kicker">${esc(campaign.list_name || 'Lista rimossa')}</span><h3>${esc(campaign.name)}</h3></div><span class="badge ${campaign.status === 'completed' ? 'on' : campaign.status.includes('failed') || campaign.status === 'failed' ? 'off' : 'warn'}">${esc(statusLabel(campaign.status))}</span></div><p>${esc(campaign.template_name || 'Template rimosso')}</p><div class="crm-progress"><span style="width:${percentage}%"></span></div><div class="crm-object-meta"><span>${campaign.sent_count} inviati, ${campaign.failed_count} falliti, ${campaign.total_count} totali</span><div class="row-actions"><span>${esc(new Date(campaign.scheduled_at).toLocaleString('it-IT'))}</span><button class="secondary" data-view-campaign-jobs="${campaign.id}">Dettagli destinatari</button></div></div><div class="campaign-jobs" id="campaignJobs-${campaign.id}" hidden></div></article>`;
  }).join('') : '<div class="crm-empty-card">Non ci sono invii email.</div>';
  document.querySelectorAll('[data-view-campaign-jobs]').forEach((button) => button.addEventListener('click', () => loadCampaignJobs(button.dataset.viewCampaignJobs)));
}

async function loadCampaignJobs(id) {
  const container = $(`campaignJobs-${id}`);
  if (!container) return;
  if (!container.hidden) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = '<div class="crm-empty">Caricamento destinatari...</div>';
  try {
    const { jobs, total } = await api(`/api/crm/campaigns/${id}/jobs?limit=250`);
    const rows = jobs.map((job) => {
      const name = [job.first_name, job.last_name].filter(Boolean).join(' ') || job.email;
      return `<tr><td><strong>${esc(name || 'Senza nome')}</strong><br><small>${esc(job.email || 'n/a')}</small></td><td>${esc(statusLabel(job.status))}</td><td>${job.attempts}</td><td>${job.sent_at ? esc(new Date(job.sent_at).toLocaleString('it-IT')) : 'n/a'}</td><td>${esc(job.last_error || '')}</td></tr>`;
    }).join('');
    container.innerHTML = rows
      ? `<div class="section-heading compact"><div><h3>Destinatari</h3><span>${total} totali</span></div></div><div class="table-wrap"><table><thead><tr><th>Contatto</th><th>Stato</th><th>Tentativi</th><th>Invio</th><th>Errore</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="crm-empty">Nessun destinatario.</div>';
  } catch (error) {
    container.innerHTML = `<div class="crm-empty">${esc(error.message)}</div>`;
  }
}

function renderCampaignTemplate(template) {
  if (!template) {
    $('campaignPreviewSubject').textContent = 'Seleziona un template';
    $('campaignPreview').srcdoc = '';
    return;
  }
  $('campaignPreviewSubject').textContent = sampleTemplate(template.subject);
  const body = sampleTemplate(template.html_body);
  const preheader = sampleTemplate(template.preheader || '');
  $('campaignPreview').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:24px;background:#f3f4f6;color:#171a23;font-family:Arial,sans-serif}.email{max-width:640px;margin:0 auto;padding:28px;background:#fff;border-radius:14px}img{max-width:100%;height:auto}a{color:#e64a26}.preheader{display:none!important}</style></head><body><span class="preheader">${preheader}</span><main class="email">${body}</main></body></html>`;
}

async function loadCampaignPreview() {
  const listId = $('campaignList').value;
  const templateId = $('campaignTemplate').value;
  if (!listId || !templateId) {
    $('campaignEligibleCount').textContent = '0';
    renderCampaignTemplate(null);
    return;
  }
  try {
    const result = await api(`/api/crm/campaigns/preview?listId=${encodeURIComponent(listId)}&templateId=${encodeURIComponent(templateId)}`);
    $('campaignEligibleCount').textContent = result.eligibleCount;
    renderCampaignTemplate(result.template);
  } catch (error) {
    $('campaignEligibleCount').textContent = '0';
    renderCampaignTemplate(null);
    toast(error.message, 'err');
  }
}

function syncCampaignTiming() {
  const scheduled = $('campaignTiming').value === 'scheduled';
  $('campaignScheduleWrap').hidden = !scheduled;
  $('campaignSchedule').required = scheduled;
  $('saveCampaignBtn').textContent = scheduled ? 'Programma invio' : 'Invia ora';
}

function resetCampaignEditor() {
  $('campaignEditor').reset();
  $('campaignTiming').value = 'now';
  $('campaignSchedule').value = localDateTimeValue(new Date(Date.now() + 3_600_000));
  refreshSelects();
  syncCampaignTiming();
  loadCampaignPreview();
  openEditor('campaignEditor');
}

async function sendCampaignTest() {
  const to = $('campaignTestEmail').value.trim();
  const template = state.templates.find((item) => item.id === $('campaignTemplate').value);
  if (!to || !template) {
    toast('Seleziona un template e inserisci l’indirizzo destinatario', 'err');
    return;
  }
  $('sendCampaignTestBtn').disabled = true;
  try {
    await api('/api/crm/templates/test', {
      method: 'POST',
      body: JSON.stringify({
        to,
        name: template.name,
        subject: template.subject,
        preheader: template.preheader || '',
        htmlBody: template.html_body,
        textBody: template.text_body || '',
      }),
    });
    toast(`Email di prova inviata a ${to}`);
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    $('sendCampaignTestBtn').disabled = false;
  }
}

async function saveCampaign(event) {
  event.preventDefault();
  const scheduled = $('campaignTiming').value === 'scheduled';
  try {
    await api('/api/crm/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: $('campaignName').value,
        listId: $('campaignList').value,
        templateId: $('campaignTemplate').value,
        scheduledAt: scheduled
          ? new Date($('campaignSchedule').value).toISOString() : null,
      }),
    });
    $('campaignEditor').hidden = true;
    $('campaignEditor').reset();
    toast(scheduled ? 'Invio programmato' : 'Invio messo in coda');
    await Promise.all([loadCampaigns(), loadSummary()]);
  } catch (error) {
    toast(error.message, 'err');
  }
}

function openEditor(id) {
  $(id).hidden = false;
  $(id).querySelector('input:not([type="hidden"]), select, textarea')?.focus();
}

function resetContactEditor() {
  if (!$('contactProfile').hidden) closeContactProfile();
  $('contactEditor').reset();
  $('contactId').value = '';
  $('contactSource').value = 'manual';
  $('contactEmailStatus').value = 'unknown';
  $('contactCrmStatus').value = '';
  $('contactEditorTitle').textContent = 'Nuovo contatto';
  openEditor('contactEditor');
}

function resetTemplateEditor() {
  $('templateEditor').reset();
  $('templateId').value = '';
  state.templateAttachments = [];
  renderTemplateAttachments();
  $('templateHtml').value = '<p>Ciao {{first_name}},</p><p>Scrivi qui il contenuto della tua email.</p><p>A presto.</p>';
  $('templateVisual').innerHTML = $('templateHtml').value;
  savedEditorRange = null;
  $('templateEditorTitle').textContent = 'Nuovo template';
  setEditorMode('visual');
  $('templateSaveState').textContent = 'Nuova bozza';
  openEditor('templateEditor');
}

function resetSequenceEditor() {
  $('sequenceEditor').reset();
  $('sequenceId').value = '';
  $('sequenceActive').checked = true;
  $('sequenceTriggerType').value = state.lists.length ? 'list_joined' : 'manual';
  syncSequenceTriggerFields();
  $('sequenceSteps').innerHTML = '';
  $('sequenceConditions').innerHTML = '';
  $('sequenceEditorTitle').textContent = 'Configura la sequenza';
  $('saveSequenceBtn').textContent = 'Crea sequenza';
  addSequenceStep();
  openEditor('sequenceEditor');
}

function changeTab(name) {
  document.querySelectorAll('.crm-tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.crm-panel').forEach((panel) => {
    const active = panel.id === `panel-${name}`;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  if (name === 'dashboard') loadEmailDashboard().catch((error) => toast(error.message, 'err'));
  if (name === 'emailLog') loadEmailLogs().catch((error) => toast(error.message, 'err'));
}

document.querySelectorAll('.crm-tab').forEach((tab) => tab.addEventListener('click', () => changeTab(tab.dataset.tab)));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { $(button.dataset.close).hidden = true; }));
let contactFilterTimer;
function scheduleContactFilter() {
  clearTimeout(contactFilterTimer);
  contactFilterTimer = setTimeout(() => loadContacts().catch((error) => toast(error.message, 'err')), 250);
}
$('contactFilters').addEventListener('submit', (event) => { event.preventDefault(); scheduleContactFilter(); });
$('contactFilters').addEventListener('input', scheduleContactFilter);
$('contactFilters').addEventListener('change', scheduleContactFilter);
$('contactEditor').addEventListener('submit', saveContact);
$('contactBulkEditor').addEventListener('submit', saveBulkContacts);
$('contactImportEditor').addEventListener('submit', runContactImport);
$('listEditor').addEventListener('submit', saveList);
$('templateEditor').addEventListener('submit', saveTemplate);
$('sequenceEditor').addEventListener('submit', saveSequence);
$('campaignEditor').addEventListener('submit', saveCampaign);
$('newContactBtn').addEventListener('click', resetContactEditor);
$('closeContactProfileBtn').addEventListener('click', closeContactProfile);
$('importContactsBtn').addEventListener('click', () => resetContactImport());
$('downloadContactTemplateBtn').addEventListener('click', downloadContactTemplate);
$('exportContactsBtn').addEventListener('click', exportFilteredContacts);
$('selectPageContacts').addEventListener('change', () => {
  state.selectAllMatching = false;
  state.contacts.forEach((contact) => {
    if ($('selectPageContacts').checked) state.selectedContacts.add(contact.id);
    else state.selectedContacts.delete(contact.id);
  });
  document.querySelectorAll('[data-select-contact]').forEach((checkbox) => { checkbox.checked = $('selectPageContacts').checked; });
  updateContactSelectionUi();
});
$('selectAllFilteredBtn').addEventListener('click', selectAllFilteredContacts);
$('clearContactSelectionBtn').addEventListener('click', clearContactSelection);
$('openBulkEditorBtn').addEventListener('click', openBulkContactEditor);
$('previewContactImportBtn').addEventListener('click', previewContactImport);
$('contactCsvFile').addEventListener('change', async () => {
  state.contactImport = null;
  $('contactImportMapping').hidden = true;
  $('contactImportPreview').hidden = true;
  $('runContactImportBtn').disabled = true;
  const [file] = $('contactCsvFile').files;
  $('contactCsvFilename').textContent = file ? file.name : 'Nessun file selezionato';
  if (file) await previewContactImport();
  else setContactImportStatus();
});
document.querySelectorAll('[data-import-field], #contactImportSource, #contactImportTags').forEach((input) => input.addEventListener('change', () => {
  state.contactImport = null;
  $('runContactImportBtn').disabled = true;
  setContactImportStatus('Mappatura modificata. Analizza di nuovo il CSV prima di importare.', 'warn');
}));
$('newListBtn').addEventListener('click', resetListEditor);
$('newTemplateBtn').addEventListener('click', resetTemplateEditor);
$('newSequenceBtn').addEventListener('click', resetSequenceEditor);
$('newCampaignBtn').addEventListener('click', resetCampaignEditor);
$('addSequenceStep').addEventListener('click', () => addSequenceStep());
$('addSequenceCondition').addEventListener('click', () => addSequenceCondition());
$('sequenceTriggerType').addEventListener('change', syncSequenceTriggerFields);
$('sendTemplateTestBtn').addEventListener('click', sendTemplateTest);
$('sendCampaignTestBtn').addEventListener('click', sendCampaignTest);
$('campaignTiming').addEventListener('change', syncCampaignTiming);
$('campaignList').addEventListener('change', loadCampaignPreview);
$('campaignTemplate').addEventListener('change', loadCampaignPreview);
$('refreshEmailDashboardBtn').addEventListener('click', () => loadEmailDashboard().catch((error) => toast(error.message, 'err')));
$('refreshEmailLogsBtn').addEventListener('click', () => loadEmailLogs().catch((error) => toast(error.message, 'err')));
$('emailLogFilters').addEventListener('change', () => loadEmailLogs().catch((error) => toast(error.message, 'err')));
$('templateVisual').addEventListener('input', updateTemplatePreview);
$('templateVisual').addEventListener('mouseup', rememberEditorRange);
$('templateVisual').addEventListener('keyup', rememberEditorRange);
$('templateHtml').addEventListener('input', updateTemplatePreview);
$('templateSubject').addEventListener('input', updateTemplatePreview);
$('templatePreheader').addEventListener('input', updateTemplatePreview);
document.querySelectorAll('[data-editor-mode]').forEach((button) => button.addEventListener('click', () => setEditorMode(button.dataset.editorMode)));
document.querySelectorAll('[data-editor-command]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => runEditorCommand(button.dataset.editorCommand));
});
document.querySelectorAll('[data-email-block]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => insertEmailBlock(button.dataset.emailBlock));
});
$('templateBlockFormat').addEventListener('change', () => {
  runEditorCommand('formatBlock', $('templateBlockFormat').value);
  $('templateBlockFormat').value = 'p';
});
$('templateTextColor').addEventListener('input', () => runEditorCommand('foreColor', $('templateTextColor').value));
$('templateToken').addEventListener('change', () => {
  if ($('templateToken').value) runEditorCommand('insertText', $('templateToken').value);
  $('templateToken').value = '';
});
$('insertLinkBtn').addEventListener('click', () => {
  const value = prompt('Inserisci l’URL completo del link');
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new Error('Unsupported URL protocol');
    runEditorCommand('createLink', url.toString());
  } catch {
    toast('URL non valido', 'err');
  }
});
$('insertImageBtn').addEventListener('click', () => $('templateImageFile').click());
$('addTemplateAttachmentBtn').addEventListener('click', () => $('templateAttachmentFile').click());
$('templateImageFile').addEventListener('change', async () => {
  const [file] = $('templateImageFile').files;
  if (!file) return;
  try {
    await uploadTemplateImage(file);
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    $('templateImageFile').value = '';
  }
});
$('templateAttachmentFile').addEventListener('change', async () => {
  const [file] = $('templateAttachmentFile').files;
  if (!file) return;
  try {
    await uploadTemplateAttachment(file);
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    $('templateAttachmentFile').value = '';
  }
});
document.querySelectorAll('[data-preview-size]').forEach((button) => button.addEventListener('click', () => {
  const mobile = button.dataset.previewSize === 'mobile';
  $('emailPreviewWrap').classList.toggle('mobile', mobile);
  document.querySelectorAll('[data-preview-size]').forEach((item) => item.classList.toggle('active', item === button));
}));

(async () => {
  try {
    await loadMe();
    await loadContactStatuses();
    await Promise.all([loadSummary(), loadContacts(), loadLists(), loadTemplates(), loadCampaigns()]);
    await loadSequences();
    $('campaignSchedule').value = localDateTimeValue(new Date(Date.now() + 3_600_000));
    syncCampaignTiming();
    await loadCampaignPreview();
  } catch (error) {
    toast(error.message, 'err');
  }
})();
