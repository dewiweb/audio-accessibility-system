// admin-channels.js — Canaux, SDP, sources audio, formulaires de création/édition

function renderChannelDetail(ch) {
  const el = document.getElementById('channel-detail-content');
  const sourceLabel = {
    alsa: `ALSA hw:${ch.source?.card || 0},${ch.source?.device || 0}`,
    pulse: `PulseAudio: ${ch.source?.device || 'default'}`,
    rtsp: `RTSP: ${ch.source?.url || ''}`,
    file: `Fichier: ${ch.source?.path || ''}`,
    testtone: `Tonalité ${ch.source?.frequency || 440}Hz`,
    aes67: ch.source?.sdpFile
      ? `SDP: ${ch.source.sdpFile}`
      : `RTP multicast: ${ch.source?.multicastAddress || '?'}:${ch.source?.port || 5004} (${ch.source?.encoding || 'L24'}/${ch.source?.sampleRate || 48000}/${ch.source?.channels || 2})`,
  }[ch.source?.type] || 'Inconnue';

  const currentSdpContent = ch.source?.sdpContent || '';
  const isAes67 = ch.source?.type === 'aes67';

  el.innerHTML = `
    <div class="ch-back-row">
      <button class="btn-sm btn-back" data-action="show-overview">← Vue d'ensemble</button>
    </div>
    <div class="detail-card">
      <div class="detail-card-header">Statut du canal</div>
      <div class="detail-card-body ch-status-body">
        <div class="ch-status-icon">${ch.icon}</div>
        <div class="ch-status-info">
          <div class="ch-status-name">${escHtml(ch.name)}</div>
          <div class="ch-status-desc">${escHtml(ch.description || '')}</div>
          <div class="ch-status-badges">
            ${ch.active
              ? '<span class="live-badge">● EN DIRECT</span>'
              : '<span class="offline-badge">○ ARRÉTÉ</span>'}
            <span class="ch-meta-text">👥 ${ch.listenerCount} auditeur(s)</span>
            <span class="ch-meta-text">${ch.language.toUpperCase()}</span>
          </div>
        </div>
      </div>
      <div class="stream-controls">
        ${!ch.active ? `
          <button class="btn-sm btn-green" data-action="start-stream" data-id="${ch.id}">▶ Démarrer</button>
          <button class="btn-sm btn-yellow" data-action="start-testtone" data-id="${ch.id}">♪ Tonalité test</button>
        ` : `
          <button class="btn-sm btn-red" data-action="stop-stream" data-id="${ch.id}">■ Arrêter</button>
          <button class="btn-sm btn-yellow" data-action="restart-stream" data-id="${ch.id}">↺ Relancer</button>
        `}
        <button class="btn-sm btn-ghost btn-delete" data-action="delete-channel" data-id="${ch.id}">🗑 Supprimer</button>
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-header">Configuration source audio</div>
      <div class="detail-card-body">
        <div class="src-type-row">
          <span class="src-type-label">Type :</span>
          <span class="src-type-value">${ch.source?.type || '?'}</span>
        </div>
        <div class="src-code-block">${escHtml(sourceLabel)}</div>
        ${isAes67 ? `
        <div class="sdp-section">
          <div class="sdp-section-header">
            <span class="sdp-section-title">📄 Contenu SDP</span>
            <div class="sdp-section-actions">
              <button class="btn-sm btn-ghost-sm" data-action="clear-edit-sdp" data-id="${ch.id}">Effacer</button>
              <button class="btn-sm btn-green btn-sm-text" data-action="save-edit-sdp" data-id="${ch.id}">💾 Sauvegarder</button>
              <button class="btn-sm btn-add btn-sm-text" data-action="apply-edit-sdp" data-id="${ch.id}">✓ Appliquer au canal</button>
            </div>
          </div>
          <textarea class="form-input sdp-textarea" id="edit-sdp-${ch.id}" rows="8"
            placeholder="Coller ici le contenu SDP exporté depuis la console (v=0...)"
            data-action="edit-sdp-input" data-id="${ch.id}">${escHtml(currentSdpContent)}</textarea>
          <div id="edit-sdp-preview-${ch.id}" class="sdp-preview-row"></div>
        </div>` : ''}
        <div class="hls-url-section">
          <div class="hls-url-label">URL HLS :</div>
          <div class="hls-url-block">/hls/${ch.id}/stream.m3u8</div>
        </div>
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-header">Modifier le canal</div>
      <div class="detail-card-body">
        <div class="form-row-2">
          <div class="form-row">
            <label class="form-label" for="edit-name">Nom</label>
            <input class="form-input" id="edit-name" value="${escHtml(ch.name)}" />
          </div>
          <div class="form-row">
            <label class="form-label" for="edit-lang">Langue</label>
            <select class="form-input" id="edit-lang">
              ${['fr','en','es','de','ar','other'].map(l => `<option value="${l}" ${ch.language===l?'selected':''}>${l.toUpperCase()}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label" for="edit-desc">Description</label>
          <input class="form-input" id="edit-desc" value="${escHtml(ch.description || '')}" />
        </div>
        <div class="form-row-2">
          <div class="form-row">
            <label class="form-label" for="edit-icon">Icône</label>
            <div class="edit-icon-wrap">
              <div class="edit-icon-row">
                <input class="form-input icon-input" id="edit-icon" value="${ch.icon}" data-action="update-icon-preview" data-preview="edit-icon-preview" />
                <span id="edit-icon-preview" class="icon-preview">${ch.icon}</span>
              </div>
              <div class="edit-icon-btn-grid">
                ${['🎧','🎵','🎶','🔊','📻','🎙','🎤','🎼','🎹','🎸','🥁','🎺','🎻','🎷','🔔','📢','💬','🌍','🌐','♿','👂','🦻','💡','⭐','🎯','🎭','🏛','🎪'].map(e =>
                  `<button type="button" class="icon-btn" title="${e}" data-action="set-icon" data-input="edit-icon" data-preview="edit-icon-preview" data-value="${e}">${e}</button>`
                ).join('')}
              </div>
            </div>
          </div>
          <div class="form-row">
            <label class="form-label" for="edit-color">Couleur</label>
            <input type="color" class="form-input color-input" id="edit-color" value="${ch.color || '#7c6ff7'}" />
          </div>
        </div>
        ${ch.source?.type === 'file' ? `
        <div class="form-row">
          <label class="form-label">Lecture en boucle</label>
          <div class="toggle-row">
            <input type="checkbox" id="edit-file-loop" class="toggle-checkbox" ${ch.source?.loop ? 'checked' : ''} />
            <label for="edit-file-loop" class="toggle-label">Rejouer automatiquement depuis le début à la fin du fichier</label>
          </div>
        </div>` : ''}
        ${ch.source?.type === 'aes67' ? `
        <div class="form-row">
          <label class="form-label">Nombre de canaux</label>
          <div class="src-row-flex">
            <select class="form-input src-select-flex" id="edit-aes67-channels" data-action="channels-change">
              <option value="2" ${ch.source?.channels===2?'selected':''}>2 canaux (stéréo)</option>
              <option value="4" ${ch.source?.channels===4?'selected':''}>4 canaux</option>
              <option value="6" ${ch.source?.channels===6?'selected':''}>6 canaux</option>
              <option value="8" ${ch.source?.channels===8?'selected':''}>8 canaux</option>
              <option value="16" ${ch.source?.channels===16?'selected':''}>16 canaux</option>
            </select>
            <div class="src-hint-grey">Si l'auto-détection échoue, sélectionnez manuellement</div>
          </div>
        </div>
        <div class="form-row ${(ch.source?.channels||2)<=2?'channel-map-row-hidden':''}" id="edit-channel-map-row">
          <label class="form-label" for="edit-aes67-channelmap">Paire stéréo à extraire</label>
          <select class="form-input" id="edit-aes67-channelmap"></select>
          <div class="src-hint-grey">Choisissez la paire L/R à extraire, ou laissez sur <em>mix global</em> pour downmixer tous les canaux</div>
        </div>
        <div class="form-row channel-map-row-hidden" id="downmix-row-edit">
          <label class="form-label" for="edit-aes67-downmix">Traitement stéréo</label>
          <select class="form-input" id="edit-aes67-downmix"></select>
          <div class="src-hint-grey">Audiodescription : <b>Mono → Stéréo</b> · 5.1/7.1 : <b>Stéréo renforcée</b> ou standard</div>
        </div>
        <div class="form-row">
          <label class="form-label" for="edit-aes67-gain">Gain (dB) <span class="label-opt">— 0 = pas de changement</span></label>
          <input class="form-input gain-input" id="edit-aes67-gain" type="number" value="${ch.source?.gain || 0}" step="1" min="-20" max="20" />
        </div>` : ''}
        <button class="btn-sm btn-add" data-action="save-channel-edit" data-id="${ch.id}">💾 Enregistrer</button>
      </div>
    </div>
  `;
  if (ch.source?.type === 'aes67') {
    _initEditChannelMap(ch);
  }
}

function _initEditChannelMap(ch) {
  const n = ch.source?.channels || 2;
  const savedMap = ch.source?.channelMap ? ch.source.channelMap.join(',') : '';
  const savedDownmix = ch.source?.downmix || '';
  updateEditChannelMapOptions();
  const mapSel = document.getElementById('edit-aes67-channelmap');
  const dmRow  = document.getElementById('downmix-row-edit');
  const dmSel  = document.getElementById('edit-aes67-downmix');
  if (!mapSel) return;
  if (savedMap && mapSel.querySelector(`option[value="${savedMap}"]`)) {
    mapSel.value = savedMap;
    if (dmRow) {
      _syncDownmixRow(mapSel, dmRow);
      if (savedDownmix && dmSel && dmSel.querySelector(`option[value="${savedDownmix}"]`)) {
        dmSel.value = savedDownmix;
      }
    }
  } else if (savedDownmix && dmRow && dmSel) {
    _syncDownmixRow(mapSel, dmRow);
    if (dmSel.querySelector(`option[value="${savedDownmix}"]`)) dmSel.value = savedDownmix;
  }
}

// --- ACTIONS ---
async function startStream(id) {
  log(`Démarrage stream canal ${id}...`);
  try {
    await apiFetch(`/api/admin/channels/${id}/start`, { method: 'POST' });
    log('Stream démarré', 'success');
    loadChannels();
  } catch (e) { log('Erreur: ' + e.message, 'error'); }
}

async function stopStream(id) {
  try {
    await apiFetch(`/api/admin/channels/${id}/stop`, { method: 'POST' });
    log('Stream arrêté', 'warn');
    loadChannels();
  } catch (e) { log('Erreur: ' + e.message, 'error'); }
}

async function restartStream(id) {
  log('Relance du stream...', 'warn');
  try {
    await apiFetch(`/api/admin/channels/${id}/restart`, { method: 'POST' });
    log('Stream relancé', 'success');
    loadChannels();
  } catch (e) { log('Erreur: ' + e.message, 'error'); }
}

async function startTestTone(id) {
  log('Démarrage tonalité de test 440Hz...', 'info');
  try {
    await apiFetch(`/api/admin/channels/${id}/testtone`, { method: 'POST', body: JSON.stringify({ frequency: 440 }) });
    log('Tonalité de test active', 'success');
    loadChannels();
  } catch (e) { log('Erreur: ' + e.message, 'error'); }
}

async function deleteChannel(id) {
  if (!confirm('Supprimer ce canal ? Cette action est irréversible.')) return;
  try {
    await apiFetch(`/api/admin/channels/${id}`, { method: 'DELETE' });
    log('Canal supprimé', 'warn');
    showOverview();
    loadChannels();
  } catch (e) { log('Erreur: ' + e.message, 'error'); }
}

// --- SDP EDITOR ---
window.onEditSdpInput = function(id, textarea) {
  const content = textarea.value.trim();
  const preview = document.getElementById(`edit-sdp-preview-${id}`);
  if (!preview) return;
  if (!content) { preview.textContent = ''; return; }
  const lines = content.split('\n');
  const session = lines.find(l => l.startsWith('s='))?.slice(2) || '—';
  const conn = lines.find(l => l.startsWith('c='))?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '—';
  const media = lines.find(l => l.startsWith('m=audio'));
  const port = media?.split(' ')[1] || '—';
  const rtpmap = lines.find(l => l.startsWith('a=rtpmap:'))?.replace('a=rtpmap:', '') || '—';
  preview.innerHTML = `📋 <b>${session}</b> &nbsp;·&nbsp; ${conn}:${port} &nbsp;·&nbsp; ${rtpmap}`;
};

window.clearEditSdp = function(id) {
  const ta = document.getElementById(`edit-sdp-${id}`);
  if (ta) { ta.value = ''; onEditSdpInput(id, ta); }
};

window.saveEditSdp = async function(id) {
  const ta = document.getElementById(`edit-sdp-${id}`);
  const content = ta?.value.trim();
  if (!content) return;
  const ch = allChannels.find(c => c.id === id);
  const suggested = (ch?.name || 'stream').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40);
  const filename = prompt('Nom du fichier (sans extension) :', suggested);
  if (!filename) return;
  try {
    const r = await apiFetch('/api/admin/sdp/save', { method: 'POST', body: JSON.stringify({ filename, content }) });
    const data = await r.json();
    log(`SDP sauvegardé : ${data.filename}`, 'success');
  } catch (e) { log('Erreur sauvegarde SDP : ' + e.message, 'error'); }
};

window.applyEditSdp = async function(id) {
  const ta = document.getElementById(`edit-sdp-${id}`);
  const content = ta?.value.trim();
  if (!content) { log('Contenu SDP vide', 'error'); return; }
  const ch = allChannels.find(c => c.id === id);
  if (!ch) return;
  const wasActive = ch.active;
  try {
    if (wasActive) await apiFetch(`/api/admin/channels/${id}/stop`, { method: 'POST' });
    const newSource = { ...ch.source, sdpContent: content, sdpFile: '' };
    await apiFetch(`/api/admin/channels/${id}`, { method: 'PUT', body: JSON.stringify({ source: newSource }) });
    log('Source SDP mise à jour', 'success');
    if (wasActive) {
      await apiFetch(`/api/admin/channels/${id}/start`, { method: 'POST' });
      log('Stream redémarré avec le nouveau SDP', 'success');
    }
    loadChannels();
  } catch (e) { log('Erreur application SDP : ' + e.message, 'error'); }
};

async function saveChannelEdit(id) {
  const ch = allChannels.find(c => c.id === id);
  const updates = {
    name: document.getElementById('edit-name').value,
    description: document.getElementById('edit-desc').value,
    language: document.getElementById('edit-lang').value,
    icon: document.getElementById('edit-icon').value,
    color: document.getElementById('edit-color').value,
  };
  const loopEl = document.getElementById('edit-file-loop');
  if (loopEl && ch?.source?.type === 'file') {
    updates.source = { ...ch.source, loop: loopEl.checked };
  }
  if (ch?.source?.type === 'aes67') {
    const chMapEl = document.getElementById('edit-aes67-channelmap');
    const downmixEl = document.getElementById('edit-aes67-downmix');
    const gainEl = document.getElementById('edit-aes67-gain');
    const chCount = parseInt(document.getElementById('edit-aes67-channels')?.value || 2);
    const src = { ...ch.source, channels: chCount };
    if (chMapEl?.value) src.channelMap = chMapEl.value.split(',').map(Number);
    else delete src.channelMap;
    const dmVal = downmixEl?.value || '';
    if (dmVal) src.downmix = dmVal; else delete src.downmix;
    const gainVal = parseInt(gainEl?.value || 0);
    src.gain = gainVal !== 0 ? gainVal : undefined;
    if (src.gain === undefined) delete src.gain;
    updates.source = src;
  }
  try {
    await apiFetch(`/api/admin/channels/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
    log('Canal mis à jour', 'success');
    loadChannels();
  } catch (e) { log('Erreur: ' + e.message, 'error'); }
}

