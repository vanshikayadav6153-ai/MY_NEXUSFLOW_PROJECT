const socket = window.NexusWS;

let contactsData = [];
let configData = {};

const toastContainer = document.getElementById('toast-container');
const adbStatusDot = document.getElementById('adb-status-dot');
const adbStatusText = document.getElementById('adb-status-text');
const deviceModelText = document.getElementById('header-device-model');
const diagOs = document.getElementById('diag-os');
const diagBattery = document.getElementById('diag-battery');
const diagBatteryFill = document.getElementById('diag-battery-fill');
const diagTemp = document.getElementById('diag-temp');
const diagRes = document.getElementById('diag-res');

const phoneScreenContainer = document.getElementById('phone-screen-container');
const phoneScreenshot = document.getElementById('phone-screenshot');
const screenFallback = document.getElementById('screen-fallback');
const screenSpinner = document.getElementById('screen-spinner');
const btnRefreshScreen = document.getElementById('btn-refresh-screen');
const btnLiveFeed = document.getElementById('btn-live-feed');
const liveFeedText = document.getElementById('live-feed-text');

const consoleLogs = document.getElementById('console-logs');
const cmdTextInput = document.getElementById('cmd-text-input');
const btnSubmitCmd = document.getElementById('btn-submit-cmd');

const shutdownOverlay = document.getElementById('shutdown-overlay');
const shutdownCountdown = document.getElementById('shutdown-countdown');
const btnAbortShutdown = document.getElementById('btn-abort-shutdown');

const tabBtnContacts = document.getElementById('tab-btn-contacts');
const tabBtnSettings = document.getElementById('tab-btn-settings');
const tabContentContacts = document.getElementById('tab-content-contacts');
const tabContentSettings = document.getElementById('tab-content-settings');

const contactsListContainer = document.getElementById('contacts-list-container');
const contactNameInput = document.getElementById('contact-name');
const contactPhoneInput = document.getElementById('contact-phone');
const btnSaveContact = document.getElementById('btn-save-contact');

const cfgPinInput = document.getElementById('cfg-pin');
const cfgWxInput = document.getElementById('cfg-wx');
const cfgWyInput = document.getElementById('cfg-wy');
const btnSaveConfig = document.getElementById('btn-save-config');

let wasDisconnected = false;
socket.addEventListener('open', () => {
  if (wasDisconnected) {
    appendTerminalLine('[SYSTEM] Reconnected to server.', 'adb-success');
    showToast('RECONNECTED', 'Server connection restored.', 'success');
    wasDisconnected = false;
  } else {
    appendTerminalLine('[SYSTEM] Server WebSocket channel established.', 'system');
  }
});

