// ==========================================================================
// NexusFlow Core Frontend Controller
// ==========================================================================

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${wsProtocol}//${window.location.host}`);

let contactsData = [];
let configData = {};

// Cache DOM Elements
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

// Tabs
const tabBtnContacts = document.getElementById('tab-btn-contacts');
const tabBtnSettings = document.getElementById('tab-btn-settings');
const tabContentContacts = document.getElementById('tab-content-contacts');
const tabContentSettings = document.getElementById('tab-content-settings');

// Contacts
const contactsListContainer = document.getElementById('contacts-list-container');
const contactNameInput = document.getElementById('contact-name');
const contactPhoneInput = document.getElementById('contact-phone');
const btnSaveContact = document.getElementById('btn-save-contact');

// Config settings
const cfgPinInput = document.getElementById('cfg-pin');
const cfgWxInput = document.getElementById('cfg-wx');
const cfgWyInput = document.getElementById('cfg-wy');
const btnSaveConfig = document.getElementById('btn-save-config');

// Initialize WebSockets
socket.addEventListener('open', () => {
  appendTerminalLine('[SYSTEM] Server WebSocket channel established.', 'system');
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

    case 'pipeline_start':
      resetPipelineNodes();
      appendTerminalLine(`[PIPELINE START] Instruction: "${data.command}"`, 'adb-info');
      break;

    case 'pipeline_step':
      updatePipelineStep(data.step, data.status, data.message);
      break;

    case 'pipeline_end':
      appendTerminalLine(`[PIPELINE END] Success: ${data.success}${data.error ? ' | Error: ' + data.error : ''}`, data.success ? 'adb-success' : 'adb-error');
      
      // Pro-Max Visuals: Toast and Particles
      if (data.success) {
        showToast('PIPELINE SUCCESS', data.ttsMessage || 'Action executed successfully.', 'success');
        if (typeof window.spawnParticlePulse === 'function') {
          // Trigger multiple particle bursts
          setTimeout(() => window.spawnParticlePulse(window.innerWidth/2, window.innerHeight/2), 100);
          setTimeout(() => window.spawnParticlePulse(window.innerWidth/3, window.innerHeight/2), 300);
          setTimeout(() => window.spawnParticlePulse(window.innerWidth*0.66, window.innerHeight/2), 500);
        }
      } else {
        showToast('PIPELINE FAILED', data.error || 'Unknown error occurred.', 'error');
      }

      // FEATURE 2: Vani TTS voice response
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
  appendTerminalLine('[SYSTEM] Server connection closed. Reconnecting...', 'adb-error');
  adbStatusDot.className = 'status-dot disconnected';
  adbStatusText.textContent = 'SERVER DISCONNECTED';
  showToast('CONNECTION LOST', 'Server WebSocket connection dropped.', 'error');
});

// ==========================================================================
// Toast Notification System
// ==========================================================================

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
  
  // Auto remove after 4.5 seconds
  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4500);
}

// ==========================================================================
// Pipeline Visualization Rendering
// ==========================================================================

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

  // Reset classes and apply state
  node.className = 'pipeline-node';
  
  if (status === 'pending') {
    node.classList.add('active');
  } else if (status === 'success') {
    node.classList.add('success');
    
    // Light up connecting path to next node
    const glowPath = document.getElementById(`glow-path-${stepIndex}`);
    if (glowPath) {
      glowPath.classList.remove('hidden');
    }
  } else if (status === 'failed') {
    node.classList.add('failed');
  }

  appendTerminalLine(`[PIPELINE STAGE ${stepIndex}] ${logMessage}`, status === 'success' ? 'adb-success' : (status === 'failed' ? 'adb-error' : 'system'));
}

// Draw paths between nodes dynamically
function drawConnectorPaths() {
  const svg = document.getElementById('pipeline-svg');
  if (!svg) return;
  
  const nodes = document.querySelectorAll('.pipeline-node');
  const svgRect = svg.getBoundingClientRect();
  
  for (let i = 0; i < nodes.length - 1; i++) {
    const nodeA = nodes[i].querySelector('.node-circle').getBoundingClientRect();
    const nodeB = nodes[i+1].querySelector('.node-circle').getBoundingClientRect();
    
    // Calculate centers
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

// Draw paths after render and resize
window.addEventListener('resize', drawConnectorPaths);
setTimeout(drawConnectorPaths, 500);

// ==========================================================================
// Terminal Logs Writer
// ==========================================================================

function appendTerminalLine(text, type = 'system') {
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  line.textContent = text;
  consoleLogs.appendChild(line);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// ==========================================================================
// Diagnostics HUD Updater
// ==========================================================================

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

  // Update connected states
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

// Pull Mobile Screenshot
btnRefreshScreen.addEventListener('click', async () => {
  screenSpinner.classList.remove('hidden');
  appendTerminalLine('[DIAGNOSTICS] Requesting system screencap...', 'system');
  await fetchScreenshot();
});

let liveFeedInterval = null;
btnLiveFeed.addEventListener('click', () => {
  if (liveFeedInterval) {
    // Stop Live Feed
    clearInterval(liveFeedInterval);
    liveFeedInterval = null;
    liveFeedText.textContent = 'LIVE FEED';
    btnLiveFeed.classList.remove('active', 'btn-primary');
    btnLiveFeed.classList.add('btn-secondary');
    appendTerminalLine('[SYSTEM] Live Screen Feed stopped.', 'system');
  } else {
    // Start Live Feed
    liveFeedText.textContent = 'STOP FEED';
    btnLiveFeed.classList.add('active', 'btn-primary');
    btnLiveFeed.classList.remove('btn-secondary');
    appendTerminalLine('[SYSTEM] Starting Live Screen Feed (1 FPS)...', 'adb-info');
    fetchScreenshot(); // initial fetch
    liveFeedInterval = setInterval(fetchScreenshot, 2000); // 2 sec interval for stability
  }
});

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

// ==========================================================================
// Command Execution Trigger
// ==========================================================================

function submitCommand() {
  const text = cmdTextInput.value.trim();
  if (!text) return;

  appendTerminalLine(`[INPUT] Sent Command: "${text}"`, 'system');
  socket.send(JSON.stringify({
    type: 'execute_command',
    command: text
  }));

  cmdTextInput.value = '';
}

btnSubmitCmd.addEventListener('click', submitCommand);
cmdTextInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCommand();
});

// ==========================================================================
// PC Shutdown Sequence Dialogs
// ==========================================================================

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

// ==========================================================================
// Contacts CRUD Editor Panel
// ==========================================================================

async function fetchContacts() {
  try {
    const res = await fetch('/api/contacts');
    contactsData = await res.json();
    renderContacts();
  } catch (err) {
    appendTerminalLine('[SYSTEM] Failed to load contacts.', 'adb-error');
  }
}

function renderContacts() {
  contactsListContainer.innerHTML = '';
  contactsData.forEach(contact => {
    const card = document.createElement('div');
    card.className = 'contact-card';
    
    card.innerHTML = `
      <div class="contact-info">
        <span class="contact-name">${contact.name}</span>
        <span class="contact-number">+${contact.number}</span>
      </div>
      <div class="contact-actions">
        <button class="btn-icon btn-delete-contact" data-id="${contact.id}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </div>
    `;
    
    contactsListContainer.appendChild(card);
  });

  // Attach delete listeners
  document.querySelectorAll('.btn-delete-contact').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      deleteContact(id);
    });
  });
  
  // Re-align pipeline paths since height of column might change
  drawConnectorPaths();
}

