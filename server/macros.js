import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { assertJsonSchema } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MACROS_FILE = path.join(__dirname, 'macros.json');

export const MACRO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    description: { type: 'string', maxLength: 200 },
    schedule: { type: ['string', 'null'], maxLength: 64 },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string', minLength: 1, maxLength: 200 },
          delay: { type: 'number', minimum: 0, maximum: 30000 }
        },
        required: ['command']
      }
    }
  },
  required: ['name', 'steps']
};

export function validateMacro(body) {
  assertJsonSchema(body ?? {}, MACRO_SCHEMA);
  return body;
}

const DEFAULT_MACROS = [
  {
    id: 'morning-routine',
    name: 'Morning Routine ☀️',
    description: 'WiFi ON → Brightness Max → Open WhatsApp',
    steps: [
      { command: 'wifi on', delay: 2000 },
      { command: 'brightness max', delay: 1000 },
      { command: 'open whatsapp', delay: 2000 }
    ],
    schedule: null,
    createdAt: Date.now()
  },
  {
    id: 'night-mode',
    name: 'Night Mode 🌙',
    description: 'Brightness Low → Mute → WiFi OFF',
    steps: [
      { command: 'brightness low', delay: 1000 },
      { command: 'mute', delay: 1000 },
      { command: 'wifi off', delay: 1000 }
    ],
    schedule: null,
    createdAt: Date.now()
  },
  {
    id: 'quick-photo',
    name: 'Quick Photo 📸',
    description: 'Unlock → Open Camera → Take Photo',
    steps: [
      { command: 'unlock phone', delay: 3000 },
      { command: 'open camera', delay: 3000 },
      { command: 'take photo', delay: 2000 }
    ],
    schedule: null,
    createdAt: Date.now()
  }
];

if (!fs.existsSync(MACROS_FILE)) {
  fs.writeFileSync(MACROS_FILE, JSON.stringify(DEFAULT_MACROS, null, 2));
}

export function getMacros() {
  try {
    const data = fs.readFileSync(MACROS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return DEFAULT_MACROS;
  }
}

export function getMacroById(id) {
  const macros = getMacros();
  return macros.find(m => m.id === id) || null;
}

export function saveMacro(macro) {
  const macros = getMacros();

  const newMacro = {
    id: macro.id || `macro-${Date.now()}`,
    name: macro.name || 'Untitled Macro',
    description: macro.description || '',
    steps: macro.steps || [],
    schedule: macro.schedule || null,
    createdAt: Date.now()
  };

  macros.push(newMacro);
  fs.writeFileSync(MACROS_FILE, JSON.stringify(macros, null, 2));

  return { success: true, macro: newMacro };
}

export function updateMacro(id, updates) {
  const macros = getMacros();
  const index = macros.findIndex(m => m.id === id);

  if (index === -1) {
    return { success: false, error: 'Macro not found' };
  }

  macros[index] = { ...macros[index], ...updates };
  fs.writeFileSync(MACROS_FILE, JSON.stringify(macros, null, 2));

  return { success: true, macro: macros[index] };
}

export function deleteMacro(id) {
  let macros = getMacros();
  const before = macros.length;
  macros = macros.filter(m => m.id !== id);

  if (macros.length === before) {
    return { success: false, error: 'Macro not found' };
  }

  fs.writeFileSync(MACROS_FILE, JSON.stringify(macros, null, 2));
  return { success: true, message: 'Macro deleted' };
}

export async function executeMacro(id, executeCommand, onStep) {
  const macro = getMacroById(id);
  if (!macro) {
    return { success: false, error: 'Macro not found' };
  }

  const results = [];

  for (let i = 0; i < macro.steps.length; i++) {
    const step = macro.steps[i];

    if (onStep) {
      onStep({
        macroId: id,
        macroName: macro.name,
        stepIndex: i,
        totalSteps: macro.steps.length,
        command: step.command,
        status: 'executing'
      });
    }

    try {
      await executeCommand(step.command);
      results.push({ step: i, command: step.command, success: true });

      if (onStep) {
        onStep({
          macroId: id,
          stepIndex: i,
          totalSteps: macro.steps.length,
          command: step.command,
          status: 'success'
        });
      }
    } catch (error) {
      results.push({ step: i, command: step.command, success: false, error: error.message });

      if (onStep) {
        onStep({
          macroId: id,
          stepIndex: i,
          totalSteps: macro.steps.length,
          command: step.command,
          status: 'failed',
          error: error.message
        });
      }
    }

    if (step.delay && i < macro.steps.length - 1) {
      await new Promise(resolve => setTimeout(resolve, step.delay));
    }
  }

  return {
    success: results.every(r => r.success),
    macroName: macro.name,
    results,
    totalSteps: macro.steps.length,
    successCount: results.filter(r => r.success).length
  };
}