// --- MODAL NEW CHANNEL ---
document.getElementById('btn-new-channel').addEventListener('click', () => {
  document.getElementById('modal-new').classList.add('open');
});
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-save').addEventListener('click', createChannel);

function closeModal() { document.getElementById('modal-new').classList.remove('open'); }

// --- SDP MANAGER ---
window.loadSdpList = async function() {
  const sel = document.getElementById('src-sdp-existing');
  if (!sel) return;
  try {
    const r = await apiFetch('/api/admin/sdp/list');
    const files = await r.json();
    sel.innerHTML = '<option value="">— sélectionner un fichier existant —</option>' +
      files.map(f => `<option value="${f.path}" data-content="${encodeURIComponent(f.content)}">${f.filename} (${f.size}o)</option>`).join('');
    if (files.length === 0) sel.innerHTML = '<option value="">Aucun fichier SDP sur le serveur</option>';
  } catch (e) { sel.innerHTML = '<option value="">Erreur chargement</option>'; }
};

window.onSdpExistingSelect = function() {
  const opt = document.getElementById('src-sdp-existing')?.selectedOptions[0];
  if (!opt || !opt.value) return;
  document.getElementById('src-aes67sdp-path').value = opt.value;
  const status = document.getElementById('sdp-upload-status');
  if (status) {
    status.className = 'sdp-upload-status status-accent';
    status.textContent = `✓ Fichier sélectionné : ${opt.dataset.filename || opt.value}`;
  }
  if (opt.dataset.content) {
    const content = decodeURIComponent(opt.dataset.content);
    applySdpChannels(content, 'src-aes67sdp-channels', 'channel-map-row-sdp', 'src-aes67sdp-channelmap');
  }
};

