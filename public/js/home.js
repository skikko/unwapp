const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

async function loadHome() {
  const response = await fetch('/api/me', { credentials: 'same-origin' });
  if (!response.ok) {
    location.href = '/login';
    return;
  }
  const { user } = await response.json();
  const can = (permission) => user.permissions.includes('*') || user.permissions.includes(permission);
  document.querySelectorAll('[data-permission]').forEach((item) => { item.hidden = !can(item.dataset.permission); });
  $('userEmail').innerHTML = `<span>${esc(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
  $('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/login';
  });
  $('platformEmpty').hidden = can('chat:read') || can('crm:read');
}

loadHome().catch(() => { location.href = '/login'; });
