const state = { currentUser: null, users: [] };
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
  state.currentUser = user;
  $('userEmail').innerHTML = `<span>${esc(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
  $('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/login';
  });
}

function roleOptions(selected) {
  const roles = [
    ['admin', 'Amministratore'],
    ['whatsapp_user', 'WhatsApp User'],
    ['crm_user', 'CRM User'],
  ];
  return roles.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

async function loadUsers() {
  const { users } = await api('/auth/users');
  state.users = users;
  $('usersList').innerHTML = users.map((user) => `<article class="user-row" data-user-id="${user.id}">
    <div class="user-identity"><span>${esc((user.displayName || user.username).slice(0, 1).toUpperCase())}</span><div><strong>${esc(user.displayName || user.username)}</strong><small>${esc(user.username)}${user.id === state.currentUser.id ? ' | tu' : ''}</small></div></div>
    <select data-field="role" aria-label="Ruolo di ${esc(user.displayName || user.username)}">${roleOptions(user.role)}</select>
    <label class="check-field"><input type="checkbox" data-field="active" ${user.active ? 'checked' : ''} /> Attivo</label>
    <input type="password" data-field="password" placeholder="Nuova password" autocomplete="new-password" aria-label="Nuova password per ${esc(user.displayName || user.username)}" />
    <div class="row-actions"><button class="secondary" data-save-user>Salva</button>${user.id !== state.currentUser.id ? '<button class="danger" data-delete-user>Elimina</button>' : ''}</div>
  </article>`).join('');
  document.querySelectorAll('[data-save-user]').forEach((button) => button.addEventListener('click', () => saveUser(button.closest('[data-user-id]'))));
  document.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', () => deleteUser(button.closest('[data-user-id]'))));
}

async function createUser(event) {
  event.preventDefault();
  try {
    await api('/auth/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('newUsername').value,
        displayName: $('newDisplayName').value,
        password: $('newPassword').value,
        role: $('newRole').value,
      }),
    });
    $('userEditor').hidden = true;
    $('userEditor').reset();
    toast('Account creato');
    await loadUsers();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function saveUser(row) {
  const body = {
    role: row.querySelector('[data-field="role"]').value,
    active: row.querySelector('[data-field="active"]').checked,
  };
  const password = row.querySelector('[data-field="password"]').value;
  if (password) body.password = password;
  try {
    await api(`/auth/users/${row.dataset.userId}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast('Account aggiornato');
    await loadUsers();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function deleteUser(row) {
  if (!confirm('Eliminare definitivamente questo account?')) return;
  try {
    await api(`/auth/users/${row.dataset.userId}`, { method: 'DELETE' });
    toast('Account eliminato');
    await loadUsers();
  } catch (error) {
    toast(error.message, 'err');
  }
}

$('newUserBtn').addEventListener('click', () => {
  $('userEditor').hidden = false;
  $('newUsername').focus();
});
$('cancelUserBtn').addEventListener('click', () => { $('userEditor').hidden = true; });
$('userEditor').addEventListener('submit', createUser);

(async () => {
  await loadMe();
  await loadUsers();
})();