window.onSdpFileSelect = async function(input) {
  const file = input.files[0];
  if (!file) return;
  await uploadSdpFile(file);
};

window.onSdpDrop = async function(event) {
  event.preventDefault();
  document.getElementById('sdp-dropzone').classList.remove('sdp-dropzone--drag');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  await uploadSdpFile(file);
};

async function uploadSdpFile(file) {
  const status = document.getElementById('sdp-upload-status');
  status.className = 'sdp-upload-status';
  status.textContent = `⏳ Upload de ${file.name}…`;
  const formData = new FormData();
  formData.append('sdpfile', file);
  try {
    const r = await fetch('/api/admin/sdp/upload', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
      body: formData,
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    const data = await r.json();
    status.className = 'sdp-upload-status status-ok';
    status.textContent = `✓ ${data.filename} uploadé (${data.size} octets)`;
    const pathEl = document.getElementById('src-aes67sdp-path');
    if (pathEl) pathEl.value = data.path;
    const reader = new FileReader();
    reader.onload = (e) => applySdpChannels(e.target.result, 'src-aes67sdp-channels', 'channel-map-row-sdp', 'src-aes67sdp-channelmap');
    reader.readAsText(file);
    loadSdpList();
  } catch (e) {
    status.className = 'sdp-upload-status status-err';
    status.textContent = `✗ Erreur : ${e.message}`;
  }
}

window.loadAudioList = async function() {
  const sel = document.getElementById('src-audio-existing');
  if (!sel) return;
  try {
    const r = await apiFetch('/api/admin/audio/list');
    const files = await r.json();
    sel.innerHTML = '<option value="">— sélectionner un fichier existant —</option>';
    files.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.path;
      opt.dataset.filename = f.filename;
      opt.textContent = `${f.filename} (${Math.round(f.size / 1024)} ko)`;
      sel.appendChild(opt);
    });
    if (files.length === 0) sel.innerHTML = '<option value="">Aucun fichier audio sur le serveur</option>';
  } catch (e) { sel.innerHTML = '<option value="">Erreur chargement</option>'; }
};

