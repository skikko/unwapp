const state = {
  bots: [],
  selectedBotId: null,
  conversations: [],
  selectedConversationId: null,
  currentConversation: null,
  messages: [],
  socket: null,
};

const $ = (id) => document.getElementById(id);

function toast(msg, cls = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${cls}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let err = await res.text();
    try { err = JSON.parse(err).error || err; } catch {}
    throw new Error(`${res.status}: ${err}`);
  }
  return res.json();
}

async function loadMe() {
  try {
    const { user } = await api('/api/me');
    const can = (permission) => user.permissions.includes('*') || user.permissions.includes(permission);
    document.querySelectorAll('[data-permission]').forEach((item) => { item.hidden = !can(item.dataset.permission); });
    $('userEmail').innerHTML = `<span>${escape(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
    $('logoutBtn').addEventListener('click', logout);
    if (!can('chat:write')) {
      $('msgInput').disabled = true; $('sendBtn').disabled = true; $('closeBtn').hidden = true;
      $('modeSwitch').hidden = true; $('inputHint').textContent = 'Accesso in sola lettura';
    }
  } catch (_) {}
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  location.href = '/login';
}

async function loadBots() {
  const { bots } = await api('/api/bots');
  state.bots = bots;
  const el = $('botsList');
  if (!bots.length) {
    el.innerHTML = '<div class="empty-list">Nessun BOT.<br><br><a class="text-link" href="/admin">Crea un BOT</a></div>';
    return;
  }
  el.innerHTML = bots.map((c) => `
    <div class="list-item ${c.id === state.selectedBotId ? 'active' : ''}" data-id="${c.id}">
      <div class="title">${escape(c.name)}</div>
      <div class="sub">${escape(c.twilio_number)}</div>
      <div class="meta">
        <span class="badge ${c.active ? 'on' : 'off'}">${c.active ? 'attivo' : 'inattivo'}</span>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('.list-item').forEach((n) =>
    n.addEventListener('click', () => selectBot(n.dataset.id))
  );
}

async function selectBot(botId) {
  state.selectedBotId = botId;
  state.selectedConversationId = null;
  state.currentConversation = null;
  state.messages = [];
  renderChat();
  document.querySelectorAll('#botsList .list-item').forEach((n) =>
    n.classList.toggle('active', n.dataset.id === botId)
  );
  await loadConversations();
  subscribeSocket();
}

async function loadConversations() {
  const cid = state.selectedBotId;
  if (!cid) return;
  const { conversations } = await api(`/api/chat/conversations?botId=${cid}`);
  state.conversations = conversations;
  const el = $('conversationsList');
  if (!conversations.length) {
    el.innerHTML = '<div class="empty-list">Nessuna conversazione</div>';
    return;
  }
  el.innerHTML = conversations.map((c) => {
    const last = c.last_message ? escape(String(c.last_message).slice(0, 90)) : '';
    const statusBadge = c.status === 'human'
      ? '<span class="badge human">👤 Operatore</span>'
      : c.status === 'closed'
      ? '<span class="badge">chiusa</span>'
      : '<span class="badge bot">🤖 Bot</span>';
    return `
      <div class="list-item ${c.id === state.selectedConversationId ? 'active' : ''}" data-id="${c.id}">
        <div class="title">${escape(c.phone_number)}</div>
        <div class="sub">${last || '<em style="opacity:0.5">nessun messaggio</em>'}</div>
        <div class="meta">
          ${statusBadge}
          <span>${timeAgo(c.last_message_at)}</span>
        </div>
      </div>
    `;
  }).join('');
  el.querySelectorAll('.list-item').forEach((n) =>
    n.addEventListener('click', () => selectConversation(n.dataset.id))
  );
}

async function selectConversation(id) {
  state.selectedConversationId = id;
  const { conversation, messages } = await api(`/api/chat/conversations/${id}`);
  state.currentConversation = conversation;
  state.messages = messages;
  renderChat();
  document.querySelectorAll('#conversationsList .list-item').forEach((n) =>
    n.classList.toggle('active', n.dataset.id === id)
  );
}

function renderChat() {
  const hasConv = !!state.selectedConversationId;
  $('chatEmpty').style.display = hasConv ? 'none' : 'flex';
  $('chatView').style.display = hasConv ? 'flex' : 'none';
  if (!hasConv) return;

  const conv = state.currentConversation;
  $('chatTitle').textContent = conv.phone_number;
  $('chatSubtitle').textContent = conv.operator_email ? `controllato da ${conv.operator_email}` : '';

  // Status bar + mode switch
  const isHuman = conv.status === 'human';
  const statusBar = $('statusBar');
  statusBar.className = `status-bar ${isHuman ? 'human' : 'bot'}`;
  $('statusText').textContent = isHuman
    ? 'OPERATORE ATTIVO — il bot è in pausa'
    : 'BOT AI ATTIVO — risponde automaticamente';

  const sw = $('modeSwitch');
  sw.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === (isHuman ? 'human' : 'bot'));
    b.classList.toggle('bot', b.dataset.mode === 'bot');
    b.classList.toggle('human', b.dataset.mode === 'human');
  });

  $('inputHint').textContent = isHuman
    ? 'Il bot è in pausa — stai rispondendo come operatore'
    : 'Inviando un messaggio passerai in modalità operatore';

  // Messages
  const body = $('chatBody');
  body.innerHTML = state.messages.map((m) => `
    <div class="msg ${m.role}">
      ${escape(m.content)}
      <div class="meta">
        <span>${roleLabel(m.role)}</span>
        <span>${new Date(m.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  `).join('');
  body.scrollTop = body.scrollHeight;
}

