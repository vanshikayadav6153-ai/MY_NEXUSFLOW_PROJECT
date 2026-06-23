import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

// Import our custom modules
import { 
  ensureAdbInstalled, 
  getDeviceDiagnostics, 
  unlockPhone, 
  makeCall, 
  sendWhatsAppMessage, 
  captureScreen, 
  setLogCallback,
  syncPhoneContacts,
  enableWirelessAdb,
  disableWirelessAdb,
  volumeUp,
  volumeDown,
  volumeMute,
  setBrightness,
  toggleFlashlight,
  openApp,
  openUrl,
  toggleWifi,
  toggleBluetooth,
  takePhoto,
  mediaPlayPause,
  mediaNext,
  mediaPrevious,
  pressHome,
  pressBack,
  openRecents,
  openNotifications
} from './adb.js';
import { parseCommand } from './nlp.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Setup database file paths
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Initialize files if they don't exist
if (!fs.existsSync(CONTACTS_FILE)) {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify([
    { id: '1', name: 'Mom', number: '9876543210' },
    { id: '2', name: 'Dad', number: '9876543211' },
    { id: '3', name: 'Yash', number: '9876543212' },
    { id: '4', name: 'Boss', number: '9876543213' }
  ], null, 2));
}

if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    unlockPin: '',
    whatsappCoords: { x: 0.91, y: 0.55 }
  }, null, 2));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Global state for PC shutdown timer
let shutdownTimer = null;
let shutdownTimeLeft = 10;

// HTTP API Routes
app.get('/api/contacts', (req, res) => {
  try {
    const data = fs.readFileSync(CONTACTS_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Failed to read contacts' });
  }
});

app.post('/api/contacts', (req, res) => {
  try {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save contacts' });
  }
});

app.get('/api/config', (req, res) => {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Failed to read config' });
  }
});