async function saveContact() {
  const name = contactNameInput.value.trim();
  const phone = contactPhoneInput.value.trim().replace(/[^0-9]/g, '');

  if (!name || !phone) {
    alert('Please enter valid contact details');
    return;
  }

  // Create new or edit existing
  const newContact = {
    id: Date.now().toString(),
    name,
    number: phone
  };

  contactsData.push(newContact);

  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contactsData)
    });
    
    if (res.ok) {
      contactNameInput.value = '';
      contactPhoneInput.value = '';
      renderContacts();
      appendTerminalLine(`[SYSTEM] Saved contact: ${name}`, 'system');
    }
  } catch (err) {
    alert('Failed to save contact');
  }
}

async function deleteContact(id) {
  contactsData = contactsData.filter(c => c.id !== id);
  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contactsData)
    });
    if (res.ok) {
      renderContacts();
      appendTerminalLine('[SYSTEM] Contact deleted.', 'system');
    }
  } catch (err) {
    alert('Failed to delete contact');
  }
}

btnSaveContact.addEventListener('click', saveContact);

// ==========================================================================
// Settings Panel Form
// ==========================================================================

async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    configData = await res.json();
    
    cfgPinInput.value = configData.unlockPin || '';
    cfgWxInput.value = configData.whatsappCoords ? configData.whatsappCoords.x : 0.91;
    cfgWyInput.value = configData.whatsappCoords ? configData.whatsappCoords.y : 0.55;
  } catch (err) {
    appendTerminalLine('[SYSTEM] Failed to load config settings.', 'adb-error');
  }
}

async function saveConfig() {
  configData.unlockPin = cfgPinInput.value.trim();
  configData.whatsappCoords = {
    x: parseFloat(cfgWxInput.value) || 0.91,
    y: parseFloat(cfgWyInput.value) || 0.55
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configData)
    });
    
    if (res.ok) {
      appendTerminalLine('[SYSTEM] System configuration applied.', 'adb-success');
      alert('Properties saved successfully!');
    }
  } catch (err) {
    alert('Failed to apply properties.');
  }
}

btnSaveConfig.addEventListener('click', saveConfig);

// ==========================================================================
// Tab Navigations
// ==========================================================================

tabBtnContacts.addEventListener('click', () => {
  tabBtnContacts.classList.add('active');
  tabBtnSettings.classList.remove('active');
  tabContentContacts.classList.remove('hidden');
  tabContentSettings.classList.add('hidden');
  drawConnectorPaths();
});

tabBtnSettings.addEventListener('click', () => {
  tabBtnSettings.classList.add('active');
  tabBtnContacts.classList.remove('active');
  tabContentSettings.classList.remove('hidden');
  tabContentContacts.classList.add('hidden');
  drawConnectorPaths();
});

// ==========================================================================
// Initial Boot
// ==========================================================================

fetchContacts();
fetchConfig();

// Query diagnostics state every 5 seconds
setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'request_diagnostics' }));
  }
}, 5000);

// ==========================================================================
// FEATURE 3: Sync Phone Contacts via ADB
// ==========================================================================

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
        // Reload contacts list
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
    if (!confirm('Are you sure you want to delete ALL contacts?')) return;
    
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
      alert('Failed to clear contacts');
    } finally {
      btnClearContacts.disabled = false;
    }
  });
}

// ==========================================================================
// FEATURE 4: Wireless ADB Mode Toggle
// ==========================================================================

const btnWireless = document.getElementById('btn-wireless-toggle');
const wirelessStatus = document.getElementById('wireless-status');
let isWirelessActive = false;

if (btnWireless) {
  btnWireless.addEventListener('click', async () => {
    btnWireless.disabled = true;
    
    if (!isWirelessActive) {
      // Enable wireless
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
      // Disable wireless
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
