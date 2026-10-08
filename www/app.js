/* MyMilo Android — chat client (v1)
 *
 * Talks to cloud MyMilo (v0.31.0+) with a device token.
 * Offline-first: messages queue locally when the network is down
 * and flush when it returns. Sessions sync from the server.
 */
'use strict';

// ── State ──────────────────────────────────────────────────
const store = {
  get server() { return localStorage.getItem('milo_server') || 'https://mymilo.aimlds.org'; },
  set server(v) { localStorage.setItem('milo_server', v); },
  get token() { return localStorage.getItem('milo_token') || ''; },
  set token(v) { localStorage.setItem('milo_token', v); },
  get queue() { try { return JSON.parse(localStorage.getItem('milo_queue') || '[]'); } catch { return []; } },
  set queue(v) { localStorage.setItem('milo_queue', JSON.stringify(v)); },
  get lastSync() { return parseFloat(localStorage.getItem('milo_last_sync') || '0'); },
  set lastSync(v) { localStorage.setItem('milo_last_sync', String(v)); },
};

let currentSessionId = null;
let sending = false;

const $ = (id) => document.getElementById(id);
const log = $('log');

// ── API ────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(store.server + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + store.token,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = 'Request failed: ' + res.status;
    try { const j = await res.json(); msg = (j.error && j.error.message) || j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ── Rendering ──────────────────────────────────────────────
function addMsg(role, content, pending = false) {
  const div = document.createElement('div');
  div.className = 'msg ' + role + (pending ? ' pending' : '');
  div.textContent = content;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function setStatus() {
  const el = $('status');
  const online = navigator.onLine;
  el.textContent = online ? '● online' : '● offline';
  el.classList.toggle('offline', !online);
}

// ── Sessions ───────────────────────────────────────────────
async function loadSessions() {
  try {
    const data = await api('/v1/sessions');
    const list = $('session-list');
    list.innerHTML = '';
    (data.sessions || []).forEach((s) => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
      item.textContent = s.title || 'Chat';
      item.onclick = () => openSession(s.id);
      list.appendChild(item);
    });
  } catch { /* offline: keep local state */ }
}

async function openSession(sid) {
  currentSessionId = sid;
  $('drawer').classList.add('hidden');
  log.innerHTML = '';
  try {
    const data = await api('/v1/sessions/' + sid);
    (data.messages || []).forEach((m) => addMsg(m.role, m.content));
  } catch {
    addMsg('assistant', 'Could not load this chat (offline?).');
  }
  loadSessions();
}

// ── Sync (delta, on startup + when back online) ────────────
async function syncNow() {
  if (!navigator.onLine || !store.token) return;
  try {
    const data = await api('/v1/sync/sessions?since=' + store.lastSync);
    if (data.server_time) store.lastSync = data.server_time;
    loadSessions();
  } catch { /* best-effort */ }
}

// ── Offline queue ──────────────────────────────────────────
async function flushQueue() {
  if (!navigator.onLine || sending) return;
  const q = store.queue;
  if (!q.length) return;
  const item = q[0];
  try {
    await sendToServer(item.text, item.el);
    q.shift();
    store.queue = q;
    if (q.length) flushQueue();
  } catch { /* still offline or server down — retry later */ }
}

// ── Chat ───────────────────────────────────────────────────
async function sendToServer(text, pendingEl) {
  const messages = [{ role: 'user', content: text }];
  const payload = { model: 'auto', messages, session_id: currentSessionId };
  const data = await api('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (data.session_id) currentSessionId = data.session_id;
  const reply = data.choices?.[0]?.message?.content || '(no reply)';
  if (pendingEl) pendingEl.remove();
  addMsg('assistant', reply);
  loadSessions();
}

async function onSend(e) {
  e.preventDefault();
  const input = $('input');
  const text = input.value.trim();
  if (!text || sending) return;
  input.value = '';
  input.style.height = 'auto';
  addMsg('user', text);

  if (!navigator.onLine) {
    const el = addMsg('assistant', 'Queued — will send when you are back online.', true);
    const q = store.queue;
    q.push({ text, el: null });
    store.queue = q;
    // Note: pending element is transient; queue stores text only.
    el.dataset.queued = '1';
    return;
  }

  sending = true;
  $('send-btn').disabled = true;
  const pending = addMsg('assistant', '…', true);
  try {
    await sendToServer(text, pending);
  } catch (err) {
    pending.remove();
    if (!navigator.onLine) {
      const q = store.queue;
      q.push({ text, el: null });
      store.queue = q;
      addMsg('assistant', 'You went offline — message queued.', true);
    } else {
      addMsg('assistant', 'Error: ' + err.message);
    }
  } finally {
    sending = false;
    $('send-btn').disabled = false;
  }
}

// Queued messages need their session context; on flush, send as new messages
// in the current session (v1 simplification).
setInterval(() => { if (navigator.onLine) flushQueue(); }, 15000);

// ── Setup ──────────────────────────────────────────────────
async function onConnect() {
  const url = $('server-url').value.trim().replace(/\/$/, '');
  const token = $('device-token').value.trim();
  const errEl = $('setup-error');
  errEl.textContent = '';
  if (!token) { errEl.textContent = 'Paste your device token.'; return; }
  store.server = url;
  store.token = token;
  try {
    await api('/v1/client/config');
    showChat();
  } catch (e) {
    errEl.textContent = 'Could not connect: ' + e.message;
    store.token = '';
  }
}

function showSetup() {
  $('setup').classList.remove('hidden');
  $('chat').classList.add('hidden');
  $('server-url').value = store.server;
}

function showChat() {
  $('setup').classList.add('hidden');
  $('chat').classList.remove('hidden');
  setStatus();
  loadSessions();
  syncNow();
}

// ── Wire up ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('connect-btn').onclick = onConnect;
  $('composer').addEventListener('submit', onSend);
  $('menu-btn').onclick = () => $('drawer').classList.toggle('hidden');
  $('new-chat-btn').onclick = () => {
    currentSessionId = null;
    log.innerHTML = '';
    $('drawer').classList.add('hidden');
    addMsg('assistant', 'New chat — what can I do for you?');
  };
  $('disconnect-btn').onclick = () => {
    if (confirm('Disconnect this device? You will need a new token to reconnect.')) {
      store.token = '';
      showSetup();
    }
  };
  const input = $('input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); }
  });
  window.addEventListener('online', () => { setStatus(); syncNow(); flushQueue(); });
  window.addEventListener('offline', setStatus);

  if (store.token) showChat(); else showSetup();
});