window.onAudioExistingSelect = function() {
  const opt = document.getElementById('src-audio-existing')?.selectedOptions[0];
  if (!opt || !opt.value) return;
  const pathInput = document.getElementById('src-file-path');
  if (pathInput) pathInput.value = opt.value;
  const status = document.getElementById('audio-upload-status');
  if (status) {
    status.className = 'sdp-upload-status status-accent';
    status.textContent = `✓ Fichier sélectionné : ${opt.dataset.filename}`;
  }
};

window.onAudioFileSelect = async function(input) {
  const file = input.files[0];
  if (!file) return;
  await uploadAudioFile(file);
};

window.onAudioDrop = async function(event) {
  event.preventDefault();
  const dz = document.getElementById('audio-dropzone');
  if (dz) dz.classList.remove('sdp-dropzone--drag');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  await uploadAudioFile(file);
};

async function uploadAudioFile(file) {
  const status = document.getElementById('audio-upload-status');
  if (status) { status.className = 'sdp-upload-status'; status.textContent = `⏳ Upload de ${file.name} (${Math.round(file.size / 1024)} ko)…`; }
  const formData = new FormData();
  formData.append('audiofile', file);
  try {
    const r = await fetch('/api/admin/audio/upload', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
      body: formData,
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || r.status); }
    const data = await r.json();
    const pathInput = document.getElementById('src-file-path');
    if (pathInput) pathInput.value = data.path;
    if (status) { status.className = 'sdp-upload-status status-ok'; status.textContent = `✓ ${data.filename} uploadé (${Math.round(data.size / 1024)} ko)`; }
    loadAudioList();
  } catch (e) {
    if (status) { status.className = 'sdp-upload-status status-err'; status.textContent = `✗ Erreur : ${e.message}`; }
    log('Erreur upload audio : ' + e.message, 'error');
  }
}

function parseSdpChannels(content) {
  const lines = content.split('\n');
  const rtpmap = lines.find(l => l.startsWith('a=rtpmap:')) || '';
  let match = rtpmap.match(/\/(\d+)\s*$/);
  if (match) { const n = parseInt(match[1]); if ([1,2,4,6,8,16].includes(n)) return n; }
  const channelmap = lines.find(l => l.startsWith('a=channelmap:')) || '';
  if (channelmap) { const parts = channelmap.split(':')[1]?.split(',') || []; const n = parts.length; if ([1,2,4,6,8,16].includes(n)) return n; }
  const fmtp = lines.find(l => l.startsWith('a=fmtp:')) || '';
  match = fmtp.match(/channel_count\s*=\s*(\d+)/);
  if (match) { const n = parseInt(match[1]); if ([1,2,4,6,8,16].includes(n)) return n; }
  return null;
}

function applySdpChannels(content, chSelId, rowId, mapSelId) {
  const n = parseSdpChannels(content);
  if (!n) return;
  const sel = document.getElementById(chSelId);
  if (sel) { const opt = sel.querySelector(`option[value="${n}"]`); if (opt) sel.value = String(n); }
  updateChannelMapOptionsFor(chSelId, rowId, mapSelId);
}

window.onSdpContentInput = function(textarea) {
  const content = textarea.value.trim();
  const saveBtn = document.getElementById('sdp-save-btn');
  const preview = document.getElementById('sdp-preview');
  if (saveBtn) saveBtn.disabled = !content;
  if (!preview) return;
  if (!content) { preview.classList.add('msg-hidden'); return; }
  const lines = content.split('\n');
  const session = lines.find(l => l.startsWith('s='))?.slice(2) || '—';
  const conn = lines.find(l => l.startsWith('c='))?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '—';
  const media = lines.find(l => l.startsWith('m=audio'));
  const port = media?.split(' ')[1] || '—';
  const rtpmap = lines.find(l => l.startsWith('a=rtpmap:'))?.replace('a=rtpmap:', '') || '—';
  preview.classList.remove('msg-hidden');
  preview.innerHTML = `📋 <b>Session:</b> ${session} &nbsp;|&nbsp; <b>Multicast:</b> ${conn}:${port} &nbsp;|&nbsp; <b>Format:</b> ${rtpmap}`;
  applySdpChannels(content, 'src-aes67paste-channels', 'channel-map-row-paste', 'src-aes67paste-channelmap');
};