socket.addEventListener('reconnecting', ({ delay, everConnected }) => {
  if (!everConnected) return;
  wasDisconnected = true;
  if (adbStatusDot) adbStatusDot.className = 'status-dot disconnected';
  if (adbStatusText) adbStatusText.textContent = 'RECONNECTING…';
  appendTerminalLine(`[SYSTEM] Connection lost - retrying in ${Math.round(delay / 1000)}s…`, 'adb-warning');
});

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'diagnostics':
      updateDiagnosticsHUD(data.data);
      break;

    case 'adb_log':
      appendTerminalLine(data.log.message, `adb-${data.log.type}`);
      break;

    case 'confirm_request': {
      confirmDialog(data.summary, { okText: 'Run it', cancelText: 'Cancel', danger: true }).then((approved) => {
        socket.send(JSON.stringify({ type: 'confirm_action', id: data.id, approved }));
        appendTerminalLine(`[CONFIRM] ${data.summary} -> ${approved ? 'approved' : 'declined'}`, approved ? 'adb-success' : 'adb-warning');
      });
      break;
    }

    case 'command_queued':
    case 'job_event':
      break;

    case 'pipeline_start':
      resetPipelineNodes();
      appendTerminalLine(`[PIPELINE START] Instruction: "${data.command}"`, 'adb-info');
      break;

    case 'pipeline_step':
      updatePipelineStep(data.step, data.status, data.message);
      break;

    case 'pipeline_end':
      appendTerminalLine(`[PIPELINE END] Success: ${data.success}${data.error ? ' | Error: ' + data.error : ''}`, data.success ? 'adb-success' : 'adb-error');

      if (data.success) {
        showToast('PIPELINE SUCCESS', data.ttsMessage || 'Action executed successfully.', 'success');
        if (typeof window.spawnParticlePulse === 'function') {
          setTimeout(() => window.spawnParticlePulse(window.innerWidth/2, window.innerHeight/2), 100);
          setTimeout(() => window.spawnParticlePulse(window.innerWidth/3, window.innerHeight/2), 300);
          setTimeout(() => window.spawnParticlePulse(window.innerWidth*0.66, window.innerHeight/2), 500);
        }
      } else {
        showToast('PIPELINE FAILED', data.error || 'Unknown error occurred.', 'error');
      }

      if (data.ttsMessage && typeof window.vaniSpeak === 'function') {
        window.vaniSpeak(data.ttsMessage);
      }
      break;

    case 'shutdown_timer_start':
      showShutdownOverlay(data.seconds);
      break;

    case 'shutdown_timer_tick':
      updateShutdownTimer(data.seconds);
      break;

    case 'shutdown_timer_cancelled':
      hideShutdownOverlay();
      appendTerminalLine('[SYSTEM] Shutdown sequence aborted.', 'adb-warning');
      if (typeof window.vaniSpeak === 'function') {
        window.vaniSpeak('Shutdown sequence has been aborted successfully.');
      }
      break;

    case 'shutdown_timer_complete':
      hideShutdownOverlay();
      appendTerminalLine('[SYSTEM] Shutdown sequence complete. Bye!', 'adb-error');
      break;

    case 'system_alert':
      showToast('SYSTEM ALERT', data.message, 'warning');
      appendTerminalLine(`[ALERT] ${data.message}`, 'adb-warning');
      if (data.ttsMessage && typeof window.vaniSpeak === 'function') {
        window.vaniSpeak(data.ttsMessage);
      }
      break;
  }
});

socket.addEventListener('close', () => {
  if (adbStatusDot) adbStatusDot.className = 'status-dot disconnected';
  if (adbStatusText) adbStatusText.textContent = 'SERVER DISCONNECTED';
});


function showToast(title, message, type = 'success') {
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let iconHtml = '';
  if (type === 'success') {
    iconHtml = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-green)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === 'error') {
    iconHtml = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-red)"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else {
    iconHtml = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-yellow)"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  }

  toast.innerHTML = `
    <div class="toast-icon">${iconHtml}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4500);
}

function confirmDialog(message, { okText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-message"></div>
        <div class="confirm-actions">
          <button class="hud-btn btn-secondary btn-sm" data-act="cancel"></button>
          <button class="hud-btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" data-act="ok"></button>
        </div>
      </div>`;
    overlay.querySelector('.confirm-message').textContent = message;
    overlay.querySelector('[data-act="cancel"]').textContent = cancelText;
    overlay.querySelector('[data-act="ok"]').textContent = okText;

    function done(val) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    }
    function onKey(e) {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') done(true);
      if (act === 'cancel') done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-act="ok"]').focus();
  });
}


function resetPipelineNodes() {
  const nodes = document.querySelectorAll('.pipeline-node');
  nodes.forEach(node => {
    node.className = 'pipeline-node';
  });

  const glowPaths = document.querySelectorAll('.glow-connector-path');
  glowPaths.forEach(path => {
    path.classList.add('hidden');
  });
}

function updatePipelineStep(stepIndex, status, logMessage) {
  const node = document.getElementById(`node-${stepIndex}`);
  if (!node) return;

  node.className = 'pipeline-node';

  if (status === 'pending') {
    node.classList.add('active');
  } else if (status === 'success') {
    node.classList.add('success');

    const glowPath = document.getElementById(`glow-path-${stepIndex}`);
    if (glowPath) {
      glowPath.classList.remove('hidden');
    }
  } else if (status === 'failed') {
    node.classList.add('failed');
  }

  appendTerminalLine(`[PIPELINE STAGE ${stepIndex}] ${logMessage}`, status === 'success' ? 'adb-success' : (status === 'failed' ? 'adb-error' : 'system'));
}