function roleLabel(r) {
  return { user: 'Cliente', bot: '🤖 Bot', operator: '👤 Operatore', system: 'Sistema' }[r] || r;
}

async function sendOperatorMessage() {
  const text = $('msgInput').value.trim();
  if (!text || !state.selectedConversationId) return;
  $('sendBtn').disabled = true;
  try {
    await api(`/api/chat/conversations/${state.selectedConversationId}/send`, {
      method: 'POST', body: JSON.stringify({ message: text }),
    });
    $('msgInput').value = '';
    // Reload conversation to reflect human mode
    await selectConversation(state.selectedConversationId);
    await loadConversations();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    $('sendBtn').disabled = false;
  }
}

async function setMode(mode) {
  if (!state.selectedConversationId) return;
  const conv = state.currentConversation;
  const isHuman = conv.status === 'human';

  if (mode === 'bot' && isHuman) {
    if (!confirm('Rilasciare la conversazione al bot? Il bot tornerà a rispondere automaticamente.')) return;
    await api(`/api/chat/conversations/${state.selectedConversationId}/release`, { method: 'PATCH' });
    toast('Bot riattivato');
    await selectConversation(state.selectedConversationId);
    await loadConversations();
  } else if (mode === 'human' && !isHuman) {
    // Take over manually (write a silent marker or just open the mode by sending?).
    // The backend flips to 'human' only when sendOperatorMessage runs.
    // We'll flip it via a zero-length operator claim: send a system-transfer API.
    // Simpler: call /send with a placeholder? No — let user type. Just show hint.
    toast('Scrivi un messaggio per prendere il controllo', 'ok');
    $('msgInput').focus();
  }
}

async function closeConversation() {
  if (!state.selectedConversationId) return;
  if (!confirm('Chiudere la conversazione? Non verranno più inviate risposte automatiche.')) return;
  await api(`/api/chat/conversations/${state.selectedConversationId}/close`, { method: 'PATCH' });
  state.selectedConversationId = null;
  state.currentConversation = null;
  await loadConversations();
  renderChat();
}

function subscribeSocket() {
  if (!state.socket) {
    state.socket = io({ transports: ['websocket', 'polling'] });
    state.socket.on('new-message', (ev) => {
      if (ev.botId !== state.selectedBotId) return;
      loadConversations();
      if (ev.conversationId === state.selectedConversationId) {
        state.messages.push({
          role: ev.message.role,
          content: ev.message.content,
          created_at: ev.message.createdAt,
        });
        renderChat();
      }
    });
    state.socket.on('attention-required', (ev) => {
      if (ev.botId === state.selectedBotId) {
        toast(`⚠ Attenzione richiesta: ${ev.phoneNumber}`, 'err');
      }
    });
    state.socket.on('operator-mode-changed', () => {
      if (state.selectedConversationId) selectConversation(state.selectedConversationId);
      loadConversations();
    });
  }
  state.socket.emit('join-bot', state.selectedBotId);
}

function timeAgo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'ora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

$('refreshBtn').addEventListener('click', loadConversations);
$('sendBtn').addEventListener('click', sendOperatorMessage);
$('closeBtn').addEventListener('click', closeConversation);
$('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOperatorMessage(); }
});
document.querySelectorAll('#modeSwitch button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode))
);

(async () => { await loadMe(); await loadBots(); })();
