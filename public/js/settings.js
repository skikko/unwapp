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
  if (!response.ok) throw new Error(payload.detail || payload.error || `Errore ${response.status}`);
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
  if (!configured) {
    $('twilioStatus').textContent = 'Non configurato';
  } else if (settings.authenticationMode === 'api_key') {
    $('twilioStatus').textContent = 'API Key attiva';
  } else {
    $('twilioStatus').textContent = 'Auth Token attivo';
  }
}

async function saveTwilio() {
  const body = {
    accountSid: $('twilioAccountSid').value.trim(),
    publicBaseUrl: $('publicBaseUrl').value.trim(),
  };
  if ($('twilioAuthToken').value) body.authToken = $('twilioAuthToken').value;
  if ($('twilioApiKeySid').value) body.apiKeySid = $('twilioApiKeySid').value.trim();
  if ($('twilioApiSecret').value) body.apiKeySecret = $('twilioApiSecret').value;
  try {
    await api('/api/settings/twilio', { method: 'PUT', body: JSON.stringify(body) });
    $('twilioAuthToken').value = '';
    $('twilioApiSecret').value = '';
    toast('Configurazione Twilio salvata');
    await loadTwilio();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function testTwilio() {
  $('testTwilioBtn').disabled = true;
  try {
    const result = await api('/api/settings/twilio/test', { method: 'POST', body: '{}' });
    toast(`Connessione riuscita: ${result.accountSid}`);
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    $('testTwilioBtn').disabled = false;
  }
}

$('saveTwilioBtn').addEventListener('click', saveTwilio);
$('testTwilioBtn').addEventListener('click', testTwilio);
document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
  await navigator.clipboard.writeText($(button.dataset.copy).textContent);
  toast('URL copiato');
}));

(async () => {
  await loadMe();
  await loadTwilio();
})();