function drawConnectorPaths() {
  const svg = document.getElementById('pipeline-svg');
  if (!svg) return;

  const nodes = document.querySelectorAll('.pipeline-node');
  const svgRect = svg.getBoundingClientRect();

  for (let i = 0; i < nodes.length - 1; i++) {
    const nodeA = nodes[i].querySelector('.node-circle').getBoundingClientRect();
    const nodeB = nodes[i+1].querySelector('.node-circle').getBoundingClientRect();

    const x1 = nodeA.left - svgRect.left + nodeA.width / 2;
    const y1 = nodeA.top - svgRect.top + nodeA.height / 2;
    const x2 = nodeB.left - svgRect.left + nodeB.width / 2;
    const y2 = nodeB.top - svgRect.top + nodeB.height / 2;

    const path = document.getElementById(`path-${i}`);
    const glowPath = document.getElementById(`glow-path-${i}`);

    if (path && glowPath) {
      const d = `M ${x1} ${y1} L ${x2} ${y2}`;
      path.setAttribute('d', d);
      glowPath.setAttribute('d', d);
    }
  }
}

window.addEventListener('resize', drawConnectorPaths);
setTimeout(drawConnectorPaths, 500);


function appendTerminalLine(text, type = 'system') {
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  line.textContent = text;
  consoleLogs.appendChild(line);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}


function updateDiagnosticsHUD(data) {
  if (!data || !data.connected) {
    adbStatusDot.className = 'status-dot disconnected';
    adbStatusText.textContent = 'ADB DISCONNECTED';
    deviceModelText.textContent = 'NO DEVICE DETECTED';
    diagOs.textContent = 'N/A';
    diagBattery.textContent = 'N/A';
    diagBatteryFill.style.width = '0%';
    diagTemp.textContent = 'N/A';
    diagRes.textContent = 'N/A';

    btnRefreshScreen.disabled = true;
    phoneScreenshot.classList.add('hidden');
    screenFallback.classList.remove('hidden');
    return;
  }

  adbStatusDot.className = 'status-dot connected';
  adbStatusText.textContent = 'ADB CONNECTED';
  deviceModelText.textContent = `${data.brand} ${data.model}`.toUpperCase();

  diagOs.textContent = `ANDROID ${data.androidVersion}`;
  diagBattery.textContent = `${data.batteryLevel}% (${data.batteryStatus})`;
  diagBatteryFill.style.width = `${data.batteryLevel}%`;

  if (data.batteryTemp) {
    diagTemp.textContent = `${data.batteryTemp} °C`;
  } else {
    diagTemp.textContent = 'N/A';
  }

  diagRes.textContent = data.resolution;
  btnRefreshScreen.disabled = false;
  btnLiveFeed.disabled = false;
}

btnRefreshScreen.addEventListener('click', async () => {
  screenSpinner.classList.remove('hidden');
  appendTerminalLine('[DIAGNOSTICS] Requesting system screencap...', 'system');
  await fetchScreenshot();
});

let liveFeedInterval = null;
let mirrorTimer = null;
let mirrorBusy = false;
let mirrorObjectUrl = null;
const MIRROR_INTERVAL_MS = 300;

