import { getDeviceDiagnostics } from './adb.js';

const DEFAULT_TTL_MS = 1500;

let cache = { at: 0, value: null };
let inFlight = null;

export async function getDiagnostics({ maxAgeMs = DEFAULT_TTL_MS } = {}) {
  const now = Date.now();
  if (cache.value && now - cache.at < maxAgeMs) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const value = await getDeviceDiagnostics();
      cache = { at: Date.now(), value };
      return value;
    } catch (error) {
      const value = { connected: false, error: error.message };
      cache = { at: Date.now(), value };
      return value;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function currentDeviceKey() {
  const d = await getDiagnostics();
  return d && d.connected && d.deviceId ? String(d.deviceId) : 'no-device';
}

export function invalidateDiagnostics() {
  cache = { at: 0, value: null };
}