app.post('/api/config', (req, res) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

app.get('/api/diagnostics', async (req, res) => {
  try {
    const diagnostics = await getDeviceDiagnostics();
    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/screenshot', async (req, res) => {
  try {
    const screenshotPath = path.join(__dirname, '../public/screen.png');
    await captureScreen(screenshotPath);
    res.json({ success: true, url: '/screen.png?t=' + Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FEATURE 3: Sync contacts from connected phone
app.post('/api/sync-contacts', async (req, res) => {
  try {
    const phoneContacts = await syncPhoneContacts();
    
    // Merge with existing contacts (avoid duplicates by number)
    let existing = [];
    try {
      existing = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    } catch (e) { /* empty */ }
    
    const existingNumbers = new Set(existing.map(c => c.number));
    let addedCount = 0;
    
    for (const pc of phoneContacts) {
      if (!existingNumbers.has(pc.number)) {
        existing.push(pc);
        existingNumbers.add(pc.number);
        addedCount++;
      }
    }
    
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(existing, null, 2));
    res.json({ 
      success: true, 
      totalSynced: phoneContacts.length, 
      newAdded: addedCount,
      totalContacts: existing.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FEATURE 4: Wireless ADB toggle
app.post('/api/wireless/enable', async (req, res) => {
  try {
    const result = await enableWirelessAdb();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/wireless/disable', async (req, res) => {
  try {
    const result = await disableWirelessAdb();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Setup server and WebSockets
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Broadcast helper
function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// Connect ADB logs to WebSocket clients
setLogCallback((logObj) => {
  broadcast({ type: 'adb_log', log: logObj });
});

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  
  // Send immediate ADB status update
  getDeviceDiagnostics().then(diagnostics => {
    ws.send(JSON.stringify({ type: 'diagnostics', data: diagnostics }));
  });

  ws.on('message', async (messageData) => {
    try {
      const payload = JSON.parse(messageData);
      
      if (payload.type === 'execute_command') {
        const commandText = payload.command;
        await executePipeline(commandText);
      } 
      
      else if (payload.type === 'cancel_shutdown') {
        cancelPcShutdown();
      }
      
      else if (payload.type === 'request_diagnostics') {
        const diagnostics = await getDeviceDiagnostics();
        ws.send(JSON.stringify({ type: 'diagnostics', data: diagnostics }));
      }
    } catch (err) {
      console.error('[WS ERROR]', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

/**
 * Executes the entire parsed intent pipeline step-by-step
 */
async function executePipeline(commandText) {
  broadcast({ type: 'pipeline_start', command: commandText });

  // Read current configuration and contacts
  let contacts = [];
  let config = { unlockPin: '', whatsappCoords: { x: 0.91, y: 0.55 } };
  
  try {
    contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to parse database files', e);
  }

  // Step 1: NLP Intent Extraction
  broadcast({ type: 'pipeline_step', step: 0, status: 'pending', message: 'Parsing natural language intent...' });
  await new Promise(resolve => setTimeout(resolve, 800)); // Dramatic speed effect

  const parsed = parseCommand(commandText, contacts);
  
  if (parsed.details && parsed.details.wakeWordDetected) {
    broadcast({ 
      type: 'adb_log', 
      log: { 
        type: 'success', 
        message: `[WAKE WORD] Wake word 'Vani' authenticated! Triggering automated pipelines...` 
      } 
    });
  }
  
  if (parsed.intent === 'UNKNOWN') {
    broadcast({ 
      type: 'pipeline_step', 
      step: 0, 
      status: 'failed', 
      message: `Failed to extract intent from command: "${commandText}"` 
    });
    broadcast({ type: 'pipeline_end', success: false, error: 'Command not recognized' });
    return;
  }

  broadcast({ 
    type: 'pipeline_step', 
    step: 0, 
    status: 'success', 
    message: `Intent detected: ${parsed.intent}. Pipeline structured: [${parsed.pipeline.join(' ➔ ')}]` 
  });
  
  // Step 2: Contact Resolution / Parameter Extraction
  broadcast({ type: 'pipeline_step', step: 1, status: 'pending', message: 'Verifying command parameters...' });
  await new Promise(resolve => setTimeout(resolve, 600));

  if (parsed.intent === 'CALL' || parsed.intent === 'WHATSAPP') {
    if (!parsed.details.number) {
      broadcast({ 
        type: 'pipeline_step', 
        step: 1, 
        status: 'failed', 
        message: `Contact or phone number could not be resolved from command.` 
      });
      broadcast({ type: 'pipeline_end', success: false, error: 'Unresolved phone number' });
      return;
    }
    broadcast({ 
      type: 'pipeline_step', 
      step: 1, 
      status: 'success', 
      message: `Resolved Contact: ${parsed.details.name || 'Raw Number'} (${parsed.details.number})` 
    });
  } else {
    broadcast({ 
      type: 'pipeline_step', 
      step: 1, 
      status: 'success', 
      message: `Parameters resolved: Target device is ${parsed.details.target}` 
    });
  }

  // Step 3: Device / System Handshake
  broadcast({ type: 'pipeline_step', step: 2, status: 'pending', message: 'Checking execution endpoint state...' });
  
  if (parsed.intent === 'SHUTDOWN') {
    // Local PC command has no ADB dependency
    broadcast({ type: 'pipeline_step', step: 2, status: 'success', message: 'PC System online. Proceeding...' });
  } else {
    // ADB check
    const diagnostics = await getDeviceDiagnostics();
    if (!diagnostics.connected) {
      broadcast({ 
        type: 'pipeline_step', 
        step: 2, 
        status: 'failed', 
        message: 'Device disconnected! Ensure phone is connected via Type-C USB cable and USB Debugging is ON.' 
      });
      broadcast({ type: 'pipeline_end', success: false, error: 'Mobile device not connected' });
      return;
    }
    broadcast({ 
      type: 'pipeline_step', 
      step: 2, 
      status: 'success', 
      message: `Connected to ${diagnostics.brand} ${diagnostics.model} via ADB (USB status: Active)` 
    });
  }

  // Step 4: Compiling script commands
  broadcast({ type: 'pipeline_step', step: 3, status: 'pending', message: 'Compiling automation script execution vectors...' });
  await new Promise(resolve => setTimeout(resolve, 500));
  
  let commandSummary = '';
  if (parsed.intent === 'SHUTDOWN') {
    commandSummary = 'shutdown /s /t 10';
  } else if (parsed.intent === 'UNLOCK') {
    commandSummary = `input keyevent 82 && input text ${config.unlockPin || '****'} && input keyevent 66`;
  } else if (parsed.intent === 'CALL') {
    commandSummary = `am start -a android.intent.action.CALL -d tel:${parsed.details.number}`;
  } else if (parsed.intent === 'WHATSAPP') {
    commandSummary = `am start -a android.intent.action.VIEW -d "whatsapp://send?phone=${parsed.details.number}" && input tap ${config.whatsappCoords.x}, ${config.whatsappCoords.y}`;
  }

  broadcast({ type: 'pipeline_step', step: 3, status: 'success', message: `Script compiled successfully: ${commandSummary}` });

  // Step 5: Execution Engine Action
  broadcast({ type: 'pipeline_step', step: 4, status: 'pending', message: 'Executing instruction pipeline...' });

  try {
    let ttsMessage = '';
    
    if (parsed.intent === 'SHUTDOWN') {
      startPcShutdown();
      ttsMessage = 'Warning! Initiating computer shutdown sequence. You have 10 seconds to abort.';
    } else if (parsed.intent === 'UNLOCK') {
      const unlockResult = await unlockPhone(config.unlockPin);
      if (unlockResult.alreadyUnlocked) {
        ttsMessage = 'Phone is already unlocked. No action needed.';
      } else {
        ttsMessage = 'Phone unlock sequence completed successfully.';
      }
    } else if (parsed.intent === 'CALL') {
      await makeCall(parsed.details.number);
      ttsMessage = `Calling ${parsed.details.name || 'the number'} now on your device.`;
    } else if (parsed.intent === 'WHATSAPP') {
      await sendWhatsAppMessage(parsed.details.number, parsed.details.message, config.whatsappCoords);
      ttsMessage = `WhatsApp message sent to ${parsed.details.name || 'the contact'}.`;
    } else if (parsed.intent === 'VOLUME_UP') {
      await volumeUp();
      ttsMessage = 'Volume increased.';
    } else if (parsed.intent === 'VOLUME_DOWN') {
      await volumeDown();
      ttsMessage = 'Volume decreased.';
    } else if (parsed.intent === 'MUTE') {
      await volumeMute();
      ttsMessage = 'Phone muted.';
    } else if (parsed.intent === 'BRIGHTNESS') {
      await setBrightness(parsed.details.level);
      ttsMessage = `Brightness set to ${parsed.details.level > 200 ? 'maximum' : parsed.details.level < 50 ? 'minimum' : 'adjusted level'}.`;
    } else if (parsed.intent === 'FLASHLIGHT') {
      await toggleFlashlight(parsed.details.state);
      ttsMessage = `Flashlight turned ${parsed.details.state ? 'on' : 'off'}.`;
    } else if (parsed.intent === 'OPEN_APP') {
      await openApp(parsed.details.appName);
      ttsMessage = `Opening ${parsed.details.appName} on your phone.`;
    } else if (parsed.intent === 'OPEN_URL') {
      await openUrl(parsed.details.url);
      ttsMessage = `Opening website in browser.`;
    } else if (parsed.intent === 'WIFI_ON') {
      await toggleWifi(true);
      ttsMessage = 'WiFi has been turned on.';
    } else if (parsed.intent === 'WIFI_OFF') {
      await toggleWifi(false);
      ttsMessage = 'WiFi has been turned off.';
    } else if (parsed.intent === 'BLUETOOTH_ON') {
      await toggleBluetooth(true);
      ttsMessage = 'Bluetooth has been enabled.';
    } else if (parsed.intent === 'BLUETOOTH_OFF') {
      await toggleBluetooth(false);
      ttsMessage = 'Bluetooth has been disabled.';
    } else if (parsed.intent === 'TAKE_PHOTO') {
      await takePhoto();
      ttsMessage = 'Photo captured successfully.';
    } else if (parsed.intent === 'MEDIA_PLAY') {
      await mediaPlayPause();
      ttsMessage = 'Media playback toggled.';
    } else if (parsed.intent === 'MEDIA_NEXT') {
      await mediaNext();
      ttsMessage = 'Skipped to next track.';
    } else if (parsed.intent === 'MEDIA_PREV') {
      await mediaPrevious();
      ttsMessage = 'Playing previous track.';
    } else if (parsed.intent === 'HOME') {
      await pressHome();
      ttsMessage = 'Home screen activated.';
    } else if (parsed.intent === 'BACK') {
      await pressBack();
      ttsMessage = 'Navigated back.';
    } else if (parsed.intent === 'RECENTS') {
      await openRecents();
      ttsMessage = 'Recent apps opened.';
    } else if (parsed.intent === 'NOTIFICATIONS') {
      await openNotifications();
      ttsMessage = 'Notification shade opened.';
    }

    broadcast({ type: 'pipeline_step', step: 4, status: 'success', message: 'Execution completed. Action transmitted.' });
    broadcast({ type: 'pipeline_end', success: true, ttsMessage });
    
    // Auto-update diagnostics after action
    setTimeout(async () => {
      const diagnostics = await getDeviceDiagnostics();
      broadcast({ type: 'diagnostics', data: diagnostics });
    }, 4000);

  } catch (error) {
    broadcast({ type: 'pipeline_step', step: 4, status: 'failed', message: `Execution failed: ${error.message}` });
    broadcast({ type: 'pipeline_end', success: false, error: error.message, ttsMessage: `Pipeline failed. ${error.message}` });
  }
}

/**
 * Initiates 10-second PC Shutdown sequence with abort option
 */
function startPcShutdown() {
  cancelPcShutdown(); // Cancel any existing sequence
  
  shutdownTimeLeft = 10;
  broadcast({ type: 'shutdown_timer_start', seconds: shutdownTimeLeft });
  
  shutdownTimer = setInterval(() => {
    shutdownTimeLeft--;
    broadcast({ type: 'shutdown_timer_tick', seconds: shutdownTimeLeft });
    
    if (shutdownTimeLeft <= 0) {
      clearInterval(shutdownTimer);
      shutdownTimer = null;
      broadcast({ type: 'shutdown_timer_complete' });
      
      // Trigger actual OS shutdown
      console.log('[SYSTEM] Executing Windows PC Shutdown command...');
      exec('shutdown /s /t 0', (err) => {
        if (err) console.error('Shutdown failed', err);
      });
    }
  }, 1000);
}

/**
 * Aborts a running PC shutdown sequence
 */
function cancelPcShutdown() {
  if (shutdownTimer) {
    clearInterval(shutdownTimer);
    shutdownTimer = null;
    
    // Trigger abort command just in case standard shutdown timer got scheduled elsewhere
    exec('shutdown /a', (err) => {
      // Ignore errors (usually happens if no shutdown is in progress)
    });
    
    broadcast({ type: 'shutdown_timer_cancelled' });
    console.log('[SYSTEM] PC Shutdown sequence cancelled by user.');
  }
}

// Boot the server and auto-check ADB platform tools
server.listen(PORT, async () => {
  console.log(`[SERVER] Running at http://localhost:${PORT}`);
  
  // Auto setup ADB in background so server starts immediately
  try {
    await ensureAdbInstalled();
  } catch (e) {
    console.error('Initial ADB Setup error:', e.message);
  }
});
