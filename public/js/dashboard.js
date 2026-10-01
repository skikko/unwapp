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
      $('archiveBtn').hidden = true; $('unreadBtn').hidden = true;
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
  const select = $('botSelect');
  if (!bots.length) {
    select.innerHTML = '<option value="">Nessun BOT configurato</option>';
    select.disabled = true;
    $('conversationsList').innerHTML = '<div class="empty-list">Nessun BOT configurato. Collega un numero Twilio dalla sezione BOT.</div>';
    return;
  }
  select.innerHTML = bots.map((bot) => `<option value="${bot.id}">${escape(bot.name)}</option>`).join('');
  select.disabled = false;
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
  $('conversationArchive').value = 'active';
  $('conversationSearch').disabled = false;
  $('conversationStatus').disabled = false;
  $('conversationBroadcast').disabled = false;
  $('conversationArchive').disabled = false;
  $('botSelect').value = botId;
  renderChatActions();
  renderChat();
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
  const archived = $('conversationArchive').value === 'archived';
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (broadcast) params.set('broadcast', broadcast);
  if (archived) params.set('archived', 'true');
  const { conversations, filters = {} } = await api(`/api/chat/conversations?${params}`);
  if (requestId !== state.conversationRequest || cid !== state.selectedBotId) return;
  state.conversations = conversations;
  state.conversationFilters = filters;
  renderConversationFilterOptions();
  const el = $('conversationsList');
  if (!conversations.length) {
    const hasFilters = Boolean(search || status || broadcast || archived);
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
      ? '<span class="badge human">Operatore</span>'
      : c.status === 'closed'
      ? '<span class="badge">Chiusa</span>'
      : '<span class="badge bot">BOT</span>';
    const unread = Number(c.unread_count || 0);
    return `
      <div class="list-item ${c.id === state.selectedConversationId ? 'active' : ''} ${unread ? 'is-unread' : ''}" data-id="${c.id}">
        ${unread ? `<span class="unread" title="${unread} messaggi non letti" aria-label="${unread} messaggi non letti"></span>` : ''}
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
  updateUnreadSummary();
}

function updateUnreadSummary() {
  const unread = state.conversations.reduce((total, conversation) => total + Number(conversation.unread_count || 0), 0);
  document.title = unread ? `(${unread}) UN WhatsApp Manager` : 'UN WhatsApp Manager';
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
    const source = campaign.source_filename ? ` / ${campaign.source_filename}` : '';
    return `<option value="campaign:${escape(campaign.id)}">${escape(campaign.name || campaign.template_sid)}${escape(source)} / ${date}</option>`;
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
  if (state.canWrite && Number(conversation.unread_count || 0) > 0) {
    const result = await api(`/api/chat/conversations/${id}/read-state`, {
      method: 'PATCH', body: JSON.stringify({ unread: false }),
    });
    state.currentConversation = result.conversation;
  }
  renderChat();
  document.querySelectorAll('#conversationsList .list-item').forEach((n) =>
    n.classList.toggle('active', n.dataset.id === id)
  );
  if (Number(conversation.unread_count || 0) > 0) await loadConversations();
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
  ].filter(Boolean).join(' / ');

  // Barra di stato e selettore della modalità.
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
  $('archiveBtn').textContent = conv.archived_at ? 'Ripristina' : 'Archivia';
  $('unreadBtn').textContent = Number(conv.unread_count || 0) > 0 ? 'Segna come letta' : 'Segna come non letta';

  // Messaggi.
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
  if (message.content) {
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
  return { user: 'Cliente', bot: 'BOT', operator: 'Operatore', system: 'Sistema' }[r] || r;
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
    // Ricarica la conversazione per mostrare la modalità operatore.
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
      <button class="danger" data-remove-chat-action="${index}" type="button">Rimuovi</button>
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
    // Il backend passa alla modalità operatore al primo messaggio inviato.
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

async function archiveConversation() {
  if (!state.selectedConversationId || !state.currentConversation) return;
  const archived = !state.currentConversation.archived_at;
  await api(`/api/chat/conversations/${state.selectedConversationId}/archive`, {
    method: 'PATCH', body: JSON.stringify({ archived }),
  });
  state.selectedConversationId = null;
  state.currentConversation = null;
  state.messages = [];
  renderChat();
  await loadConversations();
  toast(archived ? 'Conversazione archiviata' : 'Conversazione ripristinata');
}

async function toggleConversationUnread() {
  if (!state.selectedConversationId || !state.currentConversation) return;
  const unread = Number(state.currentConversation.unread_count || 0) === 0;
  const result = await api(`/api/chat/conversations/${state.selectedConversationId}/read-state`, {
    method: 'PATCH', body: JSON.stringify({ unread }),
  });
  state.currentConversation = result.conversation;
  renderChat();
  await loadConversations();
  toast(unread ? 'Conversazione segnata come non letta' : 'Conversazione segnata come letta');
}

function syncNotificationButton() {
  const button = $('notificationBtn');
  if (!('Notification' in window)) {
    button.hidden = true;
    return;
  }
  button.textContent = Notification.permission === 'granted' ? 'Notifiche attive' : 'Attiva notifiche';
  button.disabled = Notification.permission === 'granted';
}

async function enableNotifications() {
  if (!('Notification' in window)) return;
  const permission = await Notification.requestPermission();
  syncNotificationButton();
  toast(permission === 'granted' ? 'Notifiche del browser attivate' : 'Notifiche del browser non autorizzate', permission === 'granted' ? 'ok' : 'err');
}

function notifyIncomingMessage(event) {
  const bot = state.bots.find((item) => item.id === event.botId);
  const sender = event.contactName || event.phoneNumber || 'Nuovo contatto';
  toast(`Nuovo messaggio da ${sender}`);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    const notification = new Notification(`Nuovo messaggio da ${sender}`, {
      body: String(event.message?.content || '').slice(0, 140),
      tag: `conversation-${event.conversationId}`,
    });
    notification.onclick = () => {
      window.focus();
      if (bot && bot.id !== state.selectedBotId) selectBot(bot.id).then(() => selectConversation(event.conversationId));
      else selectConversation(event.conversationId);
      notification.close();
    };
  }
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
    state.socket.on('new-message', async (ev) => {
      if (ev.message.role === 'user') notifyIncomingMessage(ev);
      if (ev.botId !== state.selectedBotId) return;
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
        if (ev.message.role === 'user' && state.canWrite) {
          await api(`/api/chat/conversations/${ev.conversationId}/read-state`, {
            method: 'PATCH', body: JSON.stringify({ unread: false }),
          });
        }
      }
      await loadConversations();
    });
    state.socket.on('attention-required', (ev) => {
      if (ev.botId === state.selectedBotId) {
        toast(`Attenzione richiesta: ${ev.phoneNumber}`, 'err');
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
    state.socket.on('conversation-archived', (ev) => {
      if (ev.botId === state.selectedBotId) loadConversations();
    });
    state.socket.on('conversation-read-state', (ev) => {
      if (ev.botId === state.selectedBotId) loadConversations();
    });
  }
  state.bots.forEach((bot) => state.socket.emit('join-bot', bot.id));
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
$('archiveBtn').addEventListener('click', archiveConversation);
$('unreadBtn').addEventListener('click', toggleConversationUnread);
$('notificationBtn').addEventListener('click', enableNotifications);
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
$('botSelect').addEventListener('change', (event) => selectBot(event.target.value));
$('conversationArchive').addEventListener('change', () => {
  state.selectedConversationId = null;
  state.currentConversation = null;
  state.messages = [];
  renderChat();
  loadConversations();
});

(async () => {
  syncNotificationButton();
  await loadMe();
  await loadBots();
})();