window.saveSdpContent = async function() {
  const content = document.getElementById('src-aes67sdp-content').value.trim();
  if (!content) return;
  const lines = content.split('\n');
  const session = lines.find(l => l.startsWith('s='))?.slice(2).trim() || 'stream';
  const suggested = session.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40);
  const filename = prompt('Nom du fichier (sans extension) :', suggested);
  if (!filename) return;
  try {
    const r = await apiFetch('/api/admin/sdp/save', { method: 'POST', body: JSON.stringify({ filename, content }) });
    const data = await r.json();
    document.getElementById('src-aes67sdp-path').value = data.path;
    const status = document.getElementById('sdp-upload-status');
    status.className = 'sdp-upload-status status-ok';
    status.textContent = `✓ Sauvegardé : ${data.filename}`;
    loadSdpList();
  } catch (e) { log('Erreur sauvegarde SDP : ' + e.message, 'error'); }
};

window.clearSdpContent = function() {
  const ta = document.getElementById('src-aes67sdp-content');
  if (ta) { ta.value = ''; onSdpContentInput(ta); }
  const path = document.getElementById('src-aes67sdp-path');
  if (path) path.value = '';
  const sel = document.getElementById('src-sdp-existing');
  if (sel) sel.value = '';
  const status = document.getElementById('sdp-upload-status');
  if (status) status.className = 'sdp-upload-status msg-hidden';
};

function _buildDownmixOptions(hasPairSelection) {
  if (hasPairSelection) {
    return `<option value="">— stéréo directe (L/R déjà stéréo) —</option>
      <option value="mono-to-stereo">Mono → Stéréo — audiodescription (voix dupliquée L+R)</option>`;
  }
  return `<option value="">— pas de traitement (garder tel quel) —</option>
    <option value="stereo">Stéréo standard (ITU-R BS.775) — downmix 5.1/7.1</option>
    <option value="stereo-loud">Stéréo renforcée — malentendants (LFE + surround boostés)</option>
    <option value="mono-to-stereo">Mono → Stéréo — audiodescription (voix dupliquée L+R)</option>
    <option value="binaural">Binaural HRTF — rendu 3D casque</option>`;
}

function _syncDownmixRow(mapSel, dmRow) {
  const hasPair = !!mapSel.value;
  const dmSel = dmRow.querySelector('select');
  if (!dmSel) return;
  const prevDm = dmSel.value;
  dmSel.innerHTML = _buildDownmixOptions(hasPair);
  if (prevDm && dmSel.querySelector(`option[value="${prevDm}"]`)) dmSel.value = prevDm;
  dmRow.classList.remove('channel-map-row-hidden');
}

window.updateChannelMapOptionsFor = function(chSelId, rowId, mapSelId, downmixRowId) {
  const n = parseInt(document.getElementById(chSelId)?.value || 2);
  const row = document.getElementById(rowId);
  const sel = document.getElementById(mapSelId);
  const dmRow = downmixRowId ? document.getElementById(downmixRowId) : null;
  if (!row || !sel) return;
  if (n <= 2) {
    row.classList.add('channel-map-row-hidden');
    sel.value = '';
    if (dmRow) dmRow.classList.add('channel-map-row-hidden');
    return;
  }
  row.classList.remove('channel-map-row-hidden');
  const pairs = [];
  for (let i = 1; i < n; i += 2) pairs.push([i, i + 1]);
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">— tous les canaux (mix global) —</option>' +
    pairs.map(([l, r]) => `<option value="${l},${r}">Canaux ${l} / ${r} (paire L/R)</option>`).join('');
  if (prevVal && sel.querySelector(`option[value="${prevVal}"]`)) sel.value = prevVal;
  if (dmRow) _syncDownmixRow(sel, dmRow);
  sel._dmRow = dmRow;
  if (!sel._dmListener) {
    sel._dmListener = () => { if (sel._dmRow) _syncDownmixRow(sel, sel._dmRow); };
    sel.addEventListener('change', sel._dmListener);
  }
};

window.updateEditChannelMapOptions = function() {
  const n = parseInt(document.getElementById('edit-aes67-channels')?.value || 2);
  const row = document.getElementById('edit-channel-map-row');
  const sel = document.getElementById('edit-aes67-channelmap');
  const dmRow = document.getElementById('downmix-row-edit');
  if (!row || !sel) return;
  if (n <= 2) { row.classList.add('channel-map-row-hidden'); sel.value = ''; if (dmRow) dmRow.classList.add('channel-map-row-hidden'); return; }
  row.classList.remove('channel-map-row-hidden');
  const pairs = [];
  for (let i = 1; i < n; i += 2) pairs.push([i, i + 1]);
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">— tous les canaux (mix global) —</option>' +
    pairs.map(([l, r]) => `<option value="${l},${r}">Canaux ${l} / ${r} (paire L/R)</option>`).join('');
  if (prevVal && sel.querySelector(`option[value="${prevVal}"]`)) sel.value = prevVal;
  if (dmRow) _syncDownmixRow(sel, dmRow);
  sel._dmRow = dmRow;
  if (!sel._dmListener) {
    sel._dmListener = () => { if (sel._dmRow) _syncDownmixRow(sel, sel._dmRow); };
    sel.addEventListener('change', sel._dmListener);
  }
};