async function pullMirrorFrame() {
  if (mirrorBusy) return;
  mirrorBusy = true;
  try {
    const res = await fetch('/api/mirror/frame?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    phoneScreenshot.src = url;
    phoneScreenshot.classList.remove('hidden');
    screenFallback.classList.add('hidden');
    if (mirrorObjectUrl) URL.revokeObjectURL(mirrorObjectUrl);
    mirrorObjectUrl = url;
  } catch (e) {
    appendTerminalLine(`[MIRROR] Frame failed: ${e.message}`, 'adb-warning');
  } finally {
    mirrorBusy = false;
  }
}

function startMirror() {
  liveFeedText.textContent = 'STOP MIRROR';
  btnLiveFeed.classList.add('active', 'btn-primary');
  btnLiveFeed.classList.remove('btn-secondary');
  phoneScreenContainer.classList.add('mirror-live');
  appendTerminalLine('[MIRROR] Live mirror ON (~3 fps). Click the screen to tap, drag to swipe.', 'adb-info');
  pullMirrorFrame();
  mirrorTimer = setInterval(pullMirrorFrame, MIRROR_INTERVAL_MS);
}

function stopMirror() {
  clearInterval(mirrorTimer);
  mirrorTimer = null;
  liveFeedText.textContent = 'LIVE MIRROR';
  btnLiveFeed.classList.remove('active', 'btn-primary');
  btnLiveFeed.classList.add('btn-secondary');
  phoneScreenContainer.classList.remove('mirror-live');
  appendTerminalLine('[MIRROR] Live mirror stopped.', 'system');
}

btnLiveFeed.addEventListener('click', () => (mirrorTimer ? stopMirror() : startMirror()));
if (liveFeedText) liveFeedText.textContent = 'LIVE MIRROR';

(function wireMirrorInput() {
  let down = null;

  function norm(e) {
    const r = phoneScreenshot.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    };
  }

  async function sendSwipe(x1, y1, x2, y2, duration) {
    await fetch('/api/mirror/swipe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x1, y1, x2, y2, duration })
    });
    setTimeout(pullMirrorFrame, 100);
  }

  phoneScreenshot.setAttribute('draggable', 'false');
  phoneScreenshot.addEventListener('dragstart', (e) => e.preventDefault());

  phoneScreenshot.addEventListener('pointerdown', (e) => {
    if (!mirrorTimer) return;
    e.preventDefault();
    try { phoneScreenshot.setPointerCapture(e.pointerId); } catch {  }
    down = { pt: norm(e), t: Date.now() };
  });

  phoneScreenshot.addEventListener('pointerup', async (e) => {
    if (!mirrorTimer || !down || !down.pt) { down = null; return; }
    try { phoneScreenshot.releasePointerCapture(e.pointerId); } catch {  }
    const up = norm(e);
    const dist = up ? Math.hypot(up.x - down.pt.x, up.y - down.pt.y) : 0;
    try {
      if (dist > 0.03) {
        await sendSwipe(down.pt.x, down.pt.y, up.x, up.y, Math.max(80, Math.min(500, Date.now() - down.t)));
      } else {
        await fetch('/api/mirror/tap', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: down.pt.x, y: down.pt.y })
        });
        setTimeout(pullMirrorFrame, 120);
      }
    } catch (err) {
      appendTerminalLine(`[MIRROR] Input failed: ${err.message}`, 'adb-error');
    }
    down = null;
  });

  let wheelLock = false;
  let wheelAccum = 0;
  phoneScreenshot.addEventListener('wheel', (e) => {
    if (!mirrorTimer) return;
    e.preventDefault();
    wheelAccum += e.deltaY;
    if (wheelLock) return;
    wheelLock = true;

    const dir = wheelAccum > 0 ? 1 : -1;
    wheelAccum = 0;
    const cx = 0.5;
    const y1 = dir > 0 ? 0.68 : 0.32;
    const y2 = dir > 0 ? 0.32 : 0.68;
    sendSwipe(cx, y1, cx, y2, 140).catch((err) => {
      appendTerminalLine(`[MIRROR] Scroll failed: ${err.message}`, 'adb-error');
    });
    setTimeout(() => { wheelLock = false; }, 170);
  }, { passive: false });
})();

