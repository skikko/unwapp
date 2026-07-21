const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const button = document.getElementById('loginBtn');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  button.disabled = true;
  button.textContent = 'Accesso...';
  try {
    const response = await fetch('/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Accesso non riuscito');
    const params = new URLSearchParams(location.search);
    const next = params.get('next');
    const permissions = payload.user.permissions || [];
    const can = (permission) => permissions.includes('*') || permissions.includes(permission);
    const landingPage = can('chat:read') ? '/' : can('broadcast:read') ? '/broadcast' : can('admin') ? '/admin' : '/login';
    const nextAllowed = next && next.startsWith('/') && !next.startsWith('//') && (
      (next === '/' && can('chat:read')) ||
      (next.startsWith('/broadcast') && can('broadcast:read')) ||
      ((next.startsWith('/admin') || next.startsWith('/settings')) && can('admin'))
    );
    location.href = nextAllowed ? next : landingPage;
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Accedi';
  }
});
