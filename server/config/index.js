import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');

export const CONFIG_FILE = path.join(SERVER_DIR, 'config.json');
export const CONTACTS_FILE = path.join(SERVER_DIR, 'contacts.json');
export const MACROS_FILE = path.join(SERVER_DIR, 'macros.json');
export const RUNTIME_DIR = path.join(SERVER_DIR, '.runtime');

export const DEFAULT_CONFIG = Object.freeze({
  unlockPin: '',
  autoUnlock: false,
  whatsappCoords: { x: 0.91, y: 0.55 }
});

export const CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    unlockPin: { type: 'string', pattern: '^[0-9]{0,16}$' },
    autoUnlock: { type: 'boolean' },
    whatsappCoords: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 }
      },
      required: ['x', 'y']
    }
  }
};

export const CONTACTS_SCHEMA = {
  type: 'array',
  maxItems: 2000,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', maxLength: 64 },
      name: { type: 'string', minLength: 1, maxLength: 80 },
      number: { type: 'string', pattern: '^\\+?[0-9]{6,15}$' }
    },
    required: ['name', 'number']
  }
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function readConfig() {
  const raw = readJson(CONFIG_FILE, {});
  return {
    unlockPin: typeof raw.unlockPin === 'string' ? raw.unlockPin : '',
    autoUnlock: raw.autoUnlock === true,
    whatsappCoords: {
      x: Number(raw?.whatsappCoords?.x ?? DEFAULT_CONFIG.whatsappCoords.x),
      y: Number(raw?.whatsappCoords?.y ?? DEFAULT_CONFIG.whatsappCoords.y)
    }
  };
}

export function writeConfig(next) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
}

export function readPublicConfig() {
  const cfg = readConfig();
  return {
    whatsappCoords: cfg.whatsappCoords,
    unlockPin: '',
    hasUnlockPin: Boolean(cfg.unlockPin),
    autoUnlock: cfg.autoUnlock
  };
}

export function mergeConfig(body) {
  const current = readConfig();
  const pin = typeof body.unlockPin === 'string' && body.unlockPin.length
    ? body.unlockPin
    : current.unlockPin;
  return {
    unlockPin: pin,
    autoUnlock: typeof body.autoUnlock === 'boolean' ? body.autoUnlock : current.autoUnlock,
    whatsappCoords: body.whatsappCoords ?? current.whatsappCoords
  };
}

export function readContacts() {
  const list = readJson(CONTACTS_FILE, []);
  return Array.isArray(list) ? list : [];
}

export function writeContacts(list) {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(list, null, 2));
}


export function getAuthToken(env = process.env) {
  const v = env.NEXUSFLOW_AUTH_TOKEN;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function getAnthropicKey(env = process.env) {
  const v = env.ANTHROPIC_API_KEY;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function getAllowedOrigins(env = process.env, port) {
  const raw = env.NEXUSFLOW_ALLOWED_ORIGINS;
  if (raw && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

export function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  return RUNTIME_DIR;
}