window.updateChannelMapOptions = function() {
  const n = parseInt(document.getElementById('src-aes67-channels')?.value || 2);
  const row = document.getElementById('channel-map-row');
  const sel = document.getElementById('src-aes67-channelmap');
  const dmRow = document.getElementById('downmix-row');
  if (!row || !sel) return;
  if (n <= 2) { row.classList.add('channel-map-row-hidden'); sel.value = ''; if (dmRow) dmRow.classList.add('channel-map-row-hidden'); return; }
  row.classList.remove('channel-map-row-hidden');
  const pairs = [];
  for (let i = 1; i < n; i += 2) pairs.push([i, i + 1]);
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">— tous les canaux (mix global) —</option>' +
    pairs.map(([l, r]) => `<option value="${l},${r}">Canaux ${l} / ${r} (paire L/R)</option>`).join('');
  if (prevVal && sel.querySelector(`option[value="${prevVal}"]`)) sel.value = prevVal;
  if (dmRow) _syncDownmixRow(sel, dmRow);
  sel._dmRow = dmRow;
  if (!sel._dmListener) {
    sel._dmListener = () => { if (sel._dmRow) _syncDownmixRow(sel, sel._dmRow); };
    sel.addEventListener('change', sel._dmListener);
  }
};

window.updateSourceForm = function() {
  const type = document.getElementById('new-source-type').value;
  const configs = {
    aes67: `
      <div class="src-hint">🎛️ AES67 — flux RTP multicast depuis console Dante/AES67</div>
      <div class="form-row-2">
        <div class="form-row"><label class="form-label">Adresse multicast</label><input class="form-input" id="src-aes67-addr" placeholder="239.69.x.x" /></div>
        <div class="form-row"><label class="form-label">Port UDP</label><input class="form-input" id="src-aes67-port" value="5004" type="number" /></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label class="form-label">Encodage</label>
          <select class="form-input" id="src-aes67-encoding">
            <option value="L24">L24 — PCM 24 bits (AES67 standard)</option>
            <option value="L16">L16 — PCM 16 bits</option>
            <option value="AM824">AM824 — AES3/ADAT</option>
          </select>
        </div>
        <div class="form-row"><label class="form-label">Canaux dans le flux</label>
          <select class="form-input" id="src-aes67-channels" data-action="update-channel-map">
            <option value="2">2 — Stéréo</option>
            <option value="1">1 — Mono</option>
            <option value="4">4 — Quad</option>
            <option value="8">8 — Octo</option>
            <option value="16">16 — 16ch</option>
          </select>
        </div>
      </div>
      <div class="form-row channel-map-row-hidden" id="channel-map-row">
        <label class="form-label">Paire stéréo à extraire</label>
        <select class="form-input" id="src-aes67-channelmap"></select>
        <div class="src-hint-grey">Choisissez la paire L/R à extraire, ou laissez sur <em>mix global</em> pour downmixer tous les canaux</div>
      </div>
      <div class="form-row channel-map-row-hidden" id="downmix-row">
        <label class="form-label">Traitement stéréo</label>
        <select class="form-input" id="src-aes67-downmix"></select>
        <div class="src-hint-grey" id="downmix-hint-aes67">Audiodescription : <b>Mono → Stéréo</b> · 5.1/7.1 : <b>Stéréo renforcée</b> ou standard</div>
      </div>
      <div class="form-row">
        <label class="form-label">Gain (dB) <span class="label-opt">— optionnel, 0 = pas de changement</span></label>
        <input class="form-input gain-input" id="src-aes67-gain" type="number" value="0" step="1" min="-20" max="20" />
        <div class="src-hint-grey">+6 dB = doubler le volume · −6 dB = réduire de moitié</div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label class="form-label">Sample rate (Hz)</label>
          <select class="form-input" id="src-aes67-samplerate">
            <option value="48000">48000 Hz (standard AES67)</option>
            <option value="44100">44100 Hz</option>
            <option value="96000">96000 Hz</option>
          </select>
        </div>
        <div class="form-row"><label class="form-label">Interface réseau (optionnel)</label><input class="form-input" id="src-aes67-iface" placeholder="laisser vide = auto" /></div>
      </div>
      <div class="form-row">
        <label class="form-label">Mode de diffusion</label>
        <select class="form-input" id="src-aes67-streammode">
          <option value="hls">📡 HLS — compatible tous appareils · latence ~3-4s</option>
          <option value="webrtc">⚡ WebRTC — ultra low-latency ~50-100ms (renforcement sonore)</option>
        </select>
        <div class="src-hint-grey">WebRTC requis MediaMTX actif. HLS recommandé pour audiodescription/malentendants.</div>
      </div>`,
    'aes67sdp-upload': `
      <div class="src-hint-sm">📂 AES67 via fichier SDP — uploader un fichier .sdp exporté depuis la console Dante/AES67</div>
      <div class="form-row">
        <label class="form-label">Fichiers SDP déjà sur le serveur</label>
        <div class="src-row-flex">
          <select class="form-input src-select-flex" id="src-sdp-existing" data-action="sdp-existing-select"><option value="">— sélectionner un fichier existant —</option></select>
          <button type="button" class="btn-sm btn-ghost-xs" data-action="load-sdp-list">↺ Rafraîchir</button>
        </div>
      </div>
      <div class="sdp-or-separator"><div class="sdp-or-line"></div>ou uploader un nouveau fichier<div class="sdp-or-line"></div></div>
      <div class="form-row">
        <label class="form-label">Uploader un fichier .sdp</label>
        <div id="sdp-dropzone" class="sdp-dropzone" data-action="sdp-dropzone-click">
          📂 Cliquer ou glisser-déposer un fichier .sdp ici
          <input type="file" id="src-sdp-file-input" class="input-hidden" accept=".sdp,text/plain" data-action="sdp-file-select" />
        </div>
        <div id="sdp-upload-status" class="sdp-upload-status msg-hidden"></div>
      </div>
      <div class="form-row">
        <label class="form-label">Fichier SDP sélectionné</label>
        <input class="form-input sdp-selected-input" id="src-aes67sdp-path" readonly placeholder="Aucun fichier sélectionné" />
      </div>
      <div class="form-row">
        <label class="form-label">Nombre de canaux (auto-détecté depuis SDP)</label>
        <div class="src-row-flex">
          <select class="form-input src-select-flex" id="src-aes67sdp-channels">
            <option value="2">2 canaux (stéréo)</option><option value="4">4 canaux</option>
            <option value="6">6 canaux</option><option value="8">8 canaux</option><option value="16">16 canaux</option>
          </select>
          <div class="src-hint-grey">Si l'auto-détection échoue, sélectionnez manuellement</div>
        </div>
      </div>
      <div class="form-row channel-map-row-hidden" id="channel-map-row-sdp">
        <label class="form-label">Paire stéréo à extraire</label>
        <select class="form-input" id="src-aes67sdp-channelmap"></select>
        <div class="src-hint-grey">Choisissez la paire L/R à extraire, ou laissez sur <em>mix global</em> pour downmixer tous les canaux</div>
      </div>
      <div class="form-row channel-map-row-hidden" id="downmix-row-sdp">
        <label class="form-label">Traitement stéréo</label>
        <select class="form-input" id="src-aes67sdp-downmix"></select>
        <div class="src-hint-grey">Audiodescription : <b>Mono → Stéréo</b> · 5.1/7.1 : <b>Stéréo renforcée</b> ou standard</div>
      </div>
      <div class="form-row">
        <label class="form-label">Gain (dB) <span class="label-opt">— 0 = neutre</span></label>
        <input class="form-input gain-input" id="src-aes67sdp-gain" type="number" value="0" step="1" min="-20" max="20" />
      </div>
      <div class="form-row">
        <label class="form-label">Mode de diffusion</label>
        <select class="form-input" id="src-aes67sdp-streammode">
          <option value="hls">📡 HLS — compatible tous appareils · latence ~3-4s</option>
          <option value="webrtc">⚡ WebRTC — ultra low-latency ~50-100ms (renforcement sonore)</option>
        </select>
        <div class="src-hint-grey">WebRTC requis MediaMTX actif. HLS recommandé pour audiodescription/malentendants.</div>
      </div>`,
    'aes67sdp-paste': `
      <div class="src-hint-sm">✏️ AES67 via contenu SDP — coller ou saisir le contenu SDP directement</div>
      <div class="form-row">
        <div class="sdp-header-row">
          <label class="form-label sdp-header-label">Contenu SDP</label>
          <button type="button" class="btn-sm btn-ghost-xs" data-action="clear-sdp-content">Effacer</button>
        </div>
        <textarea class="form-input sdp-textarea" id="src-aes67sdp-content" rows="7"
          placeholder="v=0&#10;o=- 0 0 IN IP4 192.168.x.x&#10;s=AES67 Stream&#10;..."
          data-action="sdp-content-input"></textarea>
        <div id="sdp-preview" class="sdp-preview msg-hidden"></div>
      </div>
      <div class="form-row">
        <label class="form-label">Nombre de canaux (auto-détecté)</label>
        <select class="form-input" id="src-aes67paste-channels" data-action="channels-change">
          <option value="2">2 canaux</option><option value="4">4 canaux</option>
          <option value="6">6 canaux</option><option value="8">8 canaux</option><option value="16">16 canaux</option>
        </select>
      </div>
      <div class="form-row channel-map-row-hidden" id="channel-map-row-paste">
        <label class="form-label">Paire stéréo à extraire</label>
        <select class="form-input" id="src-aes67paste-channelmap"></select>
        <div class="src-hint-grey">Choisissez la paire L/R à extraire, ou laissez sur <em>mix global</em> pour downmixer tous les canaux</div>
      </div>
      <div class="form-row channel-map-row-hidden" id="downmix-row-paste">
        <label class="form-label">Traitement stéréo</label>
        <select class="form-input" id="src-aes67paste-downmix"></select>
        <div class="src-hint-grey">Audiodescription : <b>Mono → Stéréo</b> · 5.1/7.1 : <b>Stéréo renforcée</b> ou standard</div>
      </div>
      <div class="form-row">
        <label class="form-label">Gain (dB) <span class="label-opt">— 0 = neutre</span></label>
        <input class="form-input gain-input" id="src-aes67paste-gain" type="number" value="0" step="1" min="-20" max="20" />
      </div>
      <div class="form-row">
        <label class="form-label">Mode de diffusion</label>
        <select class="form-input" id="src-aes67paste-streammode">
          <option value="hls">📡 HLS — compatible tous appareils · latence ~3-4s</option>
          <option value="webrtc">⚡ WebRTC — ultra low-latency ~50-100ms (renforcement sonore)</option>
        </select>
        <div class="src-hint-grey">WebRTC requis MediaMTX actif. HLS recommandé pour audiodescription/malentendants.</div>
      </div>`,
    alsa: `
      <div class="form-row-2">
        <div class="form-row"><label class="form-label">Carte (card)</label><input class="form-input" id="src-alsa-card" value="0" /></div>
        <div class="form-row"><label class="form-label">Device</label><input class="form-input" id="src-alsa-device" value="0" /></div>
      </div>`,
    pulse: `<div class="form-row"><label class="form-label">Device PulseAudio</label><input class="form-input" id="src-pulse-device" placeholder="default" /></div>`,
    rtsp: `<div class="form-row"><label class="form-label">URL RTSP</label><input class="form-input" id="src-rtsp-url" placeholder="rtsp://..." /></div>`,
    file: `
      <div class="src-hint-sm">🎵 Fichier audio — uploader un fichier ou spécifier un chemin dans le container</div>
      <div class="form-row">
        <label class="form-label">Fichiers audio sur le serveur</label>
        <div class="src-row-flex">
          <select class="form-input src-select-flex" id="src-audio-existing" data-action="audio-existing-select"><option value="">— sélectionner un fichier existant —</option></select>
          <button type="button" class="btn-sm btn-ghost-xs" data-action="load-audio-list">↺ Rafraîchir</button>
        </div>
      </div>
      <div class="sdp-or-separator"><div class="sdp-or-line"></div>ou uploader un fichier audio<div class="sdp-or-line"></div></div>
      <div class="form-row">
        <label class="form-label">Uploader un fichier audio (mp3, wav, ogg, flac, aac…)</label>
        <div id="audio-dropzone" class="sdp-dropzone" data-action="audio-dropzone-click">
          🎵 Cliquer ou glisser-déposer un fichier audio ici
          <input type="file" id="src-audio-file-input" class="input-hidden" accept=".mp3,.wav,.ogg,.flac,.aac,.m4a,.opus,audio/*" data-action="audio-file-select" />
        </div>
        <div id="audio-upload-status" class="sdp-upload-status msg-hidden"></div>
      </div>
      <div class="form-row">
        <label class="form-label">Chemin du fichier</label>
        <input class="form-input" id="src-file-path" placeholder="/app/uploads/audio/fichier.mp3" />
      </div>
      <div class="form-row">
        <label class="form-label">Lecture en boucle</label>
        <div class="toggle-row">
          <input type="checkbox" id="src-file-loop" class="toggle-checkbox" />
          <label for="src-file-loop" class="toggle-label">Rejouer automatiquement depuis le début à la fin du fichier</label>
        </div>
      </div>`,
    testtone: `<div class="form-row"><label class="form-label">Fréquence (Hz)</label><input class="form-input" id="src-tone-freq" value="440" type="number" /></div>`,
  };
  document.getElementById('source-config').innerHTML = configs[type] || '';
  if (type === 'aes67sdp-upload') loadSdpList();
  if (type === 'file') loadAudioList();
};

