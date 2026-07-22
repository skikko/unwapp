const state = {
  bots: [],
  selectedBotId: null,
  conversations: [],
  selectedConversationId: null,
  currentConversation: null,
  messages: [],
  socket: null,
  mediaFile: null,
  chatActions: [],
  conversationFilters: { templates: [], campaigns: [] },
  conversationRequest: 0,
  canWrite: false,
  canDelete: false,
  botsCollapsed: false,
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
  const isForm = opts.body instanceof FormData;
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: isForm ? (opts.headers || {}) : { 'Content-Type': 'application/json', ...(opts.headers || {}) },
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
    state.canWrite = can('chat:write');
    state.canDelete = can('admin');
    document.querySelectorAll('[data-permission]').forEach((item) => { item.hidden = !can(item.dataset.permission); });
    $('userEmail').innerHTML = `<span>${escape(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
    $('logoutBtn').addEventListener('click', logout);
    if (!can('chat:write')) {
      $('msgInput').disabled = true; $('sendBtn').disabled = true; $('closeBtn').hidden = true;
      $('deleteConversationBtn').hidden = true;
      $('attachBtn').disabled = true; $('addChatActionBtn').disabled = true;
      $('modeSwitch').hidden = true; $('inputHint').textContent = 'Accesso in sola lettura';
    }
    $('deleteConversationBtn').hidden = !state.canDelete;
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
    <div class="list-item bot-list-item ${c.id === state.selectedBotId ? 'active' : ''}" data-id="${c.id}" title="${escape(c.name)}" aria-label="${escape(c.name)}">
      <div class="bot-item-row">
        <span class="bot-avatar" aria-hidden="true">${escape(initials(c.name))}</span>
        <div class="bot-copy">
          <div class="title">${escape(c.name)}</div>
          <div class="sub">${escape(c.twilio_number)}</div>
        </div>
        <span class="bot-status-dot ${c.active ? (c.manual_only ? 'manual' : 'on') : 'off'}" title="${c.active ? (c.manual_only ? 'Solo operatore' : 'Risposte AI attive') : 'Inattivo'}" aria-label="${c.active ? (c.manual_only ? 'Solo operatore' : 'Risposte AI attive') : 'Inattivo'}"></span>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('.list-item').forEach((n) =>
    n.addEventListener('click', () => selectBot(n.dataset.id))
  );
  if (!state.selectedBotId) await selectBot(bots[0].id);
}

async function selectBot(botId) {
  state.selectedBotId = botId;
  state.selectedConversationId = null;
  state.currentConversation = null;
  state.messages = [];
  clearChatAttachment();
  state.chatActions = [];
  $('conversationSearch').value = '';
  $('conversationStatus').value = '';
  $('conversationBroadcast').value = '';
  $('conversationSearch').disabled = false;
  $('conversationStatus').disabled = false;
  $('conversationBroadcast').disabled = false;
  renderChatActions();
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
  const requestId = ++state.conversationRequest;
  const params = new URLSearchParams({ botId: cid });
  const search = $('conversationSearch').value.trim();
  const status = $('conversationStatus').value;
  const broadcast = $('conversationBroadcast').value;
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (broadcast) params.set('broadcast', broadcast);
  const { conversations, filters = {} } = await api(`/api/chat/conversations?${params}`);
  if (requestId !== state.conversationRequest || cid !== state.selectedBotId) return;
  state.conversations = conversations;
  state.conversationFilters = filters;
  renderConversationFilterOptions();
  const el = $('conversationsList');
  if (!conversations.length) {
    const hasFilters = Boolean(search || status || broadcast);
    el.innerHTML = `<div class="empty-list">${hasFilters ? 'Nessun risultato' : 'Nessuna conversazione'}</div>`;
    return;
  }
  el.innerHTML = conversations.map((c) => {
    const last = c.last_message ? escape(String(c.last_message).slice(0, 90)) : '';
    const contactName = String(c.contact_name || '').trim();
    const identity = contactName
      ? `<div class="title">${escape(contactName)}</div><div class="contact-phone">${escape(c.phone_number)}</div>`
      : `<div class="title">${escape(c.phone_number)}</div>`;
    const linkedTemplate = Array.isArray(c.broadcast_templates) ? c.broadcast_templates[0] : null;
    const statusBadge = c.status === 'human'
      ? '<span class="badge human">👤 Operatore</span>'
      : c.status === 'closed'
      ? '<span class="badge">chiusa</span>'
      : '<span class="badge bot">🤖 Bot</span>';
    return `
      <div class="list-item ${c.id === state.selectedConversationId ? 'active' : ''}" data-id="${c.id}">
        ${identity}
        <div class="sub">${last || '<em style="opacity:0.5">nessun messaggio</em>'}</div>
        <div class="meta">
          ${statusBadge}
          ${linkedTemplate ? `<span class="conversation-template" title="Template broadcast: ${escape(linkedTemplate.name)}">${escape(linkedTemplate.name)}</span>` : ''}
          <span>${timeAgo(c.last_message_at)}</span>
        </div>
      </div>
    `;
  }).join('');
  el.querySelectorAll('.list-item').forEach((n) =>
    n.addEventListener('click', () => selectConversation(n.dataset.id))
  );
}

function renderConversationFilterOptions() {
  const select = $('conversationBroadcast');
  const selected = select.value;
  const templates = Array.isArray(state.conversationFilters.templates) ? state.conversationFilters.templates : [];
  const campaigns = Array.isArray(state.conversationFilters.campaigns) ? state.conversationFilters.campaigns : [];
  const templateOptions = templates.map((template) =>
    `<option value="template:${escape(template.sid)}">${escape(template.name || template.sid)}</option>`
  ).join('');
  const campaignOptions = campaigns.map((campaign) => {
    const date = new Date(campaign.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    const source = campaign.source_filename ? ` · ${campaign.source_filename}` : '';
    return `<option value="campaign:${escape(campaign.id)}">${escape(campaign.name || campaign.template_sid)}${escape(source)} · ${date}</option>`;
  }).join('');
  select.innerHTML = `
    <option value="">Tutti i broadcast</option>
    ${templateOptions ? `<optgroup label="Template">${templateOptions}</optgroup>` : ''}
    ${campaignOptions ? `<optgroup label="Campagne">${campaignOptions}</optgroup>` : ''}
  `;
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

async function selectConversation(id) {
  if (state.selectedConversationId && state.selectedConversationId !== id) {
    clearChatAttachment();
    state.chatActions = [];
    renderChatActions();
    $('msgInput').value = '';
  }
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
  const contactName = String(conv.contact_name || '').trim();
  $('chatTitle').textContent = contactName || conv.phone_number;
  $('chatSubtitle').textContent = [
    contactName ? conv.phone_number : '',
    conv.operator_email ? `controllato da ${conv.operator_email}` : '',
  ].filter(Boolean).join(' · ');

  // Status bar + mode switch
  const selectedBot = state.bots.find((bot) => bot.id === state.selectedBotId);
  const manualOnly = Boolean(selectedBot?.manual_only);
  const isHuman = conv.status === 'human' || manualOnly;
  const statusBar = $('statusBar');
  statusBar.className = `status-bar ${isHuman ? 'human' : 'bot'}`;
  $('statusText').textContent = isHuman
    ? (manualOnly ? 'Solo operatore' : 'Operatore attivo')
    : 'BOT attivo';

  const sw = $('modeSwitch');
  sw.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === (isHuman ? 'human' : 'bot'));
    b.classList.toggle('bot', b.dataset.mode === 'bot');
    b.classList.toggle('human', b.dataset.mode === 'human');
    b.disabled = b.dataset.mode === 'bot' && manualOnly;
    b.title = b.disabled ? 'Attiva le risposte AI dalla pagina BOT' : '';
  });

  $('inputHint').textContent = isHuman
    ? 'Rispondi come operatore'
    : 'L’invio passa all’operatore';

  // Messages
  const body = $('chatBody');
  body.innerHTML = state.messages.map((m) => `
    <div class="msg ${m.role}">
      ${renderMessageContent(m)}
      <div class="meta">
        <span>${roleLabel(m.role)}</span>
        <span>${new Date(m.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  `).join('');
  body.scrollTop = body.scrollHeight;
}

function safeUrl(value, protocols = ['https:']) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, location.origin);
    return protocols.includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function renderMessageContent(message) {
  const parts = [];
  const mediaUrl = safeUrl(message.media_url || '');
  const mediaType = String(message.media_type || '');
  if (mediaUrl && mediaType.startsWith('image/')) {
    parts.push(`<a href="${escape(mediaUrl)}" target="_blank" rel="noopener"><img class="message-image" src="${escape(mediaUrl)}" alt="${escape(message.media_name || 'Immagine')}" /></a>`);
  } else if (mediaUrl) {
    parts.push(`<a class="message-file" href="${escape(mediaUrl)}" target="_blank" rel="noopener"><span>FILE</span><strong>${escape(message.media_name || 'Apri allegato')}</strong></a>`);
  }
  if (message.content && !(mediaUrl && message.content === `📎 ${message.media_name || 'Allegato'}`)) {
    parts.push(`<div class="message-text">${escape(message.content)}</div>`);
  }
  const actions = Array.isArray(message.actions) ? message.actions : [];
  if (actions.length) {
    parts.push(`<div class="message-actions">${actions.map((action) => {
      const label = escape(action.title || 'Azione');
      if (action.type === 'URL') {
        const href = safeUrl(action.url || '');
        return href ? `<a href="${escape(href)}" target="_blank" rel="noopener">${label}</a>` : `<span>${label}</span>`;
      }
      if (action.type === 'PHONE_NUMBER') {
        const phone = String(action.phone || '').replace(/[^+\d]/g, '');
        return `<a href="tel:${escape(phone)}">${label}</a>`;
      }
      return `<span>${label}</span>`;
    }).join('')}</div>`);
  }
  return parts.join('') || escape(message.content || '');
}

function roleLabel(r) {
  return { user: 'Cliente', bot: '🤖 Bot', operator: '👤 Operatore', system: 'Sistema' }[r] || r;
}

async function sendOperatorMessage() {
  const text = $('msgInput').value.trim();
  if ((!text && !state.mediaFile) || !state.selectedConversationId) return;
  if (state.chatActions.length && !text) return toast('Scrivi un testo per aggiungere pulsanti', 'err');
  $('sendBtn').disabled = true;
  try {
    let media = null;
    if (state.mediaFile) {
      const form = new FormData();
      form.append('media', state.mediaFile);
      const uploaded = await api('/media/upload/chat', { method: 'POST', body: form });
      media = uploaded.media;
    }
    await api(`/api/chat/conversations/${state.selectedConversationId}/send`, {
      method: 'POST', body: JSON.stringify({
        message: text,
        mediaUrl: media?.url || '',
        mediaType: media?.type || '',
        mediaName: media?.name || '',
        actions: state.chatActions,
      }),
    });
    $('msgInput').value = '';
    clearChatAttachment();
    state.chatActions = [];
    renderChatActions();
    // Reload conversation to reflect human mode
    await selectConversation(state.selectedConversationId);
    await loadConversations();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    $('sendBtn').disabled = false;
  }
}

function selectChatAttachment() {
  $('chatMediaFile').click();
}

function updateChatAttachment() {
  const file = $('chatMediaFile').files[0] || null;
  const fileLimit = file?.type === 'image/webp' ? 100 * 1024
    : file?.type.startsWith('image/') ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
  if (file && file.size > fileLimit) {
    $('chatMediaFile').value = '';
    state.mediaFile = null;
    return toast(file.type.startsWith('image/')
      ? `L’immagine supera il limite di ${file.type === 'image/webp' ? '100 KB' : '5 MB'}`
      : 'Il file supera il limite di 16 MB', 'err');
  }
  state.mediaFile = file;
  $('chatAttachmentPreview').hidden = !file;
  $('chatAttachmentPreview').innerHTML = file
    ? `<div><span>ALLEGATO</span><strong>${escape(file.name)}</strong><small>${(file.size / 1024 / 1024).toFixed(2)} MB</small></div><button class="ghost" id="removeChatAttachment" type="button">Rimuovi</button>` : '';
  if (file) $('removeChatAttachment').addEventListener('click', clearChatAttachment);
}

function clearChatAttachment() {
  state.mediaFile = null;
  $('chatMediaFile').value = '';
  $('chatAttachmentPreview').hidden = true;
  $('chatAttachmentPreview').innerHTML = '';
}

function chatActionValue(action) {
  return action.type === 'URL' ? action.url || ''
    : action.type === 'PHONE_NUMBER' ? action.phone || '' : action.id || '';
}

function renderChatActions() {
  const container = $('chatActions');
  container.hidden = !state.chatActions.length;
  container.innerHTML = state.chatActions.map((action, index) => `
    <div class="action-row" data-chat-action="${index}">
      <select data-chat-action-field="type"><option value="URL" ${action.type === 'URL' ? 'selected' : ''}>Apri URL</option><option value="QUICK_REPLY" ${action.type === 'QUICK_REPLY' ? 'selected' : ''}>Risposta rapida</option></select>
      <input data-chat-action-field="title" maxlength="25" value="${escape(action.title || '')}" placeholder="Testo pulsante" />
      <input data-chat-action-field="value" value="${escape(chatActionValue(action))}" placeholder="${action.type === 'URL' ? 'https://...' : action.type === 'PHONE_NUMBER' ? '+39...' : 'identificativo'}" />
      <button class="danger" data-remove-chat-action="${index}" type="button">×</button>
    </div>`).join('');
  container.querySelectorAll('[data-chat-action]').forEach((row) => {
    const index = Number(row.dataset.chatAction);
    row.querySelectorAll('[data-chat-action-field]').forEach((control) => {
      const update = () => updateChatAction(index, control.dataset.chatActionField, control.value);
      control.addEventListener('input', update); control.addEventListener('change', update);
    });
  });
  container.querySelectorAll('[data-remove-chat-action]').forEach((button) => {
    button.addEventListener('click', () => {
      state.chatActions.splice(Number(button.dataset.removeChatAction), 1);
      renderChatActions();
    });
  });
  $('addChatActionBtn').disabled = !state.canWrite || state.chatActions.length >= 3;
}

function updateChatAction(index, field, value) {
  const action = state.chatActions[index];
  if (!action) return;
  if (field === 'type') {
    if (value === 'URL' && state.chatActions.length > 1) {
      state.chatActions = [{ type: 'URL', title: action.title || '' }];
      toast('Il pulsante URL sostituisce le risposte rapide già inserite', 'ok');
    } else {
      state.chatActions = state.chatActions.map((item) => ({
        type: value,
        title: item.title || '',
        ...(value === 'QUICK_REPLY' ? { id: item.id || '' } : {}),
      }));
    }
    renderChatActions();
  } else if (field === 'title') action.title = value;
  else if (action.type === 'URL') action.url = value;
  else if (action.type === 'PHONE_NUMBER') action.phone = value;
  else action.id = value;
}

function addChatAction() {
  if (state.chatActions.length >= 3) return;
  const type = state.chatActions[0]?.type || 'URL';
  if (type === 'URL' && state.chatActions.length) {
    return toast('Per i messaggi operatore è consentito un solo pulsante URL', 'err');
  }
  state.chatActions.push({ type, title: '' });
  renderChatActions();
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

async function deleteConversation() {
  if (!state.selectedConversationId || !state.currentConversation) return;
  const id = state.selectedConversationId;
  const phone = state.currentConversation.phone_number;
  if (!confirm(`Eliminare definitivamente la conversazione con ${phone}?\n\nI messaggi saranno cancellati. Lo storico dei broadcast resterà disponibile.`)) return;
  try {
    await api(`/api/chat/conversations/${id}`, { method: 'DELETE' });
    state.selectedConversationId = null;
    state.currentConversation = null;
    state.messages = [];
    clearChatAttachment();
    state.chatActions = [];
    renderChatActions();
    renderChat();
    await loadConversations();
    toast('Conversazione eliminata');
  } catch (err) {
    toast(err.message, 'err');
  }
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
          media_url: ev.message.media_url,
          media_type: ev.message.media_type,
          media_name: ev.message.media_name,
          actions: ev.message.actions || [],
          content_sid: ev.message.content_sid,
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
    state.socket.on('conversation-deleted', (ev) => {
      if (ev.botId !== state.selectedBotId) return;
      if (ev.conversationId === state.selectedConversationId) {
        state.selectedConversationId = null;
        state.currentConversation = null;
        state.messages = [];
        renderChat();
      }
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

function initials(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : words[0]?.slice(0, 2) || 'BT').toUpperCase();
}

function applyBotsColumnState() {
  $('dashboard').classList.toggle('bots-collapsed', state.botsCollapsed);
  const button = $('toggleBotsBtn');
  button.textContent = state.botsCollapsed ? '›' : '‹';
  const label = state.botsCollapsed ? 'Espandi colonna BOT' : 'Riduci colonna BOT';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-expanded', String(!state.botsCollapsed));
}

function toggleBotsColumn() {
  state.botsCollapsed = !state.botsCollapsed;
  try { localStorage.setItem('un-bots-collapsed', state.botsCollapsed ? '1' : '0'); } catch {}
  applyBotsColumnState();
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

$('refreshBtn').addEventListener('click', loadConversations);
$('sendBtn').addEventListener('click', sendOperatorMessage);
$('closeBtn').addEventListener('click', closeConversation);
$('deleteConversationBtn').addEventListener('click', deleteConversation);
$('attachBtn').addEventListener('click', selectChatAttachment);
$('chatMediaFile').addEventListener('change', updateChatAttachment);
$('addChatActionBtn').addEventListener('click', addChatAction);
$('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOperatorMessage(); }
});
document.querySelectorAll('#modeSwitch button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode))
);

let searchTimer;
$('conversationSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadConversations, 300);
});
$('conversationStatus').addEventListener('change', loadConversations);
$('conversationBroadcast').addEventListener('change', loadConversations);
$('toggleBotsBtn').addEventListener('click', toggleBotsColumn);

(async () => {
  try { state.botsCollapsed = localStorage.getItem('un-bots-collapsed') === '1'; } catch {}
  applyBotsColumnState();
  await loadMe();
  await loadBots();
})();
