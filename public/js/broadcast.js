const state = { bots: [], templates: [], preview: null, file: null, user: null };
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function toast(message, type = 'ok') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 4200);
}

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: isForm ? (options.headers || {}) : { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error || `Errore ${response.status}`);
  return payload;
}

async function loadMe() {
  try {
    const { user } = await api('/api/me'); state.user = user;
    const can = (permission) => user.permissions.includes('*') || user.permissions.includes(permission);
    document.querySelectorAll('[data-permission]').forEach((item) => { item.hidden = !can(item.dataset.permission); });
    document.querySelectorAll('[data-write]').forEach((item) => {
      if (!can(item.dataset.write)) {
        item.classList.add('readonly-panel');
        item.querySelectorAll('input, select, button').forEach((control) => { control.disabled = true; });
      }
    });
    $('userEmail').innerHTML = `<span>${escapeHtml(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
    $('logoutBtn').addEventListener('click', logout);
  } catch {}
}

async function logout() { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); location.href = '/login'; }

async function loadBots() {
  const { bots } = await api('/api/bots');
  state.bots = bots;
  $('botSelect').innerHTML = '<option value="">Seleziona un BOT</option>' + bots
    .filter((bot) => bot.active)
    .map((bot) => `<option value="${bot.id}">${escapeHtml(bot.name)} · ${escapeHtml(bot.twilio_number)}</option>`).join('');
}

function approvalLabel(status) {
  return status === 'approved' ? 'approvato' : status.replaceAll('_', ' ');
}

async function loadTemplates() {
  try {
    const { templates } = await api('/api/broadcast/templates');
    state.templates = templates;
    const approved = templates.filter((template) => template.status === 'approved');
    $('templateSelect').innerHTML = '<option value="">Seleziona un template</option>'
      + approved.map((template) => `<option value="${template.sid}">${escapeHtml(template.name)} · ${escapeHtml(template.language)}</option>`).join('')
      + '<option value="manual">Inserisci Content SID manualmente</option>';
    if (!approved.length) toast('Nessun template WhatsApp approvato trovato. Puoi inserire il SID manualmente.', 'err');
  } catch (error) {
    state.templates = [];
    $('templateSelect').innerHTML = '<option value="manual">Inserisci Content SID manualmente</option>';
    $('templateSelect').value = 'manual';
    toggleManualTemplate();
    toast(error.message, 'err');
  }
}

function currentTemplate() {
  return state.templates.find((item) => item.sid === $('templateSelect').value) || null;
}

function selectedTemplateSid() {
  return $('templateSelect').value === 'manual' ? $('manualSid').value.trim() : $('templateSelect').value;
}

function templateVariableKeys() {
  const template = currentTemplate();
  if (template) return Object.keys(template.variables || {}).sort((a, b) => Number(a) - Number(b));
  return $('manualVariables').value.split(',').map((item) => item.trim()).filter((item) => /^\d+$/.test(item));
}

function toggleManualTemplate() {
  const manual = $('templateSelect').value === 'manual';
  $('manualSidField').style.display = manual ? 'block' : 'none';
  $('manualVariablesField').style.display = manual ? 'block' : 'none';
  const template = currentTemplate();
  if (template) {
    $('templatePreview').style.display = 'block';
    $('templatePreview').innerHTML = `<div><span class="badge on">${approvalLabel(template.status)}</span><span>${escapeHtml(template.language)}</span></div><strong>${escapeHtml(template.name)}</strong><p>${escapeHtml(template.body || 'Anteprima testuale non disponibile')}</p>`;
  } else {
    $('templatePreview').style.display = 'none';
  }
  renderMapping();
  updateReadyState();
}

async function previewFile() {
  const file = $('csvFile').files[0];
  if (!file) return;
  state.file = file;
  const form = new FormData();
  form.append('contacts', file);
  $('contactsPreview').innerHTML = '<div class="loading">Analisi del CSV...</div>';
  try {
    state.preview = await api('/api/broadcast/preview', { method: 'POST', body: form });
    const preview = state.preview;
    $('fileMeta').style.display = 'flex';
    $('fileMeta').innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${preview.totalRows.toLocaleString('it-IT')} righe · separatore ${escapeHtml(preview.delimiter)}</span>`;
    $('phoneField').style.display = 'block';
    $('phoneColumn').innerHTML = preview.headers.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`).join('');
    if (preview.suggestedPhoneColumn) $('phoneColumn').value = preview.suggestedPhoneColumn;
    renderPreview();
    renderMapping();
  } catch (error) {
    state.preview = null;
    $('contactsPreview').innerHTML = `<div class="preview-empty"><strong>File non valido</strong><p>${escapeHtml(error.message)}</p></div>`;
    toast(error.message, 'err');
  }
  updateReadyState();
}

async function refreshValidation() {
  if (!state.file) return;
  const form = new FormData();
  form.append('contacts', state.file);
  form.append('phoneColumn', $('phoneColumn').value);
  state.preview = await api('/api/broadcast/preview', { method: 'POST', body: form });
  renderPreview();
  updateReadyState();
}

function renderPreview() {
  const preview = state.preview;
  if (!preview) return;
  const headers = preview.headers.slice(0, 5);
  const rows = preview.preview.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row.data[header])}</td>`).join('')}</tr>`).join('');
  $('contactsPreview').innerHTML = `
    <div class="quality-grid">
      <div><strong>${preview.validCount}</strong><span>validi</span></div>
      <div><strong>${preview.invalidCount}</strong><span>non validi</span></div>
      <div><strong>${preview.duplicateCount}</strong><span>duplicati</span></div>
    </div>
    <div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderMapping() {
  const keys = templateVariableKeys();
  const hasPreview = Boolean(state.preview);
  $('mappingSection').style.display = keys.length && hasPreview ? 'block' : 'none';
  if (!keys.length || !hasPreview) { $('variableMapping').innerHTML = ''; return; }
  $('variableMapping').innerHTML = keys.map((key) => {
    const template = currentTemplate();
    const example = template?.variables?.[key] || `Variabile ${key}`;
    return `<div class="mapping-row"><div><span>{{${key}}}</span><strong>${escapeHtml(example)}</strong></div><select data-variable="${key}"><option value="">Non valorizzare</option>${state.preview.headers.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`).join('')}</select></div>`;
  }).join('');
}

function collectMapping() {
  const mapping = {};
  document.querySelectorAll('[data-variable]').forEach((select) => {
    if (select.value) mapping[select.dataset.variable] = select.value;
  });
  return mapping;
}

function updateReadyState() {
  const canWrite = state.user && (state.user.permissions.includes('*') || state.user.permissions.includes('broadcast:write'));
  const ready = Boolean(canWrite && $('botSelect').value && selectedTemplateSid() && state.preview?.validCount > 0 && $('phoneColumn').value);
  $('sendBroadcastBtn').disabled = !ready;
  $('sendSummary').textContent = state.preview
    ? `${state.preview.validCount} contatti pronti · ${state.preview.invalidCount + state.preview.duplicateCount} righe escluse`
    : 'Carica un CSV per continuare.';
}

async function sendBroadcast() {
  if (!$('sendBroadcastBtn').disabled && !confirm(`Inviare il template a ${state.preview.validCount} contatti?`)) return;
  const template = currentTemplate();
  const form = new FormData();
  form.append('contacts', state.file);
  form.append('botId', $('botSelect').value);
  form.append('templateSid', selectedTemplateSid());
  form.append('templateName', template?.name || 'Template manuale');
  form.append('phoneColumn', $('phoneColumn').value);
  form.append('variableMapping', JSON.stringify(collectMapping()));
  $('sendBroadcastBtn').disabled = true;
  $('sendBroadcastBtn').textContent = 'Avvio in BOT...';
  try {
    const result = await api('/api/broadcast/campaigns', { method: 'POST', body: form });
    toast(`Broadcast avviato per ${result.accepted} contatti`);
    await loadCampaigns();
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    $('sendBroadcastBtn').textContent = 'Avvia broadcast';
    updateReadyState();
  }
}

function statusLabel(status) {
  return ({ queued: 'In coda', running: 'Invio in BOT', completed: 'Completato', completed_with_errors: 'Completato con errori', failed: 'Interrotto' })[status] || status;
}

async function loadCampaigns() {
  const { campaigns } = await api('/api/broadcast/campaigns');
  const element = $('campaignsList');
  if (!campaigns.length) { element.innerHTML = '<div class="empty-list">Nessun broadcast inviato.</div>'; return; }
  element.innerHTML = campaigns.map((campaign) => {
    const processed = Number(campaign.sent_count) + Number(campaign.failed_count);
    const progress = campaign.total_count ? Math.round((processed / campaign.total_count) * 100) : 0;
    return `<article class="campaign-row">
      <div class="campaign-main"><span class="status-dot ${campaign.status}"></span><div><strong>${escapeHtml(campaign.template_name || campaign.template_sid)}</strong><span>${escapeHtml(campaign.bot_name)} · ${new Date(campaign.created_at).toLocaleString('it-IT')}</span></div></div>
      <div class="campaign-progress"><div><span style="width:${progress}%"></span></div><small>${processed}/${campaign.total_count}</small></div>
      <div class="campaign-counts"><span>${campaign.sent_count} inviati</span><span class="error-count">${campaign.failed_count} errori</span></div>
      <span class="badge ${campaign.status === 'completed' ? 'on' : campaign.status === 'failed' ? 'off' : 'warn'}">${statusLabel(campaign.status)}</span>
    </article>`;
  }).join('');
}

$('templateSelect').addEventListener('change', toggleManualTemplate);
$('manualSid').addEventListener('input', updateReadyState);
$('manualVariables').addEventListener('input', () => { renderMapping(); updateReadyState(); });
$('botSelect').addEventListener('change', updateReadyState);
$('csvFile').addEventListener('change', previewFile);
$('phoneColumn').addEventListener('change', refreshValidation);
$('sendBroadcastBtn').addEventListener('click', sendBroadcast);
$('refreshCampaigns').addEventListener('click', loadCampaigns);

(async () => {
  await loadMe();
  await Promise.all([loadBots(), loadTemplates(), loadCampaigns()]);
  setInterval(() => {
    if (!document.hidden) loadCampaigns().catch(() => {});
  }, 5000);
})();
