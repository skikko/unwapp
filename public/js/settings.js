const state = { currentUser: null, users: [] };
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function toast(message, type = 'ok') {
  const item = document.createElement('div'); item.className = `toast ${type}`; item.textContent = message;
  document.body.appendChild(item); setTimeout(() => item.remove(), 4000);
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error || `Errore ${response.status}`);
  return payload;
}

async function loadMe() {
  const { user } = await api('/api/me'); state.currentUser = user;
  const can = (permission) => user.permissions.includes('*') || user.permissions.includes(permission);
  document.querySelectorAll('[data-permission]').forEach((item) => { item.hidden = !can(item.dataset.permission); });
  $('userEmail').innerHTML = `<span>${esc(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
  $('logoutBtn').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); location.href = '/login'; });
}

async function loadTwilio() {
  const { settings, urls } = await api('/api/settings/twilio');
  $('twilioAccountSid').value = settings.accountSid || '';
  $('twilioApiKeySid').value = settings.apiKeySid || '';
  $('publicBaseUrl').value = settings.publicBaseUrl || '';
  $('authTokenHint').textContent = settings.authTokenConfigured ? `Configurato: ${settings.authTokenMasked}` : 'Non configurato';
  $('apiSecretHint').textContent = settings.apiKeySecretConfigured ? `Configurato: ${settings.apiKeySecretMasked}` : 'Non configurato';
  $('inboundWebhook').textContent = urls.inboundWebhook;
  $('statusCallback').textContent = urls.statusCallback;
  const configured = settings.accountSid && settings.authTokenConfigured;
  $('twilioStatus').className = `badge ${configured ? 'on' : 'off'}`;
  $('twilioStatus').textContent = configured ? (settings.authenticationMode === 'api_key' ? 'API Key attiva' : 'Auth Token attivo') : 'Non configurato';
}

async function saveTwilio() {
  const body = {
    accountSid: $('twilioAccountSid').value.trim(), publicBaseUrl: $('publicBaseUrl').value.trim(),
  };
  if ($('twilioAuthToken').value) body.authToken = $('twilioAuthToken').value;
  if ($('twilioApiKeySid').value) body.apiKeySid = $('twilioApiKeySid').value.trim();
  if ($('twilioApiSecret').value) body.apiKeySecret = $('twilioApiSecret').value;
  try {
    await api('/api/settings/twilio', { method: 'PUT', body: JSON.stringify(body) });
    $('twilioAuthToken').value = ''; $('twilioApiSecret').value = '';
    toast('Configurazione Twilio salvata'); await loadTwilio();
  } catch (error) { toast(error.message, 'err'); }
}

async function testTwilio() {
  $('testTwilioBtn').disabled = true;
  try { const result = await api('/api/settings/twilio/test', { method: 'POST', body: '{}' }); toast(`Connessione riuscita: ${result.accountSid}`); }
  catch (error) { toast(error.message, 'err'); }
  finally { $('testTwilioBtn').disabled = false; }
}

const roleNames = { admin: 'Amministratore', operator: 'Operatore', broadcaster: 'Broadcast', viewer: 'Sola lettura' };
async function loadUsers() {
  const { users } = await api('/auth/users'); state.users = users;
  $('usersList').innerHTML = users.map((user) => `<article class="user-row" data-user-id="${user.id}">
    <div class="user-identity"><span>${esc((user.displayName || user.username).slice(0, 1).toUpperCase())}</span><div><strong>${esc(user.displayName || user.username)}</strong><small>${esc(user.username)}${user.id === state.currentUser.id ? ' · tu' : ''}</small></div></div>
    <select data-field="role"><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Amministratore</option><option value="operator" ${user.role === 'operator' ? 'selected' : ''}>Operatore</option><option value="broadcaster" ${user.role === 'broadcaster' ? 'selected' : ''}>Broadcast</option><option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Sola lettura</option></select>
    <label class="check-field"><input type="checkbox" data-field="active" ${user.active ? 'checked' : ''} /> Attivo</label>
    <input type="password" data-field="password" placeholder="Nuova password" autocomplete="new-password" />
    <div class="row-actions"><button class="secondary" data-save-user>Salva</button>${user.id !== state.currentUser.id ? '<button class="danger" data-delete-user>Elimina</button>' : ''}</div>
  </article>`).join('');
  document.querySelectorAll('[data-save-user]').forEach((button) => button.addEventListener('click', () => saveUser(button.closest('[data-user-id]'))));
  document.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', () => deleteUser(button.closest('[data-user-id]'))));
}

async function createUser() {
  try {
    await api('/auth/users', { method: 'POST', body: JSON.stringify({ username: $('newUsername').value, displayName: $('newDisplayName').value, password: $('newPassword').value, role: $('newRole').value }) });
    $('userEditor').hidden = true; toast('Account creato'); await loadUsers();
  } catch (error) { toast(error.message, 'err'); }
}

async function saveUser(row) {
  const body = { role: row.querySelector('[data-field="role"]').value, active: row.querySelector('[data-field="active"]').checked };
  const password = row.querySelector('[data-field="password"]').value; if (password) body.password = password;
  try { await api(`/auth/users/${row.dataset.userId}`, { method: 'PATCH', body: JSON.stringify(body) }); toast('Account aggiornato'); await loadUsers(); }
  catch (error) { toast(error.message, 'err'); }
}

async function deleteUser(row) {
  if (!confirm('Eliminare definitivamente questo account?')) return;
  try { await api(`/auth/users/${row.dataset.userId}`, { method: 'DELETE' }); toast('Account eliminato'); await loadUsers(); }
  catch (error) { toast(error.message, 'err'); }
}

$('saveTwilioBtn').addEventListener('click', saveTwilio);
$('testTwilioBtn').addEventListener('click', testTwilio);
$('newUserBtn').addEventListener('click', () => { $('userEditor').hidden = false; $('newUsername').focus(); });
$('cancelUserBtn').addEventListener('click', () => { $('userEditor').hidden = true; });
$('createUserBtn').addEventListener('click', createUser);
document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard.writeText($(button.dataset.copy).textContent); toast('URL copiato'); }));

(async () => { await loadMe(); await Promise.all([loadTwilio(), loadUsers()]); })();
