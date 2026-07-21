const state = { bots: [], editing: null };
const $ = (id) => document.getElementById(id);

function toast(msg, cls = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${cls}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: isForm ? (opts.headers || {}) : { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function loadMe() {
  try {
    const { user } = await api('/api/me');
    const can = (permission) => user.permissions.includes('*') || user.permissions.includes(permission);
    document.querySelectorAll('[data-permission]').forEach((item) => { item.hidden = !can(item.dataset.permission); });
    $('userEmail').innerHTML = `<span>${escape(user.displayName || user.username)}</span><button class="user-logout" id="logoutBtn">Esci</button>`;
    $('logoutBtn').addEventListener('click', logout);
  } catch {}
}

async function logout() { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); location.href = '/login'; }

async function loadBots() {
  const { bots } = await api('/api/bots');
  state.bots = bots;
  renderBots();
}

function renderBots() {
  const el = $('botsGrid');
  if (!state.bots.length) {
    el.innerHTML = '<div class="card empty-list">Nessun BOT configurato. Crea il primo BOT per iniziare.</div>';
    return;
  }
  el.innerHTML = state.bots.map((c) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:600;font-size:16px">${escape(c.name)}</div>
          <div style="color:var(--muted);font-size:12px;margin-top:7px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${escape(c.twilio_number)} · ${escape(c.provider)} / ${escape(c.model)} · lang ${escape(c.language)}
            · <span class="badge ${c.active ? 'on' : 'off'}">${c.active ? 'attivo' : 'inattivo'}</span>
            · <span class="badge">${c.rag_enabled ? 'RAG on' : 'RAG off'}</span>
            · <span class="badge ${c.api_key_configured ? 'on' : 'off'}">API key ${c.api_key_configured ? 'configurata' : 'mancante'}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="secondary" data-edit="${c.id}">Modifica</button>
          <button data-docs="${c.id}">Documenti</button>
        </div>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openEditor(state.bots.find((x) => x.id === b.dataset.edit)))
  );
  el.querySelectorAll('[data-docs]').forEach((b) =>
    b.addEventListener('click', () => openDocs(state.bots.find((x) => x.id === b.dataset.docs)))
  );
}

function openEditor(bot) {
  state.editing = bot || null;
  $('editor').style.display = 'block';
  $('editorTitle').textContent = bot ? `Modifica ${bot.name}` : 'Nuovo BOT';
  $('deleteBtn').style.display = bot ? 'inline-block' : 'none';

  const v = bot || {
    name: '', slug: '', twilio_number: '',
    provider: 'openai', model: 'gpt-4o', temperature: 0.7,
    language: 'it', system_prompt: '', transfer_keywords: [],
    rag_enabled: true, active: true,
  };
  $('f_name').value = v.name;
  $('f_slug').value = v.slug;
  $('f_twilio').value = v.twilio_number;
  $('f_provider').value = v.provider;
  $('f_model').value = v.model;
  $('f_api_key').value = '';
  $('f_api_key').required = !bot;
  $('apiKeyHint').textContent = bot && v.api_key_configured
    ? 'Chiave configurata. Lascia vuoto per mantenerla invariata.'
    : 'Obbligatoria alla creazione. Non sarà mai mostrata di nuovo.';
  $('f_temperature').value = v.temperature;
  $('f_language').value = v.language;
  $('f_prompt').value = v.system_prompt;
  $('f_transfer').value = (v.transfer_keywords || []).join(',');
  $('f_rag').checked = !!v.rag_enabled;
  $('f_active').checked = !!v.active;
  syncProviderOptions();

  $('docsCard').style.display = 'none';
  $('editor').scrollIntoView({ behavior: 'smooth' });
}

function collectForm() {
  const data = {
    name: $('f_name').value.trim(),
    slug: $('f_slug').value.trim(),
    twilio_number: $('f_twilio').value.trim(),
    provider: $('f_provider').value,
    model: $('f_model').value.trim() || 'gpt-4o',
    temperature: parseFloat($('f_temperature').value || '0.7'),
    language: $('f_language').value,
    system_prompt: $('f_prompt').value,
    transfer_keywords: $('f_transfer').value.split(',').map((s) => s.trim()).filter(Boolean),
    rag_enabled: $('f_rag').checked,
    active: $('f_active').checked,
  };
  const apiKey = $('f_api_key').value.trim();
  if (apiKey) data.ai_api_key = apiKey;
  return data;
}

function syncProviderOptions() {
  const isOpenAi = $('f_provider').value === 'openai';
  $('f_rag').disabled = !isOpenAi;
  if (!isOpenAi) $('f_rag').checked = false;
  $('ragHint').textContent = isOpenAi ? '' : '(disponibile con OpenAI)';
}

async function save() {
  const data = collectForm();
  try {
    if (state.editing) {
      await api(`/api/bots/${state.editing.id}`, {
        method: 'PUT', body: JSON.stringify(data),
      });
      toast('BOT aggiornato');
    } else {
      await api('/api/bots', { method: 'POST', body: JSON.stringify(data) });
      toast('BOT creato');
    }
    $('editor').style.display = 'none';
    state.editing = null;
    await loadBots();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function remove() {
  if (!state.editing) return;
  if (!confirm(`Eliminare "${state.editing.name}"? Verranno cancellate anche tutte le conversazioni e i documenti.`)) return;
  await api(`/api/bots/${state.editing.id}`, { method: 'DELETE' });
  toast('BOT eliminato');
  $('editor').style.display = 'none';
  state.editing = null;
  await loadBots();
}

async function openDocs(bot) {
  state.editing = bot;
  $('editor').style.display = 'none';
  $('docsCard').style.display = 'block';
  $('docsCard').scrollIntoView({ behavior: 'smooth' });
  await loadDocs();
}

async function loadDocs() {
  if (!state.editing) return;
  const { documents } = await api(`/api/documents?botId=${state.editing.id}`);
  const el = $('docsList');
  if (!documents.length) {
    el.innerHTML = '<div class="empty-list">Nessun documento.</div>';
    return;
  }
  el.innerHTML = documents.map((d) => `
    <div class="list-item" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="title">${escape(d.filename)}</div>
        <div class="sub">${d.chunk_count} chunk · ${new Date(d.created_at).toLocaleString('it-IT')}</div>
      </div>
      <button class="danger" data-del="${d.id}">Elimina</button>
    </div>
  `).join('');
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => deleteDoc(b.dataset.del))
  );
}

async function upload() {
  if (!state.editing) return;
  const f = $('pdfFile').files[0];
  if (!f) return toast('Seleziona un PDF', 'err');
  const fd = new FormData();
  fd.append('document', f);
  fd.append('botId', state.editing.id);
  $('uploadBtn').disabled = true;
  try {
    const r = await api('/api/documents/upload', { method: 'POST', body: fd });
    toast(`Caricato: ${r.chunks} chunk`);
    $('pdfFile').value = '';
    await loadDocs();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    $('uploadBtn').disabled = false;
  }
}

async function deleteDoc(id) {
  if (!confirm('Eliminare il documento?')) return;
  await api(`/api/documents/${id}?botId=${state.editing.id}`, { method: 'DELETE' });
  await loadDocs();
}

$('newBtn').addEventListener('click', () => openEditor(null));
$('saveBtn').addEventListener('click', save);
$('cancelBtn').addEventListener('click', () => { $('editor').style.display = 'none'; state.editing = null; });
$('deleteBtn').addEventListener('click', remove);
$('uploadBtn').addEventListener('click', upload);
$('f_provider').addEventListener('change', syncProviderOptions);

(async () => { await loadMe(); await loadBots(); })();
