import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import multer from 'multer';

import {
  ensureAdbInstalled,
  captureScreen,
  setLogCallback,
  syncPhoneContacts,
  enableWirelessAdb,
  disableWirelessAdb,
  isPhoneLocked,
  unlockPhone
} from './adb.js';
import { getDiagnostics, currentDeviceKey, invalidateDiagnostics } from './deviceState.js';
import { JobQueue, JOB_STATES } from './jobQueue.js';
import { configurePipeline, runCommandText, runAssistantText } from './pipeline.js';
import { isAiEnabled, AI_MODEL } from './ai/client.js';
import {
  assertJsonSchema,
  sendSafeError,
  createHttpAccessMiddleware,
  createRateLimiter,
  authorizeWebSocketUpgrade,
  isRequestFromLoopback
} from './security.js';
import {
  CONFIG_SCHEMA,
  CONTACTS_SCHEMA,
  readPublicConfig,
  writeConfig,
  mergeConfig,
  readContacts,
  writeContacts,
  readConfig,
  getAuthToken,
  getAllowedOrigins,
  RUNTIME_DIR,
  ensureRuntimeDir
} from './config/index.js';
import {
  listPhoneFiles,
  pullFileFromPhone,
  pushFileToPhone,
  deletePhoneFile,
  createPhoneDirectory,
  getStorageInfo
} from './fileTransfer.js';
import {
  getMacros,
  getMacroById,
  saveMacro,
  updateMacro,
  deleteMacro,
  executeMacro,
  validateMacro
} from './macros.js';
import { captureFrame, sendTap, sendSwipe, scaleToDevice } from './screenMirror.js';
import {
  installApk,
  uninstallPackage,
  listThirdPartyPackages,
  startRecording,
  stopRecording,
  isRecording
} from './deviceOps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
  console.log('[CONFIG] Loaded .env');
} catch {  }

const PORT = process.env.PORT || 3000;

const CONTACTS_FILE = path.join(__dirname, 'contacts.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

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
app.use(express.json({ limit: '256kb' }));

const AUTH_TOKEN = getAuthToken();
const ALLOWED_ORIGINS = getAllowedOrigins(process.env, PORT);
console.log(AUTH_TOKEN
  ? '[SECURITY] Token auth ENABLED (NEXUSFLOW_AUTH_TOKEN set).'
  : '[SECURITY] Local-only mode: remote clients are refused. Set NEXUSFLOW_AUTH_TOKEN for LAN access.');

const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 300 });
const screenLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });
const mirrorLimiter = createRateLimiter({ windowMs: 60_000, max: 800 });
const inputLimiter = createRateLimiter({ windowMs: 60_000, max: 900 });
app.use('/api', apiLimiter.middleware);

app.post('/api/auth/login', express.json({ limit: '4kb' }), (req, res) => {
  if (!AUTH_TOKEN) return res.json({ ok: true, mode: 'local-only' });
  const supplied = typeof req.body?.token === 'string' ? req.body.token : '';
  const ok = supplied.length === AUTH_TOKEN.length && timingSafeStrEqual(supplied, AUTH_TOKEN);
  if (!ok) return res.status(401).json({ ok: false, error: 'Invalid token' });
  return res.json({ ok: true, mode: 'token' });
});
app.get('/api/auth/status', (req, res) => {
  res.json({ authRequired: Boolean(AUTH_TOKEN) });
});

const BOOT_TIME = Date.now();
app.get('/api/health', async (req, res) => {
  let device = null;
  try {
    const d = await getDiagnostics();
    device = d.connected ? { model: d.model, android: d.androidVersion, battery: d.batteryLevel } : null;
  } catch {  }
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - BOOT_TIME) / 1000),
    authRequired: Boolean(AUTH_TOKEN),
    aiEnabled: isAiEnabled(),
    deviceConnected: Boolean(device),
    device
  });
});

