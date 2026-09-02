import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = path.join(__dirname, '.runtime');

function getAdbPath() {
  const localAdb = path.join(__dirname, 'bin', 'platform-tools', 'adb.exe');
  return fs.existsSync(localAdb) ? localAdb : 'adb';
}

function deviceArgs(deviceId) {
  if (deviceId && !/^[A-Za-z0-9.:_-]+$/.test(deviceId)) throw new Error('Invalid device id');
  return deviceId ? ['-s', deviceId] : [];
}

const clampInt = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(20000, n)) : 0;
};

export function scaleToDevice(nx, ny, resolution) {
  const m = String(resolution || '').match(/(\d+)\s*[xX]\s*(\d+)/);
  const w = m ? parseInt(m[1], 10) : 1080;
  const h = m ? parseInt(m[2], 10) : 2400;
  const cx = Math.min(1, Math.max(0, Number(nx) || 0));
  const cy = Math.min(1, Math.max(0, Number(ny) || 0));
  return { x: Math.round(cx * (w - 1)), y: Math.round(cy * (h - 1)) };
}

export async function captureFrame(deviceId) {
  try {
    const { stdout } = await execFileAsync(
      getAdbPath(),
      [...deviceArgs(deviceId), 'exec-out', 'screencap', '-p'],
      { timeout: 10000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }
    );
    if (stdout && stdout.length > 100) return { success: true, buffer: stdout };
    throw new Error('Empty frame');
  } catch (error) {
    try {
      if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      const tmp = path.join(RUNTIME_DIR, 'mirror_frame.png');
      await execFileAsync(getAdbPath(), [...deviceArgs(deviceId), 'shell', 'screencap', '-p', '/sdcard/nx_mirror.png'], { timeout: 10000 });
      await execFileAsync(getAdbPath(), [...deviceArgs(deviceId), 'pull', '/sdcard/nx_mirror.png', tmp], { timeout: 10000 });
      const data = fs.readFileSync(tmp);
      try { fs.unlinkSync(tmp); } catch {  }
      if (data.length > 100) return { success: true, buffer: data };
    } catch {  }
    return { success: false, error: error.message };
  }
}

export async function sendTap(x, y, deviceId) {
  await execFileAsync(getAdbPath(), [...deviceArgs(deviceId), 'shell', 'input', 'tap', String(clampInt(x)), String(clampInt(y))], { timeout: 5000 });
  return { success: true };
}

export async function sendSwipe(x1, y1, x2, y2, duration = 250, deviceId) {
  const d = Math.max(30, Math.min(3000, Math.round(Number(duration) || 250)));
  await execFileAsync(getAdbPath(), [
    ...deviceArgs(deviceId), 'shell', 'input', 'swipe',
    String(clampInt(x1)), String(clampInt(y1)), String(clampInt(x2)), String(clampInt(y2)), String(d)
  ], { timeout: 5000 });
  return { success: true };
}
