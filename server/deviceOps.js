import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = path.join(__dirname, '.runtime');

function adbPath() {
  const local = path.join(__dirname, 'bin', 'platform-tools', 'adb.exe');
  return fs.existsSync(local) ? local : 'adb';
}
function deviceArgs(id) {
  if (id && !/^[A-Za-z0-9.:_-]+$/.test(id)) throw new Error('Invalid device id');
  return id ? ['-s', id] : [];
}
function assertPackage(pkg) {
  if (typeof pkg !== 'string' || !/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(pkg)) {
    throw new Error(`Invalid package name: ${JSON.stringify(pkg)}`);
  }
  return pkg;
}
function ensureRuntime() {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  return RUNTIME_DIR;
}


export async function installApk(localApkPath, deviceId) {
  if (!fs.existsSync(localApkPath)) throw new Error('APK file not found');
  if (!/\.apk$/i.test(localApkPath)) throw new Error('Not an .apk file');
  const { stdout, stderr } = await execFileAsync(
    adbPath(),
    [...deviceArgs(deviceId), 'install', '-r', '-g', localApkPath],
    { timeout: 180000, maxBuffer: 4 * 1024 * 1024 }
  );
  const out = `${stdout || ''}\n${stderr || ''}`;
  if (/Success/i.test(out)) return { success: true, message: 'Installed' };
  const m = out.match(/Failure \[([^\]]+)\]/i);
  throw new Error(m ? m[1] : (out.trim().slice(0, 300) || 'Install failed'));
}

export async function uninstallPackage(pkg, deviceId) {
  assertPackage(pkg);
  const { stdout } = await execFileAsync(adbPath(), [...deviceArgs(deviceId), 'uninstall', pkg], { timeout: 30000 });
  if (/Success/i.test(stdout || '')) return { success: true };
  throw new Error((stdout || '').trim() || 'Uninstall failed');
}

export async function listThirdPartyPackages(deviceId) {
  const { stdout } = await execFileAsync(adbPath(), [...deviceArgs(deviceId), 'shell', 'pm', 'list', 'packages', '-3'], { timeout: 15000 });
  return (stdout || '')
    .split('\n')
    .map((l) => l.trim().replace(/^package:/, ''))
    .filter((l) => /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(l))
    .sort();
}


let recording = null;

export function isRecording() {
  return Boolean(recording);
}

export async function startRecording(deviceId) {
  if (recording) throw new Error('A recording is already in progress');
  const remotePath = `/sdcard/nx_rec_${Date.now()}.mp4`;
  const child = spawn(adbPath(), [...deviceArgs(deviceId), 'shell', 'screenrecord', '--time-limit', '180', remotePath], {
    stdio: 'ignore'
  });
  recording = { remotePath, startedAt: Date.now(), child, deviceId };
  child.on('exit', () => { if (recording && recording.child === child) recording.autoStopped = true; });
  return { success: true, startedAt: recording.startedAt };
}

export async function stopRecording() {
  if (!recording) throw new Error('No recording in progress');
  const { remotePath, deviceId, child } = recording;

  try { await execFileAsync(adbPath(), [...deviceArgs(deviceId), 'shell', 'pkill', '-INT', 'screenrecord'], { timeout: 8000 }); }
  catch {  }
  try { child.kill(); } catch {  }
  await new Promise((r) => setTimeout(r, 1500));

  ensureRuntime();
  const localPath = path.join(RUNTIME_DIR, path.basename(remotePath));
  try {
    await execFileAsync(adbPath(), [...deviceArgs(deviceId), 'pull', remotePath, localPath], { timeout: 60000 });
    await execFileAsync(adbPath(), [...deviceArgs(deviceId), 'shell', 'rm', '-f', remotePath], { timeout: 8000 });
  } catch (e) {
    recording = null;
    throw new Error(`Could not retrieve the recording: ${e.message}`);
  }
  recording = null;

  if (!fs.existsSync(localPath) || fs.statSync(localPath).size < 1024) {
    throw new Error('Recording file is empty');
  }
  return { success: true, path: localPath, fileName: path.basename(localPath), size: fs.statSync(localPath).size };
}