function buildSource() {
  const type = document.getElementById('new-source-type').value;
  switch (type) {
    case 'aes67': {
      const chMapVal = document.getElementById('src-aes67-channelmap')?.value || '';
      const src = {
        type: 'aes67',
        multicastAddress: document.getElementById('src-aes67-addr')?.value || '',
        port: parseInt(document.getElementById('src-aes67-port')?.value || 5004),
        encoding: document.getElementById('src-aes67-encoding')?.value || 'L24',
        channels: parseInt(document.getElementById('src-aes67-channels')?.value || 2),
        sampleRate: parseInt(document.getElementById('src-aes67-samplerate')?.value || 48000),
        interface: document.getElementById('src-aes67-iface')?.value || '',
        streamMode: document.getElementById('src-aes67-streammode')?.value || 'hls',
      };
      if (chMapVal) src.channelMap = chMapVal.split(',').map(Number);
      const downmixVal = document.getElementById('src-aes67-downmix')?.value || '';
      if (downmixVal && !chMapVal) src.downmix = downmixVal;
      const gainVal = parseInt(document.getElementById('src-aes67-gain')?.value || 0);
      if (gainVal !== 0) src.gain = gainVal;
      return src;
    }
    case 'aes67sdp-upload': {
      const sdpFile = document.getElementById('src-aes67sdp-path')?.value || '';
      if (!sdpFile) throw new Error('Veuillez sélectionner ou uploader un fichier SDP');
      const src = {
        type: 'aes67', sdpFile,
        streamMode: document.getElementById('src-aes67sdp-streammode')?.value || 'hls',
      };
      src.channels = parseInt(document.getElementById('src-aes67sdp-channels')?.value || 2);
      const chMap = document.getElementById('src-aes67sdp-channelmap')?.value || '';
      if (chMap) src.channelMap = chMap.split(',').map(Number);
      const dm = document.getElementById('src-aes67sdp-downmix')?.value || '';
      if (dm && !chMap) src.downmix = dm;
      const g = parseInt(document.getElementById('src-aes67sdp-gain')?.value || 0);
      if (g !== 0) src.gain = g;
      return src;
    }
    case 'aes67sdp-paste': {
      const sdpContent = document.getElementById('src-aes67sdp-content')?.value || '';
      if (!sdpContent.trim()) throw new Error('Veuillez saisir le contenu SDP');
      const src = {
        type: 'aes67', sdpContent,
        streamMode: document.getElementById('src-aes67paste-streammode')?.value || 'hls',
      };
      src.channels = parseInt(document.getElementById('src-aes67paste-channels')?.value || 2);
      const chMap = document.getElementById('src-aes67paste-channelmap')?.value || '';
      if (chMap) src.channelMap = chMap.split(',').map(Number);
      const dm = document.getElementById('src-aes67paste-downmix')?.value || '';
      if (dm && !chMap) src.downmix = dm;
      const g = parseInt(document.getElementById('src-aes67paste-gain')?.value || 0);
      if (g !== 0) src.gain = g;
      return src;
    }
    case 'alsa': return { type, card: parseInt(document.getElementById('src-alsa-card')?.value || 0), device: parseInt(document.getElementById('src-alsa-device')?.value || 0) };
    case 'pulse': return { type, device: document.getElementById('src-pulse-device')?.value || 'default' };
    case 'rtsp': return { type, url: document.getElementById('src-rtsp-url')?.value || '' };
    case 'file': return { type, path: document.getElementById('src-file-path')?.value || '', loop: document.getElementById('src-file-loop')?.checked || false };
    case 'testtone': return { type, frequency: parseInt(document.getElementById('src-tone-freq')?.value || 440) };
    default: return { type };
  }
}

async function createChannel() {
  const name = document.getElementById('new-name').value.trim();
  if (!name) { alert('Le nom est requis'); return; }
  let source;
  try { source = buildSource(); } catch (e) { alert(e.message); return; }
  const payload = {
    name,
    description: document.getElementById('new-desc').value,
    language: document.getElementById('new-lang').value,
    icon: document.getElementById('new-icon').value,
    color: document.getElementById('new-color').value,
    source,
  };
  try {
    await apiFetch('/api/admin/channels', { method: 'POST', body: JSON.stringify(payload) });
    log(`Canal "${name}" créé`, 'success');
    closeModal();
    loadChannels();
  } catch (e) { log('Erreur création: ' + e.message, 'error'); }
}
