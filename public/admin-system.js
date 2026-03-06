// admin-system.js — ViewState, utils, vue système, events, password, focus trap

// --- GESTIONNAIRE DE VUE CENTRALISÉ ---
const ViewState = {
  current: 'overview',
  previous: null,

  VIEWS: {
    OVERVIEW: 'overview',
    CHANNEL: 'channel',
    SYSTEM: 'system'
  },

  hideAll() {
    const overviewView = document.getElementById('view-overview');
    if (overviewView) overviewView.classList.add('hidden-screen');

    const channelView = document.getElementById('view-channel');
    if (channelView) channelView.classList.remove('visible');

    const systemView = document.getElementById('view-system');
    if (systemView) {
      systemView.classList.add('view-hidden');
      systemView.classList.remove('view-visible');
    }
  },

  show(view, data = null) {
    if (!Object.values(this.VIEWS).includes(view)) {
      console.error('Vue invalide:', view);
      return;
    }
    this.previous = this.current;
    this.current = view;
    this.hideAll();
    switch (view) {
      case this.VIEWS.OVERVIEW: this.showOverview(); break;
      case this.VIEWS.CHANNEL:  this.showChannel(data); break;
      case this.VIEWS.SYSTEM:   this.showSystem(); break;
    }
  },

  showOverview() {
    selectedChannelId = null;
    renderSidebar();
    const overviewView = document.getElementById('view-overview');
    if (overviewView) overviewView.classList.remove('hidden-screen');
    const channelView = document.getElementById('view-channel');
    if (channelView) channelView.classList.remove('visible');
    const systemView = document.getElementById('view-system');
    if (systemView) { systemView.classList.add('view-hidden'); systemView.classList.remove('view-visible'); }
    const titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = 'Vue d\'ensemble';
    updateBreadcrumbs(this.VIEWS.OVERVIEW);
    updateHeaderActions();
  },

  showChannel(channelId) {
    selectedChannelId = channelId;
    renderSidebar();
    const ch = allChannels.find(c => c.id === channelId);
    if (!ch) { console.error('Canal non trouvé:', channelId); this.showOverview(); return; }
    const channelView = document.getElementById('view-channel');
    if (channelView) channelView.classList.add('visible');
    const titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = ch.name;
    updateBreadcrumbs(this.VIEWS.CHANNEL, ch.name);
    updateHeaderActions();
    renderChannelDetail(ch);
  },

  showSystem() {
    _sysViewOpen = true;
    const systemView = document.getElementById('view-system');
    if (systemView) { systemView.classList.remove('view-hidden'); systemView.classList.add('view-visible'); }
    const titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = 'Système';
    updateBreadcrumbs(this.VIEWS.SYSTEM);
    updateHeaderActions();
    refreshSystemView();
    _sysRefreshTimer = setInterval(refreshSystemView, 15000);
  },

  hideSystem() {
    _sysViewOpen = false;
    const systemView = document.getElementById('view-system');
    if (systemView) { systemView.classList.add('view-hidden'); systemView.classList.remove('view-visible'); }
    clearInterval(_sysRefreshTimer);
    _sysRefreshTimer = null;
  }
};

// --- UTILS ---
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function setBar(barId, pct) {
  const el = document.getElementById(barId);
  if (!el) return;
  const clamped = Math.max(0, Math.min(100, pct));
  el.style.setProperty('--bar-width', clamped + '%');
  el.style.width = clamped + '%';
  el.classList.remove('warn', 'danger');
  if (clamped >= 90) el.classList.add('danger');
  else if (clamped >= 70) el.classList.add('warn');
}

function fmtBytes(b) {
  if (!b && b !== 0) return '—';
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' Go';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' Mo';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' Ko';
  return b + ' o';
}

function fmtUptime(s) {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  let r = '';
  if (d > 0) r += d + 'j ';
  if (h > 0 || d > 0) r += h + 'h ';
  r += m + 'min';
  return r;
}

function apiFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken,
      ...(opts.headers || {}),
    },
  }).then(r => {
    if (r.status === 401 && adminToken) {
      doLogout();
      throw new Error('Session expirée, veuillez vous reconnecter.');
    }
    if (!r.ok) return r.json().then(d => { throw new Error(d.error || r.statusText); });
    return r;
  });
}

function log(msg, level = 'info') {
  const panel = document.getElementById('log-panel');
  const now = new Date().toLocaleTimeString('fr-FR');
  const el = document.createElement('div');
  el.className = `log-entry ${level}`;
  el.textContent = `[${now}] ${msg}`;
  panel.appendChild(el);
  panel.scrollTop = panel.scrollHeight;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateBreadcrumbs(view, channelName) {
  const bc = document.getElementById('breadcrumbs');
  if (!bc) return;
  if (view === ViewState.VIEWS.OVERVIEW) {
    bc.innerHTML = '<span class="breadcrumb-item active" data-view="overview">Vue d\'ensemble</span>';
  } else if (view === ViewState.VIEWS.CHANNEL) {
    bc.innerHTML = `<span class="breadcrumb-item" data-view="overview">Vue d'ensemble</span>
      <span class="breadcrumb-separator">›</span>
      <span class="breadcrumb-item active">${escHtml(channelName || '')}</span>`;
  } else if (view === ViewState.VIEWS.SYSTEM) {
    bc.innerHTML = `<span class="breadcrumb-item" data-view="overview">Vue d'ensemble</span>
      <span class="breadcrumb-separator">›</span>
      <span class="breadcrumb-item active">Système</span>`;
  }
}

function updateHeaderActions() {
  const btnSystem = document.getElementById('btn-system');
  if (btnSystem) {
    btnSystem.classList.toggle('active', ViewState.current === ViewState.VIEWS.SYSTEM);
  }
  const btnOverview = document.getElementById('btn-overview');
  if (btnOverview) {
    btnOverview.classList.toggle('hidden-screen', ViewState.current === ViewState.VIEWS.OVERVIEW);
  }
}

// --- VUE SYSTÈME ---
let _sysViewOpen = false;
let _sysRefreshTimer = null;

async function loadSystemInfo() {
  try {
    const data = await apiFetch('/api/admin/system/info');
    const cpu = data.cpu;
    const mem = data.memory;
    const disk = data.disk;

    const cpuPct = cpu.loadPercent;
    const cpuText = cpu.loadAvgReliable ? cpuPct + '%' : cpuPct + '% (container)';
    setText('sys-cpu-pct', cpuText);
    setBar('sys-cpu-bar', cpuPct);

    const load1Text  = cpu.loadAvgReliable ? cpu.loadAvg1  : cpu.loadAvg1  + ' ⚠️';
    const load5Text  = cpu.loadAvgReliable ? cpu.loadAvg5  : cpu.loadAvg5  + ' ⚠️';
    const load15Text = cpu.loadAvgReliable ? cpu.loadAvg15 : cpu.loadAvg15 + ' ⚠️';
    setText('sys-load1', load1Text);
    setText('sys-load5', load5Text);
    setText('sys-load15', load15Text);

    let cpuModel = (cpu.model || '').split(' ').slice(0, 3).join(' ');
    if (cpu.isContainerized && cpuModel !== 'unknown') cpuModel += ' 🐳';
    setText('sys-cores', cpu.count + ' × ' + cpuModel);

    const memPct = mem.usedPercent;
    setText('sys-mem-pct',   memPct + '%');
    setBar('sys-mem-bar', memPct);
    setText('sys-mem-used',  fmtBytes(mem.used));
    setText('sys-mem-free',  fmtBytes(mem.free));
    setText('sys-mem-total', fmtBytes(mem.total));
    setText('sys-uptime', 'Uptime : ' + fmtUptime(data.uptime));

    if (disk) {
      const diskPct = Math.round((disk.used / disk.total) * 100);
      setText('sys-disk-pct',   diskPct + '%');
      setBar('sys-disk-bar', diskPct);
      setText('sys-disk-used',  fmtBytes(disk.used));
      setText('sys-disk-free',  fmtBytes(disk.free));
      setText('sys-disk-total', fmtBytes(disk.total));
    } else {
      setText('sys-disk-pct', 'N/A'); setText('sys-disk-used', '—'); setText('sys-disk-free', '—'); setText('sys-disk-total', '—');
    }

    setText('sys-node',     data.nodeVersion);
    setText('sys-platform', data.platform);
    setText('sys-env',      data.nodeEnv || '—');
    setText('sys-tls-cn',   data.tlsCn || '—');

    const now = new Date().toLocaleTimeString('fr-FR');
    setText('sys-last-update', 'Dernière mise à jour : ' + now);
  } catch (e) {
    log('Erreur chargement infos système : ' + e.message, 'error');
  }
}

async function loadNetworkConfig() {
  try {
    const cfg = await apiFetch('/api/admin/network/config');
    const badge = document.getElementById('sys-net-mode');
    if (badge) {
      if (cfg.isDualNetwork) { badge.textContent = 'Double interface'; badge.classList.add('dual'); }
      else { badge.textContent = 'Interface unique'; badge.classList.remove('dual'); }
    }

    const adminDiv = document.getElementById('sys-netcfg-admin');
    const publicDiv = document.getElementById('sys-netcfg-public');
    const row = (key, val) => `<div class="netcfg-row"><span class="netcfg-key">${key}</span><span class="netcfg-val">${val || '—'}</span></div>`;

    if (adminDiv) adminDiv.innerHTML = `<div class="netcfg-section-title">
      ${cfg.isDualNetwork ? '🔴 Interface régie (admin)' : '⚪ Interface unique'}
    </div>
    ${row('Bind host', cfg.adminHost)}
    ${row('Port', cfg.adminPort)}
    ${row('URL admin', cfg.publicUrl)}
    ${cfg.isDualNetwork ? row('AES67 interface', cfg.multicastInterface || cfg.adminHost) : ''}`;

    if (publicDiv) publicDiv.innerHTML = cfg.isDualNetwork ? `<div class="netcfg-section-title">
      🟢 Interface WiFi public (écoute)
    </div>
    ${row('Bind host', cfg.publicHost)}
    ${row('Port', cfg.publicPort)}
    ${row('URL publique', cfg.publicListenerUrl || cfg.publicUrl)}
    ${row('TLS CN', cfg.tlsCn)}` :
    `<div class="netcfg-disabled">
      Mode double interface non actif.<br><br>
      Définissez <code class="netcfg-code">ADMIN_HOST</code> et
      <code class="netcfg-code">PUBLIC_HOST</code> dans les variables
      d'environnement Portainer pour activer le mode production dual-réseau.
    </div>`;
  } catch (e) {
    log('Erreur chargement config réseau : ' + e.message, 'error');
  }
}

async function loadNetworkInterfaces() {
  try {
    const ifaces = await apiFetch('/api/admin/network/interfaces');
    const tbody = document.getElementById('sys-iface-body');
    if (!tbody) return;
    if (!ifaces.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="sys-loading">Aucune interface détectée</td></tr>';
      return;
    }
    tbody.innerHTML = ifaces.map(i => `<tr>
      <td><span class="iface-name">${i.name}</span></td>
      <td><span class="iface-addr">${i.address}</span></td>
      <td class="iface-family">${i.family}</td>
      <td class="iface-netmask">${i.netmask || '—'}</td>
      <td class="iface-mac">${i.mac || '—'}</td>
    </tr>`).join('');
  } catch (e) {
    const tbody = document.getElementById('sys-iface-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="sys-error">Erreur : ${e.message}</td></tr>`;
  }
}

async function loadActiveStreams() {
  try {
    const data = await apiFetch('/api/admin/stats');
    const el = document.getElementById('sys-streams-body');
    if (!el) return;
    const streams = data.activeStreams || [];
    if (!streams.length) { el.textContent = 'Aucun stream actif.'; return; }
    const fmtAge = (iso) => {
      if (!iso) return '—';
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return s + 's';
      if (s < 3600) return Math.floor(s / 60) + 'min';
      return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'min';
    };
    el.innerHTML = `<table class="iface-table"><thead><tr>
      <th>Canal</th><th>ID</th><th>Type source</th><th>Statut</th><th>Actif depuis</th>
    </tr></thead><tbody>` +
    streams.map(s => `<tr>
      <td><span class="iface-name">${s.name || s.channelId}</span></td>
      <td class="stream-id">${s.channelId}</td>
      <td class="stream-type">${s.sourceType || '—'}</td>
      <td class="stream-status ${s.isVod ? 'stream-vod' : 'stream-live'}">${s.isVod ? 'VOD prêt' : 'En direct'}</td>
      <td class="stream-age">${fmtAge(s.startedAt)}</td>
    </tr>`).join('') + '</tbody></table>';
  } catch (e) {
    const el = document.getElementById('sys-streams-body');
    if (el) el.innerHTML = `<span class="sys-error">Erreur : ${e.message}</span>`;
  }
}

async function loadAudioSources() {
  try {
    const data = await apiFetch('/api/admin/sources/list');
    const el = document.getElementById('sys-audio-sources-body');
    if (!el) return;
    const alsa = data.alsa || [];
    const pulse = data.pulse || [];
    if (!alsa.length && !pulse.length) { el.textContent = 'Aucune source audio détectée (ALSA / PulseAudio).'; return; }
    let html = '';
    if (alsa.length) {
      html += `<div class="source-section-title">ALSA</div>`;
      html += `<table class="iface-table source-table-margin"><thead><tr>
        <th>Carte</th><th>Périphérique</th><th>Nom</th><th>Adresse FFmpeg</th>
      </tr></thead><tbody>`;
      html += alsa.map(d => `<tr>
        <td class="source-card">${d.card}</td>
        <td class="source-device">${d.device}</td>
        <td><span class="iface-name">${d.name}</span></td>
        <td class="source-ffmpeg">hw:${d.card},${d.device}</td>
      </tr>`).join('');
      html += '</tbody></table>';
    }
    if (pulse.length) {
      html += `<div class="source-section-title">PulseAudio</div>`;
      html += `<table class="iface-table"><thead><tr><th>Périphérique</th></tr></thead><tbody>`;
      html += pulse.map(d => `<tr><td class="source-pulse-device">${d.device}</td></tr>`).join('');
      html += '</tbody></table>';
    }
    el.innerHTML = html;
  } catch (e) {
    const el = document.getElementById('sys-audio-sources-body');
    if (el) el.innerHTML = `<span class="sys-error">Erreur : ${e.message}</span>`;
  }
}

async function loadVersion() {
  try {
    const r = await apiFetch('/api/admin/version');
    const data = await r.json();
    const versionEl = document.getElementById('sys-version');
    if (versionEl) {
      versionEl.innerHTML = `v${data.version} <span class="version-node">(Node ${data.nodeVersion})</span>`;
    }
  } catch (e) { console.warn('Erreur chargement version:', e); }
}

async function loadSystemConfig() {
  try {
    const r = await apiFetch('/api/admin/network/config');
    const data = await r.json();
    const nodeEl = document.getElementById('sys-node');
    if (nodeEl) nodeEl.textContent = data.nodeVersion || '—';
    const platformEl = document.getElementById('sys-platform');
    if (platformEl) {
      const platform = data.platform || 'unknown';
      const arch = data.arch || '';
      platformEl.textContent = arch ? `${platform} (${arch})` : platform;
    }
    const envEl = document.getElementById('sys-env');
    if (envEl) envEl.textContent = data.nodeEnv || 'development';
    const tlsEl = document.getElementById('sys-tls-cn');
    if (tlsEl) tlsEl.textContent = data.tlsCn || 'auto-généré';
  } catch (e) { console.warn('Erreur chargement config système:', e); }
}

async function refreshSystemView() {
  await Promise.all([
    loadSystemInfo(),
    loadNetworkConfig(),
    loadNetworkInterfaces(),
    loadActiveStreams(),
    loadAudioSources(),
    loadVersion(),
    loadSystemConfig()
  ]);
}

function showSystemView() { ViewState.show(ViewState.VIEWS.SYSTEM); }

function hideSystemView() {
  ViewState.hideSystem();
  if (ViewState.previous === ViewState.VIEWS.CHANNEL && selectedChannelId) {
    ViewState.show(ViewState.VIEWS.CHANNEL, selectedChannelId);
  } else {
    ViewState.show(ViewState.VIEWS.OVERVIEW);
  }
}

// --- DÉCONNEXION ---
function doLogout() {
  adminToken = '';
  tokenExpiry = 0;
  if (adminWs) { try { adminWs.close(); } catch(e) {} adminWs = null; }
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').classList.remove('hidden-screen');
  document.getElementById('login-pwd').value = '';
  document.getElementById('login-error').classList.add('msg-hidden');
}

// --- CHANGEMENT DE MOT DE PASSE ---
function closePwdModal() {
  closeModalWithFocusTrap(document.getElementById('modal-change-pwd'));
}

async function changePassword() {
  const current = document.getElementById('pwd-current').value;
  const newPwd  = document.getElementById('pwd-new').value;
  const confirm = document.getElementById('pwd-confirm').value;
  const errEl   = document.getElementById('pwd-error');
  const okEl    = document.getElementById('pwd-success');

  errEl.classList.add('msg-hidden');
  okEl.classList.add('msg-hidden');

  if (!current || !newPwd || !confirm) {
    errEl.textContent = 'Tous les champs sont requis.';
    errEl.classList.remove('msg-hidden');
    return;
  }
  if (newPwd.length < 8) {
    errEl.textContent = 'Le nouveau mot de passe doit contenir au moins 8 caractères.';
    errEl.classList.remove('msg-hidden');
    return;
  }
  if (newPwd !== confirm) {
    errEl.textContent = 'Les mots de passe ne correspondent pas.';
    errEl.classList.remove('msg-hidden');
    return;
  }

  try {
    await apiFetch('/api/admin/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: newPwd }),
    });
    okEl.textContent = '✓ Mot de passe changé avec succès.';
    okEl.classList.remove('msg-hidden');
    log('Mot de passe administrateur modifié', 'success');
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-confirm').value = '';
    setTimeout(closePwdModal, 3000);
  } catch (e) {
    errEl.textContent = (e.message.includes('Unauthorized') || e.message.includes('Session'))
      ? 'Mot de passe actuel incorrect.'
      : 'Erreur : ' + e.message;
    errEl.classList.remove('msg-hidden');
  }
}

// --- FOCUS TRAP (accessibility by design) ---
const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let _focusTrapModal = null;
let _focusTrapTrigger = null;

function openModalWithFocusTrap(modalEl, triggerEl) {
  _focusTrapModal   = modalEl;
  _focusTrapTrigger = triggerEl || document.activeElement;
  modalEl.classList.add('open');
  const first = modalEl.querySelectorAll(FOCUSABLE)[0];
  if (first) setTimeout(() => first.focus(), 50);
}

function closeModalWithFocusTrap(modalEl) {
  modalEl.classList.remove('open');
  if (_focusTrapTrigger && typeof _focusTrapTrigger.focus === 'function') {
    setTimeout(() => _focusTrapTrigger.focus(), 50);
  }
  _focusTrapModal   = null;
  _focusTrapTrigger = null;
}

// --- WEBSOCKET ADMIN ---
let adminWs = null;
let adminWsReconnectTimer = null;

function connectAdminWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  adminWs = new WebSocket(`${proto}//${location.host}/ws?adminToken=${encodeURIComponent(adminToken)}`);

  adminWs.onopen = () => {
    console.log('[Admin] WebSocket connecté');
    const wsDot   = document.getElementById('ws-dot');
    const wsLabel = document.getElementById('ws-label');
    if (wsDot)   wsDot.classList.add('ok');
    if (wsLabel) wsLabel.textContent = 'Connecté';
    clearTimeout(adminWsReconnectTimer);
  };

  adminWs.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleAdminWsMessage(msg);
    } catch (e) {
      console.warn('[Admin] Erreur parsing WebSocket message:', e);
    }
  };

  adminWs.onclose = () => {
    console.log('[Admin] WebSocket déconnecté');
    const wsDot   = document.getElementById('ws-dot');
    const wsLabel = document.getElementById('ws-label');
    if (wsDot)   wsDot.classList.remove('ok');
    if (wsLabel) wsLabel.textContent = 'Reconnexion...';
    adminWsReconnectTimer = setTimeout(connectAdminWs, 3000);
  };

  adminWs.onerror = () => adminWs.close();
}