const btnRecord = document.getElementById('btn-record');
const recordText = document.getElementById('record-text');
let recordingActive = false;
if (btnRecord) {
  btnRecord.addEventListener('click', async () => {
    btnRecord.disabled = true;
    try {
      if (!recordingActive) {
        const r = await (await fetch('/api/record/start', { method: 'POST' })).json();
        if (r.success) {
          recordingActive = true;
          recordText.textContent = '■ STOP REC';
          btnRecord.classList.add('btn-primary');
          appendTerminalLine('[RECORD] Screen recording started (max 180s).', 'adb-info');
        } else { showToast('RECORD FAILED', r.error || 'could not start', 'error'); }
      } else {
        appendTerminalLine('[RECORD] Stopping + pulling video…', 'system');
        const r = await (await fetch('/api/record/stop', { method: 'POST' })).json();
        recordingActive = false;
        recordText.textContent = '● REC';
        btnRecord.classList.remove('btn-primary');
        if (r.success) {
          const a = document.createElement('a');
          a.href = r.url; a.download = r.fileName;
          document.body.appendChild(a); a.click(); a.remove();
          showToast('RECORDING SAVED', `${r.fileName} (${Math.round(r.size / 1024)} KB)`, 'success');
        } else { showToast('RECORD FAILED', r.error || 'could not stop', 'error'); }
      }
    } catch (e) {
      recordingActive = false; recordText.textContent = '● REC'; btnRecord.classList.remove('btn-primary');
      showToast('RECORD ERROR', e.message, 'error');
    } finally {
      btnRecord.disabled = false;
    }
  });
}

const btnInstallApk = document.getElementById('btn-install-apk');
const apkFileInput = document.getElementById('apk-file-input');
if (btnInstallApk && apkFileInput) {
  btnInstallApk.addEventListener('click', () => apkFileInput.click());
  apkFileInput.addEventListener('change', async () => {
    const file = apkFileInput.files && apkFileInput.files[0];
    if (!file) return;
    btnInstallApk.disabled = true;
    btnInstallApk.textContent = '📦 INSTALLING…';
    appendTerminalLine(`[APK] Installing ${file.name}…`, 'adb-info');
    try {
      const fd = new FormData();
      fd.append('apk', file);
      const r = await (await fetch('/api/apps/install', { method: 'POST', body: fd })).json();
      if (r.success) {
        showToast('APK INSTALLED', file.name, 'success');
        appendTerminalLine(`[APK] ${file.name} installed.`, 'adb-success');
      } else {
        showToast('INSTALL FAILED', r.error?.message || r.error || 'unknown', 'error');
      }
    } catch (e) {
      showToast('INSTALL FAILED', e.message, 'error');
    } finally {
      btnInstallApk.disabled = false;
      btnInstallApk.textContent = '📦 INSTALL APK ON PHONE';
      apkFileInput.value = '';
    }
  });
}

async function fetchScreenshot() {
  try {
    const res = await fetch('/api/screenshot');
    const data = await res.json();

    if (data.success) {
      phoneScreenshot.src = data.url;
      phoneScreenshot.classList.remove('hidden');
      screenFallback.classList.add('hidden');
      if (!liveFeedInterval) appendTerminalLine('[DIAGNOSTICS] Screencap successful.', 'adb-success');
    } else {
      appendTerminalLine(`[ERROR] Screencap failed: ${data.error}`, 'adb-error');
    }
  } catch (error) {
    appendTerminalLine(`[ERROR] Screencap fetch failed: ${error.message}`, 'adb-error');
  } finally {
    screenSpinner.classList.add('hidden');
  }
}


function submitCommand(opts = {}) {
  const text = cmdTextInput.value.trim();
  if (!text) return;

  appendTerminalLine(`[INPUT] Sent Command: "${text}"`, 'system');
  const payload = { type: 'execute_command', command: text };
  if (Array.isArray(opts.alternatives) && opts.alternatives.length > 1) {
    payload.alternatives = opts.alternatives.slice(0, 5);
  }
  if (opts.source === 'voice') payload.source = 'voice';
  socket.send(JSON.stringify(payload));

  cmdTextInput.value = '';
}

btnSubmitCmd.addEventListener('click', submitCommand);
cmdTextInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCommand();
});