app.use('/api', createHttpAccessMiddleware({ authToken: AUTH_TOKEN }));

app.use(express.static(path.join(__dirname, '../public')));

let shutdownTimer = null;
let shutdownTimeLeft = 10;

function timingSafeStrEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

app.get('/api/contacts', (req, res) => {
  try {
    res.json(readContacts());
  } catch (error) {
    res.status(500).json({ error: 'Failed to read contacts' });
  }
});

app.post('/api/contacts', (req, res) => {
  try {
    assertJsonSchema(req.body ?? [], CONTACTS_SCHEMA);
    writeContacts(req.body);
    res.json({ success: true });
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.delete('/api/contacts', (req, res) => {
  try {
    writeContacts([]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear contacts' });
  }
});

app.get('/api/config', (req, res) => {
  try {
    res.json(readPublicConfig());
  } catch (error) {
    res.status(500).json({ error: 'Failed to read config' });
  }
});

app.post('/api/config', (req, res) => {
  try {
    assertJsonSchema(req.body ?? {}, CONFIG_SCHEMA);
    writeConfig(mergeConfig(req.body ?? {}));
    res.json({ success: true });
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.get('/api/diagnostics', async (req, res) => {
  try {
    const diagnostics = await getDiagnostics();
    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const SCREENSHOT_PATH = path.join(RUNTIME_DIR, 'screen.png');
app.get('/api/screenshot', async (req, res) => {
  try {
    ensureRuntimeDir();
    await captureScreen(SCREENSHOT_PATH);
    res.json({ success: true, url: '/api/screen/current?t=' + Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/screen/current', screenLimiter.middleware, (req, res) => {
  if (!fs.existsSync(SCREENSHOT_PATH)) {
    return res.status(404).json({ error: 'No screenshot captured yet' });
  }
  res.set('Cache-Control', 'no-store');
  res.type('png').sendFile(SCREENSHOT_PATH);
});

app.get('/api/mirror/frame', mirrorLimiter.middleware, async (req, res) => {
  const result = await captureFrame();
  if (!result.success) return res.status(502).json({ error: result.error || 'capture failed' });
  res.set('Cache-Control', 'no-store');
  res.type('png').send(result.buffer);
});

app.post('/api/mirror/tap', inputLimiter.middleware, async (req, res) => {
  try {
    const diag = await getDiagnostics();
    if (!diag.connected) return res.status(409).json({ error: 'No device connected' });
    const { x, y } = scaleToDevice(req.body?.x, req.body?.y, diag.resolution);
    await sendTap(x, y, diag.deviceId);
    res.json({ success: true, x, y });
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.post('/api/mirror/swipe', inputLimiter.middleware, async (req, res) => {
  try {
    const diag = await getDiagnostics();
    if (!diag.connected) return res.status(409).json({ error: 'No device connected' });
    const a = scaleToDevice(req.body?.x1, req.body?.y1, diag.resolution);
    const b = scaleToDevice(req.body?.x2, req.body?.y2, diag.resolution);
    await sendSwipe(a.x, a.y, b.x, b.y, req.body?.duration, diag.deviceId);
    res.json({ success: true });
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.post('/api/unlock', async (req, res) => {
  try {
    const cfg = readConfig();
    const diag = await getDiagnostics();
    if (!diag.connected) return res.status(409).json({ error: 'No device connected' });
    const result = await new Promise((resolve, reject) => {
      jobs.enqueue(diag.deviceId, async () => {
        try { resolve(await unlockPhone(cfg.unlockPin)); } catch (e) { reject(e); }
      }, { kind: 'unlock' });
    });
    invalidateDiagnostics();
    res.json({ success: true, ...result });
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.post('/api/sync-contacts', async (req, res) => {
  try {
    const phoneContacts = await syncPhoneContacts();

    let existing = [];
    try {
      existing = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    } catch (e) {  }

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

const aiLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

app.get('/api/ai/status', (req, res) => {
  res.json({ enabled: isAiEnabled(), model: isAiEnabled() ? AI_MODEL : null });
});

app.post('/api/ai/chat', aiLimiter.middleware, async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    if (!message.trim()) return res.status(400).json({ error: 'message is required' });
    if (message.length > 4000) return res.status(400).json({ error: 'message too long' });
    const session = { aiHistory: [], requireConfirm: true, confirm: async () => false };
    const result = await runAssistantText(message, session);
    res.json({ reply: result.reply, ok: result.ok, actionsTaken: result.actionsTaken || [] });
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.get('/api/jobs', (req, res) => {
  res.json({ jobs: jobs.list({ limit: 100 }) });
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const cancelled = jobs.cancel(req.params.id);
  res.json({ success: cancelled });
});


const uploadsDir = path.join(__dirname, '../uploads');
const downloadsDir = path.join(__dirname, '../downloads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 500 * 1024 * 1024 }
});

app.get('/api/files/list', async (req, res) => {
  try {
    const phonePath = req.query.path || '/sdcard';
    const result = await listPhoneFiles(phonePath);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/files/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const phoneDest = req.body.destination || '/sdcard/Download';

    const safeName = path.basename(String(req.file.originalname || 'upload'))
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(0, 200) || 'upload';
    const renamedPath = path.join(uploadsDir, safeName);
    if (path.dirname(path.resolve(renamedPath)) !== path.resolve(uploadsDir)) {
      throw new Error('Rejected upload path');
    }
    fs.renameSync(req.file.path, renamedPath);

    const result = await pushFileToPhone(renamedPath, phoneDest);

    try { fs.unlinkSync(renamedPath); } catch (e) {  }

    broadcast({ type: 'file_transfer_complete', action: 'upload', result });

    res.json(result);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {  }
    }
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files/download', async (req, res) => {
  try {
    const phonePath = req.query.path;
    if (!phonePath) {
      return res.status(400).json({ error: 'No file path specified' });
    }

    const result = await pullFileFromPhone(phonePath, downloadsDir);

    if (result.success) {
      res.download(result.localPath, result.fileName, (err) => {
        try { fs.unlinkSync(result.localPath); } catch (e) {  }
      });
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/files/delete', async (req, res) => {
  try {
    const { path: filePath, isDirectory } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'No file path specified' });
    }

    const result = await deletePhoneFile(filePath, isDirectory);
    broadcast({ type: 'file_transfer_complete', action: 'delete', result });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/files/mkdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ error: 'No directory path specified' });
    }

    const result = await createPhoneDirectory(dirPath);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files/storage', async (req, res) => {
  try {
    const result = await getStorageInfo();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/apps/install', upload.single('apk'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No APK provided' });
  const tmp = path.join(uploadsDir, `install_${Date.now()}.apk`);
  try {
    fs.renameSync(req.file.path, tmp);
    const diag = await getDiagnostics();
    if (!diag.connected) throw new Error('No device connected');
    const result = await installApk(tmp, diag.deviceId);
    res.json(result);
  } catch (error) {
    sendSafeError(res, error);
  } finally {
    try { fs.unlinkSync(tmp); } catch {  }
    if (req.file && fs.existsSync(req.file.path)) { try { fs.unlinkSync(req.file.path); } catch {  } }
  }
});

app.get('/api/apps/list', async (req, res) => {
  try {
    const diag = await getDiagnostics();
    if (!diag.connected) return res.status(409).json({ error: 'No device connected' });
    res.json({ packages: await listThirdPartyPackages(diag.deviceId) });
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.delete('/api/apps/:pkg', async (req, res) => {
  try {
    const diag = await getDiagnostics();
    if (!diag.connected) return res.status(409).json({ error: 'No device connected' });
    res.json(await uninstallPackage(req.params.pkg, diag.deviceId));
  } catch (error) {
    sendSafeError(res, error);
  }
});

let lastRecording = null;

app.get('/api/record/status', (req, res) => res.json({ recording: isRecording() }));

app.post('/api/record/start', async (req, res) => {
  try {
    const diag = await getDiagnostics();
    if (!diag.connected) return res.status(409).json({ error: 'No device connected' });
    res.json(await startRecording(diag.deviceId));
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.post('/api/record/stop', async (req, res) => {
  try {
    const result = await stopRecording();
    lastRecording = { path: result.path, fileName: result.fileName };
    res.json({ success: true, fileName: result.fileName, size: result.size, url: '/api/record/latest?t=' + Date.now() });
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.get('/api/record/latest', screenLimiter.middleware, (req, res) => {
  if (!lastRecording || !fs.existsSync(lastRecording.path)) {
    return res.status(404).json({ error: 'No recording available' });
  }
  res.download(lastRecording.path, lastRecording.fileName);
});


const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const result = authorizeWebSocketUpgrade(req, {
    authToken: AUTH_TOKEN,
    allowedOrigins: ALLOWED_ORIGINS,
    tokenParam: 'token'
  });
  if (!result.ok) {
    socket.write(`HTTP/1.1 ${result.statusCode} ${result.code}\r\n\r\n`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws._req = req;
    ws._loopback = isRequestFromLoopback(req);
    wss.emit('connection', ws, req);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

setLogCallback((logObj) => {
  broadcast({ type: 'adb_log', log: logObj });
});

const jobs = new JobQueue({
  onEvent: (event) => broadcast({ type: 'job_event', event })
});

async function enqueueCommand(text, session, opts = {}) {
  const key = await currentDeviceKey();
  return jobs.enqueue(
    key,
    () => runCommandText(text, session, opts),
    { kind: 'command', text, source: opts.source || 'text' }
  );
}

const MACRO_SESSION = { nlpContext: {}, requireConfirm: false };

async function enqueueMacro(id) {
  const key = await currentDeviceKey();
  return jobs.enqueue(key, () => executeMacro(
    id,
    (command) => runCommandText(command, MACRO_SESSION),
    (step) => broadcast({ type: 'macro_step', step })
  ), { kind: 'macro', id });
}

app.get('/api/macros', (req, res) => {
  res.json({ macros: getMacros() });
});

app.post('/api/macros', (req, res) => {
  try {
    validateMacro(req.body);
    res.json(saveMacro(req.body));
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.put('/api/macros/:id', (req, res) => {
  try {
    const { id: _ignored, ...updates } = req.body || {};
    validateMacro(updates);
    const result = updateMacro(req.params.id, updates);
    res.status(result.success ? 200 : 404).json(result);
  } catch (error) {
    sendSafeError(res, error);
  }
});

app.delete('/api/macros/:id', (req, res) => {
  const result = deleteMacro(req.params.id);
  res.status(result.success ? 200 : 404).json(result);
});

app.post('/api/macros/:id/run', async (req, res) => {
  const macro = getMacroById(req.params.id);
  if (!macro) return res.status(404).json({ success: false, error: 'Macro not found' });
  const snapshot = await enqueueMacro(req.params.id);
  res.json({ success: true, job: snapshot, macro: macro.name });
});

wss.on('connection', (ws) => {
  const loopback = ws._loopback !== false;
  console.log(`[WS] Client connected (${loopback ? 'loopback' : 'remote'})`);

  const pendingConfirms = new Map();

  function confirm(summary) {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingConfirms.delete(id);
        resolve(false);
      }, 45_000);
      pendingConfirms.set(id, (approved) => {
        clearTimeout(timer);
        pendingConfirms.delete(id);
        resolve(Boolean(approved));
      });
      ws.send(JSON.stringify({ type: 'confirm_request', id, summary }));
    });
  }

  ws.session = {
    id: randomUUID(),
    nlpContext: { lastContact: null, pendingAction: null },
    requireConfirm: !loopback,
    confirm
  };

  getDiagnostics().then(diagnostics => {
    ws.send(JSON.stringify({ type: 'diagnostics', data: diagnostics }));
  });

  ws.on('message', async (messageData) => {
    try {
      const payload = JSON.parse(messageData);

      if (payload.type === 'execute_command') {
        const alternatives = Array.isArray(payload.alternatives)
          ? payload.alternatives.filter((s) => typeof s === 'string').slice(0, 5)
          : [];
        const snapshot = await enqueueCommand(String(payload.command || ''), ws.session, {
          alternatives,
          source: payload.source === 'voice' ? 'voice' : 'text'
        });
        ws.send(JSON.stringify({ type: 'command_queued', job: snapshot }));
      }

      else if (payload.type === 'ai_chat') {
        const message = String(payload.message || '').slice(0, 4000);
        if (message.trim()) {
          const key = await currentDeviceKey();
          jobs.enqueue(key, () => runAssistantText(message, ws.session), { kind: 'ai_chat' });
        }
      }

      else if (payload.type === 'confirm_action') {
        const resolver = pendingConfirms.get(String(payload.id || ''));
        if (resolver) resolver(payload.approved === true);
      }

      else if (payload.type === 'cancel_shutdown') {
        cancelPcShutdown();
      }

      else if (payload.type === 'cancel_job') {
        jobs.cancel(String(payload.jobId || ''));
      }

      else if (payload.type === 'request_diagnostics') {
        const diagnostics = await getDiagnostics();
        ws.send(JSON.stringify({ type: 'diagnostics', data: diagnostics }));
      }
    } catch (err) {
      console.error('[WS ERROR]', err.message);
    }
  });

  ws.on('close', () => {
    for (const resolver of pendingConfirms.values()) resolver(false);
    pendingConfirms.clear();
    console.log('[WS] Client disconnected');
  });
});

function startPcShutdown() {
  cancelPcShutdown();

  shutdownTimeLeft = 10;
  broadcast({ type: 'shutdown_timer_start', seconds: shutdownTimeLeft });

  shutdownTimer = setInterval(() => {
    shutdownTimeLeft--;
    broadcast({ type: 'shutdown_timer_tick', seconds: shutdownTimeLeft });

    if (shutdownTimeLeft <= 0) {
      clearInterval(shutdownTimer);
      shutdownTimer = null;
      broadcast({ type: 'shutdown_timer_complete' });

      console.log('[SYSTEM] Executing Windows PC Shutdown command...');
      exec('shutdown /s /t 0', (err) => {
        if (err) console.error('Shutdown failed', err);
      });
    }
  }, 1000);
}

function cancelPcShutdown() {
  if (shutdownTimer) {
    clearInterval(shutdownTimer);
    shutdownTimer = null;

    exec('shutdown /a', (err) => {
    });

    broadcast({ type: 'shutdown_timer_cancelled' });
    console.log('[SYSTEM] PC Shutdown sequence cancelled by user.');
  }
}

async function runMacroByName(name) {
  const want = String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const all = getMacros();
  const match = all.find((m) => {
    const n = String(m.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    return n === want || n.includes(want) || want.includes(n);
  });
  if (!match) throw new Error(`No macro named "${name}"`);
  await enqueueMacro(match.id);
  return { started: match.name };
}

configurePipeline({ broadcast, startPcShutdown, runMacroByName });

let autoUnlockDeviceId = null;
let autoUnlockAttempts = 0;
const AUTO_UNLOCK_MAX_ATTEMPTS = 3;

async function maybeAutoUnlock(diagnostics) {
  if (!diagnostics || !diagnostics.connected || !diagnostics.deviceId) {
    autoUnlockDeviceId = null;
    autoUnlockAttempts = 0;
    return;
  }
  if (diagnostics.deviceId !== autoUnlockDeviceId) {
    autoUnlockDeviceId = diagnostics.deviceId;
    autoUnlockAttempts = 0;
  }
  if (autoUnlockAttempts >= AUTO_UNLOCK_MAX_ATTEMPTS) return;

  const cfg = readConfig();
  if (!cfg.autoUnlock || !cfg.unlockPin) return;

  let locked;
  try {
    locked = await isPhoneLocked(diagnostics.deviceId);
  } catch { return; }
  if (!locked) {
    if (autoUnlockAttempts === 0) {
      broadcast({ type: 'adb_log', log: { type: 'adb-debug', message: '[AUTO-UNLOCK] Device already unlocked - nothing to do.' } });
    }
    autoUnlockAttempts = AUTO_UNLOCK_MAX_ATTEMPTS;
    return;
  }

  autoUnlockAttempts += 1;
  broadcast({ type: 'adb_log', log: { type: 'adb-info', message: `[AUTO-UNLOCK] Device locked - unlocking (attempt ${autoUnlockAttempts})...` } });
  jobs.enqueue(diagnostics.deviceId, async () => {
    try {
      await unlockPhone(cfg.unlockPin);
      invalidateDiagnostics();
      broadcast({ type: 'adb_log', log: { type: 'adb-success', message: '[AUTO-UNLOCK] Phone unlocked.' } });
      broadcast({ type: 'system_alert', message: 'Phone auto-unlocked on USB connect.' });
      autoUnlockAttempts = AUTO_UNLOCK_MAX_ATTEMPTS;
    } catch (e) {
      broadcast({ type: 'adb_log', log: { type: 'adb-warning', message: `[AUTO-UNLOCK] Failed: ${e.message}` } });
    }
  }, { kind: 'auto_unlock' });
}

let lastAlertTime = 0;
const diagnosticsPoll = setInterval(async () => {
  try {
    invalidateDiagnostics();
    const diagnostics = await getDiagnostics();
    broadcast({ type: 'diagnostics', data: diagnostics });

    maybeAutoUnlock(diagnostics).catch(() => {});

    if (diagnostics && diagnostics.connected) {
      const isCritical = diagnostics.batteryLevel <= 15 || (diagnostics.batteryTemp && diagnostics.batteryTemp >= 40);
      const now = Date.now();
      if (isCritical && (now - lastAlertTime > 5 * 60 * 1000)) {
        lastAlertTime = now;
        broadcast({
          type: 'system_alert',
          message: 'Warning: Device battery is low or temperature is critical.',
          ttsMessage: 'Warning! Device temperature or battery level is critical. Please check your device.'
        });
      }
    }
  } catch (e) {
  }
}, 5000);

server.listen(PORT, () => {
  console.log(`\n[SERVER] NexusFlow v7.5 Pro-Max Running at http://localhost:${PORT}`);
  ensureAdbInstalled().catch(console.error);

  if (process.env.NEXUSFLOW_NO_BROWSER === '1' || process.platform !== 'win32') return;
  exec(`start chrome http://localhost:${PORT}`, (err) => {
    if (err) {
      console.log('[SERVER] Notice: Could not auto-launch Chrome. Please open it manually if needed.');
    } else {
      console.log('[SERVER] Auto-launched Google Chrome.');
    }
  });
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[SERVER] ${signal} received - shutting down gracefully...`);
  clearInterval(diagnosticsPoll);
  cancelPcShutdown();

  const deadline = Date.now() + 4000;
  const finish = () => {
    for (const ws of wss.clients) { try { ws.close(1001, 'server shutting down'); } catch {  } }
    server.close(() => { console.log('[SERVER] Closed. Bye.'); process.exit(0); });
    setTimeout(() => process.exit(0), 1500).unref();
  };
  const wait = () => {
    const busy = jobs.list({ states: [JOB_STATES.RUNNING] }).length;
    if (busy === 0 || Date.now() > deadline) return finish();
    console.log(`[SERVER] waiting for ${busy} running job(s)...`);
    setTimeout(wait, 300);
  };
  wait();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