function handleAdminWsMessage(msg) {
  switch (msg.type) {
    case 'stream:started':
    case 'stream:stopped':
    case 'stream:vod_ended':
      if (typeof updateStats === 'function') updateStats(msg.data || {});
      if (_sysViewOpen) loadActiveStreams();
      if (typeof loadChannels === 'function') loadChannels();
      break;
    case 'channels:update':
    case 'channel:updated':
      if (typeof loadChannels === 'function') loadChannels();
      break;
    case 'stats:update':
      if (typeof updateStats === 'function') updateStats(msg.data || {});
      break;
    case 'connected':
      if (typeof loadChannels === 'function') loadChannels();
      break;
  }
}

// --- EVENT LISTENERS (appelés depuis init() après login) ---
function initEventListeners() {
  // Topbar logo/titre → vue d'ensemble
  const logo = document.querySelector('.topbar-logo');
  const title = document.querySelector('.topbar-title');
  if (logo)  logo.addEventListener('click',  () => showOverview());
  if (title) title.addEventListener('click', () => showOverview());

  // Bouton retour vue d'ensemble dans content-header
  const btnOverview = document.getElementById('btn-overview');
  if (btnOverview) btnOverview.addEventListener('click', () => showOverview());

  // Bouton vue système
  const btnSystem = document.getElementById('btn-system');
  if (btnSystem) {
    btnSystem.addEventListener('click', () => {
      if (ViewState.current === ViewState.VIEWS.SYSTEM) hideSystemView();
      else showSystemView();
    });
  }

  // Bouton actualiser dans vue système
  const sysRefreshBtn = document.getElementById('sys-refresh-btn');
  if (sysRefreshBtn) sysRefreshBtn.addEventListener('click', refreshSystemView);

  // Déconnexion
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (!confirm('Se déconnecter de la régie ?')) return;
      log('Déconnexion effectuée', 'warn');
      doLogout();
    });
  }

  // Changement mot de passe
  const btnChangePwd = document.getElementById('btn-change-pwd');
  if (btnChangePwd) {
    btnChangePwd.addEventListener('click', () => {
      document.getElementById('pwd-current').value = '';
      document.getElementById('pwd-new').value = '';
      document.getElementById('pwd-confirm').value = '';
      document.getElementById('pwd-error').classList.add('msg-hidden');
      document.getElementById('pwd-success').classList.add('msg-hidden');
      openModalWithFocusTrap(
        document.getElementById('modal-change-pwd'),
        btnChangePwd
      );
      document.getElementById('pwd-current').focus();
    });
    btnChangePwd.addEventListener('click', () => {
      _focusTrapModal   = document.getElementById('modal-change-pwd');
      _focusTrapTrigger = btnChangePwd;
    }, { capture: true });
  }

  const modalPwdClose  = document.getElementById('modal-pwd-close');
  const modalPwdCancel = document.getElementById('modal-pwd-cancel');
  if (modalPwdClose)  modalPwdClose.addEventListener('click', closePwdModal);
  if (modalPwdCancel) modalPwdCancel.addEventListener('click', closePwdModal);

  // Modal nouveau canal — focus trap
  const btnNewChannel = document.getElementById('btn-new-channel');
  if (btnNewChannel) {
    btnNewChannel.addEventListener('click', () => {
      _focusTrapModal   = document.getElementById('modal-new');
      _focusTrapTrigger = btnNewChannel;
    }, { capture: true });
  }

  // new-icon preview
  const newIcon = document.getElementById('new-icon');
  if (newIcon) newIcon.addEventListener('input', function() {
    const preview = document.getElementById('new-icon-preview');
    if (preview) preview.textContent = this.value;
  });

  // Source type change
  const newSourceType = document.getElementById('new-source-type');
  if (newSourceType) newSourceType.addEventListener('change', () => {
    if (typeof updateSourceForm === 'function') updateSourceForm();
  });

  // Breadcrumbs (délégation)
  document.addEventListener('click', (e) => {
    const breadcrumb = e.target.closest('.breadcrumb-item');
    if (breadcrumb && !breadcrumb.classList.contains('active')) {
      if (breadcrumb.dataset.view === 'overview') showOverview();
    }
  });

  // Sidebar — sélection canal (délégation)
  document.addEventListener('click', (e) => {
    const ch = e.target.closest('.ch-item[data-id]');
    if (ch) {
      if (_sysViewOpen) ViewState.hideSystem();
      selectChannel(ch.dataset.id);
    }
  }, true);

  // Délégation d'événements globale (click — data-action)
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    switch (action) {
      case 'show-overview':      showOverview(); break;
      case 'start-stream':       if (typeof startStream === 'function')     startStream(id); break;
      case 'stop-stream':        if (typeof stopStream === 'function')      stopStream(id); break;
      case 'restart-stream':     if (typeof restartStream === 'function')   restartStream(id); break;
      case 'start-testtone':     if (typeof startTestTone === 'function')   startTestTone(id); break;
      case 'delete-channel':     if (typeof deleteChannel === 'function')   deleteChannel(id); break;
      case 'clear-edit-sdp':     if (typeof clearEditSdp === 'function')    clearEditSdp(id); break;
      case 'save-edit-sdp':      if (typeof saveEditSdp === 'function')     saveEditSdp(id); break;
      case 'apply-edit-sdp':     if (typeof applyEditSdp === 'function')    applyEditSdp(id); break;
      case 'save-channel-edit':  if (typeof saveChannelEdit === 'function') saveChannelEdit(id); break;
      case 'set-icon': {
        const inp = document.getElementById(el.dataset.input);
        const pre = document.getElementById(el.dataset.preview);
        if (inp) inp.value = el.dataset.value;
        if (pre) pre.textContent = el.dataset.value;
        break;
      }
      case 'load-sdp-list':    if (typeof loadSdpList === 'function')    loadSdpList(); break;
      case 'load-audio-list':  if (typeof loadAudioList === 'function')  loadAudioList(); break;
      case 'clear-sdp-content': if (typeof clearSdpContent === 'function') clearSdpContent(); break;
      case 'sdp-dropzone-click':
        if (!e.target.closest('input[type="file"]'))
          document.getElementById('src-sdp-file-input')?.click();
        break;
      case 'audio-dropzone-click':
        if (!e.target.closest('input[type="file"]'))
          document.getElementById('src-audio-file-input')?.click();
        break;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'update-channel-map':       if (typeof updateChannelMapOptions === 'function')    updateChannelMapOptions(); break;
      case 'update-edit-channel-map':  if (typeof updateEditChannelMapOptions === 'function') updateEditChannelMapOptions(); break;
      case 'update-channel-map-sdp':   if (typeof updateChannelMapOptionsFor === 'function') updateChannelMapOptionsFor('src-aes67sdp-channels', 'channel-map-row-sdp', 'src-aes67sdp-channelmap', 'downmix-row-sdp'); break;
      case 'update-channel-map-paste': if (typeof updateChannelMapOptionsFor === 'function') updateChannelMapOptionsFor('src-aes67paste-channels', 'channel-map-row-paste', 'src-aes67paste-channelmap', 'downmix-row-paste'); break;
      case 'sdp-existing-select':      if (typeof onSdpExistingSelect === 'function')   onSdpExistingSelect(); break;
      case 'audio-existing-select':    if (typeof onAudioExistingSelect === 'function') onAudioExistingSelect(); break;
      case 'sdp-file-select':          if (typeof onSdpFileSelect === 'function')   onSdpFileSelect(el); break;
      case 'audio-file-select':        if (typeof onAudioFileSelect === 'function') onAudioFileSelect(el); break;
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'update-icon-preview': {
        const pre = document.getElementById(el.dataset.preview);
        if (pre) pre.textContent = el.value;
        break;
      }
      case 'sdp-content-input': if (typeof onSdpContentInput === 'function') onSdpContentInput(el); break;
      case 'channels-change': {
        const id = el.id;
        if (typeof updateChannelMapOptionsFor === 'function') {
          if (id === 'src-aes67sdp-channels')   updateChannelMapOptionsFor('src-aes67sdp-channels', 'channel-map-row-sdp', 'src-aes67sdp-channelmap');
          else if (id === 'src-aes67paste-channels') updateChannelMapOptionsFor('src-aes67paste-channels', 'channel-map-row-paste', 'src-aes67paste-channelmap');
        }
        if (id === 'edit-aes67-channels' && typeof updateEditChannelMapOptions === 'function') updateEditChannelMapOptions();
        break;
      }
      case 'edit-sdp-input': if (typeof onEditSdpInput === 'function') onEditSdpInput(el.dataset.id, el); break;
    }
  });

  // Drag-drop dropzones
  document.addEventListener('dragover', (e) => {
    if (e.target.closest('#sdp-dropzone, #audio-dropzone')) e.preventDefault();
  });
  document.addEventListener('dragenter', (e) => {
    const dz = e.target.closest('#sdp-dropzone, #audio-dropzone');
    if (dz) dz.classList.add('sdp-dropzone--drag');
  });
  document.addEventListener('dragleave', (e) => {
    const dz = e.target.closest('#sdp-dropzone, #audio-dropzone');
    if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove('sdp-dropzone--drag');
  });
  document.addEventListener('drop', (e) => {
    const dz  = e.target.closest('#sdp-dropzone');
    const adz = e.target.closest('#audio-dropzone');
    if (dz)  { e.preventDefault(); dz.classList.remove('sdp-dropzone--drag');  if (typeof onSdpDrop === 'function') onSdpDrop(e); }
    if (adz) { e.preventDefault(); adz.classList.remove('sdp-dropzone--drag'); if (typeof onAudioDrop === 'function') onAudioDrop(e); }
  });

  // Touche Escape pour fermer les modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modalPwd = document.getElementById('modal-change-pwd');
      const modalNew = document.getElementById('modal-new');
      if (modalPwd && modalPwd.classList.contains('open')) { closePwdModal(); return; }
      if (modalNew && modalNew.classList.contains('open')) { if (typeof closeModal === 'function') closeModal(); return; }
    }
    if (e.key === 'Tab' && _focusTrapModal && _focusTrapModal.classList.contains('open')) {
      const focusable = Array.from(_focusTrapModal.querySelectorAll(FOCUSABLE));
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    }
  });
}