function showShutdownOverlay(seconds) {
  shutdownOverlay.classList.remove('hidden');
  shutdownCountdown.textContent = seconds;
}

function updateShutdownTimer(seconds) {
  shutdownCountdown.textContent = seconds;
}

function hideShutdownOverlay() {
  shutdownOverlay.classList.add('hidden');
}

btnAbortShutdown.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'cancel_shutdown' }));
});


let editingContactId = null;

async function fetchContacts() {
  try {
    const res = await fetch('/api/contacts');
    const data = await res.json();
    contactsData = Array.isArray(data) ? data : [];
    renderContacts();
  } catch (err) {
    appendTerminalLine('[SYSTEM] Failed to load contacts.', 'adb-error');
  }
}

function renderContacts() {
  contactsListContainer.innerHTML = '';
  contactsData.forEach(contact => {
    const card = document.createElement('div');
    card.className = 'contact-card' + (contact.id === editingContactId ? ' editing' : '');

    card.innerHTML = `
      <div class="contact-info">
        <span class="contact-name"></span>
        <span class="contact-number"></span>
      </div>
      <div class="contact-actions">
        <button class="btn-icon btn-edit-contact" title="Edit">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button class="btn-icon btn-delete-contact" title="Delete">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </div>
    `;
    card.querySelector('.contact-name').textContent = contact.name;
    card.querySelector('.contact-number').textContent = '+' + contact.number;
    card.querySelector('.btn-edit-contact').addEventListener('click', () => startEditContact(contact));
    card.querySelector('.btn-delete-contact').addEventListener('click', () => deleteContact(contact.id));
    contactsListContainer.appendChild(card);
  });

  if (btnSaveContact) btnSaveContact.textContent = editingContactId ? 'UPDATE CONTACT' : 'SAVE CONTACT';
  drawConnectorPaths();
}

function startEditContact(contact) {
  editingContactId = contact.id;
  contactNameInput.value = contact.name;
  contactPhoneInput.value = contact.number;
  contactNameInput.focus();
  renderContacts();
}

function cancelEditContact() {
  editingContactId = null;
  contactNameInput.value = '';
  contactPhoneInput.value = '';
  renderContacts();
}

async function persistContacts(successMsg) {
  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contactsData)
    });
    if (res.ok) {
      appendTerminalLine(`[SYSTEM] ${successMsg}`, 'adb-success');
      return true;
    }
    const err = await res.json().catch(() => ({}));
    showToast('CONTACT SAVE FAILED', err.error?.message || `HTTP ${res.status}`, 'error');
  } catch (err) {
    showToast('CONTACT SAVE FAILED', err.message, 'error');
  }
  return false;
}

async function saveContact() {
  const name = contactNameInput.value.trim();
  const phone = contactPhoneInput.value.trim().replace(/[^0-9+]/g, '');

  if (!name || !/^\+?[0-9]{6,15}$/.test(phone)) {
    showToast('INVALID CONTACT', 'Enter a name and a 6-15 digit phone number.', 'warning');
    return;
  }

  const snapshot = JSON.parse(JSON.stringify(contactsData));
  if (editingContactId) {
    const c = contactsData.find(x => x.id === editingContactId);
    if (c) { c.name = name; c.number = phone; }
  } else {
    contactsData.push({ id: Date.now().toString(), name, number: phone });
  }

  const ok = await persistContacts(editingContactId ? `Updated contact: ${name}` : `Saved contact: ${name}`);
  if (!ok) { contactsData = snapshot; renderContacts(); return; }

  editingContactId = null;
  contactNameInput.value = '';
  contactPhoneInput.value = '';
  renderContacts();
}

async function deleteContact(id) {
  const target = contactsData.find(c => c.id === id);
  if (!(await confirmDialog(`Delete "${target?.name || 'this contact'}"?`, { okText: 'Delete', danger: true }))) return;
  const snapshot = JSON.parse(JSON.stringify(contactsData));
  contactsData = contactsData.filter(c => c.id !== id);
  if (editingContactId === id) cancelEditContact();
  const ok = await persistContacts('Contact deleted.');
  if (!ok) { contactsData = snapshot; }
  renderContacts();
}

