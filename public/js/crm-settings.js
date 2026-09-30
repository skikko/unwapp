const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function toast(message, type = 'ok') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  document.body.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error || `Request failed with status ${response.status}`);
  return payload;
}

async function loadMe() {
  const { user } = await api('/api/me');
  const can = (permission) => user.permissions.includes('*') || user.permissions.includes(permission);
  document.querySelectorAll('[data-permission]').forEach((item) => { item.hidden = !can(item.dataset.permission); });
  $('userEmail').innerHTML = `<span>${esc(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
  $('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/login';
  });
}

async function loadSender() {
  const { settings } = await api('/api/crm/sender');
  $('senderProvider').value = settings.provider;
  $('senderHost').value = settings.host || '';
  $('senderPort').value = settings.port || 587;
  $('senderSecure').checked = Boolean(settings.secure);
  $('senderUsername').value = settings.username || '';
  $('senderFromName').value = settings.fromName || '';
  $('senderFromEmail').value = settings.fromEmail || '';
  $('senderReplyTo').value = settings.replyTo || '';
  $('senderPasswordHint').textContent = settings.passwordConfigured ? `Configurata: ${settings.passwordMasked}` : 'Non configurata';
  const configured = Boolean(settings.host && settings.username && settings.fromEmail && settings.passwordConfigured);
  $('senderStatus').className = `badge ${configured ? 'on' : 'off'}`;
  $('senderStatus').textContent = configured ? 'Configurato' : 'Non configurato';
}

async function saveSender(event) {
  event.preventDefault();
  const body = {
    provider: $('senderProvider').value,
    host: $('senderHost').value,
    port: Number($('senderPort').value),
    secure: $('senderSecure').checked,
    username: $('senderUsername').value,
    fromName: $('senderFromName').value,
    fromEmail: $('senderFromEmail').value,
    replyTo: $('senderReplyTo').value,
  };
  if ($('senderPassword').value) body.password = $('senderPassword').value;
  try {
    await api('/api/crm/sender', { method: 'PUT', body: JSON.stringify(body) });
    $('senderPassword').value = '';
    toast('Sender salvato');
    await loadSender();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function testSender() {
  $('testSenderBtn').disabled = true;
  try {
    await api('/api/crm/sender/test', { method: 'POST', body: '{}' });
    toast('Connessione SMTP riuscita');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    $('testSenderBtn').disabled = false;
  }
}

async function loadApiKeys() {
  const { keys } = await api('/api/crm/api-keys');
  $('apiKeysBody').innerHTML = keys.length ? keys.map((key) => `<tr><td><strong>${esc(key.name)}</strong><br><small>${esc(new Date(key.created_at).toLocaleDateString('it-IT'))}</small></td><td>${esc(key.source)}</td><td><code>${esc(key.key_prefix)}...</code></td><td>${esc((key.scopes || []).join(', '))}</td><td>${key.last_used_at ? esc(new Date(key.last_used_at).toLocaleString('it-IT')) : 'Mai'}</td><td><span class="badge ${key.active ? 'on' : 'off'}">${key.active ? 'Attiva' : 'Revocata'}</span></td><td><div class="row-actions">${key.active ? `<button class="secondary" data-rotate-api-key="${key.id}">Ruota</button><button class="danger" data-revoke-api-key="${key.id}">Revoca</button>` : ''}</div></td></tr>`).join('') : '<tr><td colspan="7">Nessuna chiave API configurata.</td></tr>';
  document.querySelectorAll('[data-rotate-api-key]').forEach((button) => button.addEventListener('click', () => rotateApiKey(button.dataset.rotateApiKey)));
  document.querySelectorAll('[data-revoke-api-key]').forEach((button) => button.addEventListener('click', () => revokeApiKey(button.dataset.revokeApiKey)));
}

function showApiSecret(secret) {
  $('apiKeySecretValue').textContent = secret;
  $('apiKeySecret').hidden = false;
}

async function createApiKey(event) {
  event.preventDefault();
  try {
    const expiresAt = $('apiKeyExpiresAt').value
      ? new Date(`${$('apiKeyExpiresAt').value}T23:59:59`).toISOString() : null;
    const result = await api('/api/crm/api-keys', {
      method: 'POST',
      body: JSON.stringify({
        name: $('apiKeyName').value,
        source: $('apiKeySource').value,
        expiresAt,
        scopes: $('apiKeyContactsScope').checked ? ['contacts:write'] : [],
      }),
    });
    showApiSecret(result.secret);
    $('apiKeyEditor').reset();
    $('apiKeyContactsScope').checked = true;
    await loadApiKeys();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function rotateApiKey(id) {
  if (!confirm('Ruotare la chiave? Quella attuale smetterà subito di funzionare.')) return;
  try {
    const result = await api(`/api/crm/api-keys/${id}/rotate`, { method: 'POST', body: '{}' });
    showApiSecret(result.secret);
    await loadApiKeys();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function revokeApiKey(id) {
  if (!confirm('Revocare definitivamente questa chiave API?')) return;
  try {
    await api(`/api/crm/api-keys/${id}`, { method: 'DELETE' });
    await loadApiKeys();
  } catch (error) {
    toast(error.message, 'err');
  }
}

$('senderEditor').addEventListener('submit', saveSender);
$('testSenderBtn').addEventListener('click', testSender);
$('apiKeyEditor').addEventListener('submit', createApiKey);
$('senderProvider').addEventListener('change', () => {
  if ($('senderProvider').value === 'gmail') {
    $('senderHost').value = 'smtp.gmail.com';
    $('senderPort').value = 465;
    $('senderSecure').checked = true;
  }
});

(async () => {
  await loadMe();
  await Promise.all([loadSender(), loadApiKeys()]);
})();
