// admin-init.js — Bootstrap, login, stats, QR, sidebar
// Dépendances : admin-system.js et admin-channels.js doivent être chargés avant

// Nettoyer l'URL dès le chargement — supprime les query params sans recharger la page
if (window.location.search) {
  history.replaceState(null, '', '/admin');
}

// Security by design : le mot de passe n'est utilisé qu'une seule fois au login.
// Toutes les requêtes suivantes utilisent un token HMAC signé à durée limitée.
let adminToken = '';
let tokenExpiry = 0;
let selectedChannelId = null;
let allChannels = [];
let stats = {};

function isTokenValid() {
  return adminToken && Date.now() < tokenExpiry - 60000;
}

function checkTokenExpiry() {
  if (adminToken && !isTokenValid()) {
    log('Session expirée — veuillez vous reconnecter.', 'warn');
    doLogout();
  }
}
setInterval(checkTokenExpiry, 30000);

// --- LOGIN ---
document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  login();
});
document.getElementById('form-change-pwd').addEventListener('submit', (e) => {
  e.preventDefault();
  changePassword();
});

async function login() {
  const pwd = document.getElementById('login-pwd').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('msg-hidden');
  try {
    const r = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    if (!r.ok) throw new Error();
    const data = await r.json();
    adminToken = data.token;
    tokenExpiry = Date.now() + (data.expiresIn || 8 * 3600 * 1000);
    document.getElementById('login-screen').classList.add('hidden-screen');
    document.getElementById('app').classList.add('visible');
    init();
  } catch {
    errEl.classList.remove('msg-hidden');
    document.getElementById('login-pwd').value = '';
    document.getElementById('login-pwd').focus();
  }
}

// --- INIT ---
const ICON_LIST = ['🎧','🎵','🎶','🔊','📻','🎙','🎤','🎼','🎹','🎸','🥁','🎺','🎻','🎷','🔔','📢','💬','🌍','🌐','♿','👂','🦻','💡','⭐','🎯','🎭','🏛','🎪','🎬','🗣'];

function buildIconGrid(gridId, inputId, previewId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = ICON_LIST.map(e =>
    `<button type="button" class="icon-btn" title="${e}"
      data-action="set-icon" data-input="${inputId}" data-preview="${previewId}" data-value="${e}">${e}</button>`
  ).join('');
}

function init() {
  ViewState.show(ViewState.VIEWS.OVERVIEW);
  initEventListeners();
  connectAdminWs();
  loadQr();
  loadChannels();
  buildIconGrid('new-icon-grid', 'new-icon', 'new-icon-preview');
}

function updateStats(data) {
  if (!data) return;
  stats = data;
  document.getElementById('stat-active').textContent = data.activeChannels || 0;
  document.getElementById('stat-total').textContent = data.totalChannels || 0;
  document.getElementById('stat-listeners').textContent = data.totalListeners || 0;
  if (data.activeStreams) document.getElementById('stat-streams').textContent = data.activeStreams.length || 0;
  if (data.channels) {
    allChannels = allChannels.map(ch => {
      const upd = data.channels.find(c => c.id === ch.id);
      return upd ? { ...ch, ...upd } : ch;
    });
    renderSidebar();
  }
}

async function loadChannels() {
  try {
    const r = await apiFetch('/api/admin/channels');
    allChannels = await r.json();
    renderSidebar();
    if (selectedChannelId) {
      const ch = allChannels.find(c => c.id === selectedChannelId);
      if (ch) renderChannelDetail(ch);
    }
    const sr = await apiFetch('/api/admin/stats');
    const s = await sr.json();
    updateStats(s);
  } catch (e) {
    log('Erreur chargement canaux: ' + e.message, 'error');
  }
}

async function loadQr() {
  const urlEl = document.getElementById('qr-url');
  const imgEl = document.getElementById('qr-img');
  try {
    const r = await fetch('/api/qrcode');
    if (!r.ok) {
      const txt = await r.text();
      if (urlEl) { urlEl.className = 'qr-error'; urlEl.textContent = `Erreur ${r.status}: ${txt}`; }
      return;
    }
    const data = await r.json();
    if (imgEl && data.qrcode) {
      imgEl.setAttribute('src', data.qrcode);
    }
    if (urlEl) {
      urlEl.className = 'qr-url';
      urlEl.textContent = data.url || '';
      if (data.isDualNetwork && data.adminUrl) {
        const note = document.createElement('div');
        note.className = 'qr-note';
        note.textContent = '🌐 Mode double interface — QR code pointe sur le réseau public';
        urlEl.parentNode.insertBefore(note, urlEl.nextSibling);
        const adminNote = document.createElement('div');
        adminNote.className = 'qr-admin-note';
        adminNote.textContent = `🔧 Admin : ${data.adminUrl}`;
        urlEl.parentNode.insertBefore(adminNote, note.nextSibling);
      }
    }
  } catch (e) {
    console.error('[QR] Error:', e);
    if (urlEl) { urlEl.className = 'qr-error'; urlEl.textContent = `Erreur: ${e.message}`; }
  }
}

function renderSidebar() {
  const el = document.getElementById('channels-sidebar');
  if (allChannels.length === 0) {
    el.innerHTML = `<div class="sidebar-empty">Aucun canal. Créez-en un.</div>`;
    return;
  }
  el.innerHTML = allChannels.map(ch => `
    <div class="ch-item ${selectedChannelId === ch.id ? 'selected' : ''}" data-id="${ch.id}">
      <div class="ch-item-top">
        <div class="ch-dot ${ch.active ? 'live' : ''}"></div>
        <div class="ch-name">${escHtml(ch.name)}</div>
        <div class="ch-icon">${ch.icon}</div>
      </div>
      <div class="ch-meta">
        <span class="ch-lang">${ch.language.toUpperCase()}</span>
        <span class="ch-listeners">👥 ${ch.listenerCount}</span>
        <span class="ch-status-label ${ch.active ? 'ch-status-live' : ''}">${ch.active ? '● LIVE' : '○ Arrêté'}</span>
      </div>
    </div>
  `).join('');
}

function selectChannel(id) {
  ViewState.show(ViewState.VIEWS.CHANNEL, id);
}

function showOverview() {
  ViewState.show(ViewState.VIEWS.OVERVIEW);
}