btnSaveContact.addEventListener('click', saveContact);
contactPhoneInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveContact(); });


const cfgAutoUnlock = document.getElementById('cfg-auto-unlock');

async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    configData = await res.json();

    cfgPinInput.value = '';
    cfgPinInput.placeholder = configData.hasUnlockPin ? 'PIN saved — type to change' : 'Enter device unlock PIN code';
    if (cfgAutoUnlock) cfgAutoUnlock.checked = Boolean(configData.autoUnlock);
    cfgWxInput.value = configData.whatsappCoords ? configData.whatsappCoords.x : 0.91;
    cfgWyInput.value = configData.whatsappCoords ? configData.whatsappCoords.y : 0.55;
  } catch (err) {
    appendTerminalLine('[SYSTEM] Failed to load config settings.', 'adb-error');
  }
}

async function saveConfig() {
  const body = {
    whatsappCoords: {
      x: parseFloat(cfgWxInput.value) || 0.91,
      y: parseFloat(cfgWyInput.value) || 0.55
    }
  };
  const pin = cfgPinInput.value.trim();
  if (pin) body.unlockPin = pin;
  if (cfgAutoUnlock) body.autoUnlock = cfgAutoUnlock.checked;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      appendTerminalLine('[SYSTEM] System configuration applied.', 'adb-success');
      cfgPinInput.value = '';
      await fetchConfig();
      showToast('SETTINGS SAVED', 'System configuration applied.', 'success');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast('SAVE FAILED', err.error?.message || `HTTP ${res.status}`, 'error');
    }
  } catch (err) {
    showToast('SAVE FAILED', err.message, 'error');
  }
}

btnSaveConfig.addEventListener('click', saveConfig);

const btnTestUnlock = document.getElementById('btn-test-unlock');
if (btnTestUnlock) {
  btnTestUnlock.addEventListener('click', async () => {
    btnTestUnlock.disabled = true;
    appendTerminalLine('[UNLOCK] Testing phone unlock...', 'system');
    try {
      const res = await fetch('/api/unlock', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        appendTerminalLine(
          data.alreadyUnlocked ? '[UNLOCK] Phone was already unlocked.' : '[UNLOCK] Phone unlocked successfully.',
          'adb-success'
        );
      } else {
        appendTerminalLine(`[UNLOCK] Failed: ${data.error?.message || data.error || res.status}`, 'adb-error');
      }
    } catch (e) {
      appendTerminalLine(`[UNLOCK] Failed: ${e.message}`, 'adb-error');
    } finally {
      btnTestUnlock.disabled = false;
    }
  });
}


const tabMap = {
  'tab-btn-contacts': 'tab-content-contacts',
  'tab-btn-files': 'tab-content-files',
  'tab-btn-macros': 'tab-content-macros',
  'tab-btn-ai': 'tab-content-ai',
  'tab-btn-settings': 'tab-content-settings'
};

Object.keys(tabMap).forEach(btnId => {
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.addEventListener('click', () => {
      Object.keys(tabMap).forEach(id => {
        const tabBtn = document.getElementById(id);
        const tabContent = document.getElementById(tabMap[id]);
        if (tabBtn) tabBtn.classList.remove('active');
        if (tabContent) tabContent.classList.add('hidden');
      });
      btn.classList.add('active');
      const content = document.getElementById(tabMap[btnId]);
      if (content) content.classList.remove('hidden');
      drawConnectorPaths();
    });
  }
});


fetchContacts();
fetchConfig();

setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'request_diagnostics' }));
  }
}, 5000);


const btnSyncContacts = document.getElementById('btn-sync-contacts');
if (btnSyncContacts) {
  btnSyncContacts.addEventListener('click', async () => {
    btnSyncContacts.disabled = true;
    btnSyncContacts.textContent = 'SYNCING...';
    appendTerminalLine('[CONTACTS] Initiating phone contacts sync via ADB...', 'system');

    try {
      const res = await fetch('/api/sync-contacts', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        appendTerminalLine(`[CONTACTS] Sync complete! ${data.totalSynced} found on device, ${data.newAdded} new contacts added. Total: ${data.totalContacts}`, 'adb-success');
        if (typeof window.vaniSpeak === 'function') {
          window.vaniSpeak(`Contacts synced. ${data.newAdded} new contacts imported from your phone.`);
        }
        await fetchContacts();
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (err) {
      appendTerminalLine(`[CONTACTS] Sync failed: ${err.message}`, 'adb-error');
      if (typeof window.vaniSpeak === 'function') {
        window.vaniSpeak('Contact sync failed. Please check device connection.');
      }
    } finally {
      btnSyncContacts.disabled = false;
      btnSyncContacts.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> SYNC PHONE CONTACTS`;
    }
  });
}

const btnClearContacts = document.getElementById('btn-clear-contacts');
if (btnClearContacts) {
  btnClearContacts.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete ALL contacts? This cannot be undone.', { okText: 'Delete all', danger: true }))) return;

    btnClearContacts.disabled = true;
    try {
      const res = await fetch('/api/contacts', { method: 'DELETE' });
      if (res.ok) {
        contactsData = [];
        renderContacts();
        appendTerminalLine('[SYSTEM] All contacts cleared successfully.', 'adb-success');
        if (typeof window.vaniSpeak === 'function') {
          window.vaniSpeak('All contacts have been deleted successfully.');
        }
      }
    } catch (err) {
      showToast('CLEAR FAILED', err.message, 'error');
    } finally {
      btnClearContacts.disabled = false;
    }
  });
}


const btnWireless = document.getElementById('btn-wireless-toggle');
const wirelessStatus = document.getElementById('wireless-status');
let isWirelessActive = false;

if (btnWireless) {
  btnWireless.addEventListener('click', async () => {
    btnWireless.disabled = true;

    if (!isWirelessActive) {
      btnWireless.textContent = 'ENABLING...';
      appendTerminalLine('[WIRELESS] Enabling wireless ADB mode...', 'system');

      try {
        const res = await fetch('/api/wireless/enable', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          isWirelessActive = true;
          appendTerminalLine(`[WIRELESS] Wireless ADB active at ${data.ip}:${data.port}. You can remove the USB cable now!`, 'adb-success');
          if (wirelessStatus) {
            wirelessStatus.textContent = `ACTIVE (${data.ip}:${data.port})`;
            wirelessStatus.className = 'wireless-status active';
          }
          btnWireless.textContent = 'DISABLE WIRELESS';
          btnWireless.classList.add('wireless-on');
          if (typeof window.vaniSpeak === 'function') {
            window.vaniSpeak(`Wireless mode activated. You can now remove the USB cable. Device IP is ${data.ip}.`);
          }
        } else {
          throw new Error(data.error || 'Failed');
        }
      } catch (err) {
        appendTerminalLine(`[WIRELESS] Enable failed: ${err.message}`, 'adb-error');
        if (typeof window.vaniSpeak === 'function') {
          window.vaniSpeak('Wireless mode activation failed.');
        }
      }
    } else {
      btnWireless.textContent = 'DISABLING...';
      appendTerminalLine('[WIRELESS] Disabling wireless ADB...', 'system');

      try {
        const res = await fetch('/api/wireless/disable', { method: 'POST' });
        const data = await res.json();

        isWirelessActive = false;
        if (wirelessStatus) {
          wirelessStatus.textContent = 'INACTIVE (USB ONLY)';
          wirelessStatus.className = 'wireless-status';
        }
        btnWireless.textContent = 'ENABLE WIRELESS';
        btnWireless.classList.remove('wireless-on');
        appendTerminalLine('[WIRELESS] Reverted to USB transport.', 'adb-success');
      } catch (err) {
        appendTerminalLine(`[WIRELESS] Disable failed: ${err.message}`, 'adb-error');
      }
    }

    btnWireless.disabled = false;
  });
}
