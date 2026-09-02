import { assertJsonSchema } from '../security.js';
import {
  unlockPhone,
  makeCall,
  sendWhatsAppMessage,
  openWhatsAppChat,
  typeText,
  tapWhatsAppSend,
  tapWhatsAppCall,
  tapWhatsAppVideoCall,
  searchAndOpenWhatsAppContact,
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
  openNotifications,
  getDeviceDiagnostics
} from '../adb.js';

const nameParam = { type: 'string', minLength: 1, maxLength: 80 };
const numberParam = { type: 'string', pattern: '^\\+?[0-9]{3,15}$' };
const messageParam = { type: 'string', minLength: 1, maxLength: 1000 };

export const ACTIONS = {
  SHUTDOWN: {
    destructive: true,
    local: true,
    params: {},
    aiName: 'shutdown_pc',
    description: 'Shut down the Windows PC after a 10-second abortable countdown.',
    summary: () => 'Shut down this PC',
    run: (_p, ctx) => {
      if (typeof ctx.startPcShutdown !== 'function') {
        throw new Error('PC shutdown is not available in this context');
      }
      ctx.startPcShutdown();
      return { started: true };
    },
    tts: () => 'Warning! Initiating computer shutdown sequence. You have 10 seconds to abort.'
  },

  UNLOCK: {
    destructive: true,
    params: {},
    aiName: 'unlock_phone',
    description: 'Unlock the connected Android phone using the stored PIN.',
    summary: () => 'Unlock the phone',
    run: async (_p, ctx) => {
      const result = await unlockPhone(ctx.config?.unlockPin);
      return result || { unlocked: true };
    },
    tts: (p, result) => (result && result.alreadyUnlocked)
      ? 'Phone is already unlocked. No action needed.'
      : 'Phone unlock sequence completed successfully.'
  },
  CALL: {
    destructive: true,
    params: { number: numberParam, name: { type: 'string', maxLength: 80 } },
    required: ['number'],
    aiName: 'make_call',
    description: 'Place a phone call to a number (E.164 or local digits).',
    summary: (p) => `Call ${p.name || p.number}`,
    run: (p) => makeCall(p.number),
    tts: (p) => `Calling ${p.name || 'the number'} now on your device.`
  },
  WHATSAPP: {
    destructive: true,
    params: { number: numberParam, name: { type: 'string', maxLength: 80 }, message: messageParam },
    required: ['number', 'message'],
    aiName: 'send_whatsapp',
    description: 'Open a WhatsApp chat for the number and send the given message.',
    summary: (p) => `WhatsApp "${p.message}" to ${p.name || p.number}`,
    run: (p, ctx) => sendWhatsAppMessage(p.number, p.message, ctx.config?.whatsappCoords),
    tts: (p) => `WhatsApp message sent to ${p.name || 'the contact'}.`
  },
  WHATSAPP_OPEN_CHAT: {
    destructive: false,
    params: { number: { ...numberParam }, name: { type: 'string', maxLength: 80 } },
    aiName: 'open_whatsapp_chat',
    description: 'Open a WhatsApp chat (by number or by in-app contact search) without sending.',
    summary: (p) => `Open WhatsApp chat with ${p.name || p.number}`,
    run: async (p) => {
      if (p.number) return openWhatsAppChat(p.number);
      return searchAndOpenWhatsAppContact(p.name);
    },
    tts: (p) => `WhatsApp chat opened for ${p.name || 'the contact'}.`
  },
  WHATSAPP_TYPE_MESSAGE: {
    destructive: false,
    params: { message: messageParam },
    required: ['message'],
    aiName: 'type_whatsapp_message',
    description: 'Type text into the currently open WhatsApp chat without sending it.',
    summary: (p) => `Type "${p.message}" in WhatsApp`,
    run: (p) => typeText(p.message),
    tts: () => 'Message typed. Say "Vani send message" to send it.'
  },
  WHATSAPP_SEND_MESSAGE: {
    destructive: true,
    params: {},
    aiName: 'send_typed_whatsapp',
    description: 'Tap send on the message already typed in the open WhatsApp chat.',
    summary: () => 'Send the typed WhatsApp message',
    run: () => tapWhatsAppSend(),
    tts: () => 'Message sent on WhatsApp!'
  },
  WHATSAPP_AUDIO_CALL: {
    destructive: true,
    params: { name: { type: 'string', maxLength: 80 } },
    aiName: 'whatsapp_audio_call',
    description: 'Start a WhatsApp voice call with a contact.',
    summary: (p) => `WhatsApp audio call ${p.name || 'the contact'}`,
    run: async (p) => {
      if (p.name) await searchAndOpenWhatsAppContact(p.name);
      return tapWhatsAppCall();
    },
    tts: (p) => `Initiating audio call to ${p.name || 'the contact'}.`
  },
  WHATSAPP_VIDEO_CALL: {
    destructive: true,
    params: { name: { type: 'string', maxLength: 80 } },
    aiName: 'whatsapp_video_call',
    description: 'Start a WhatsApp video call with a contact.',
    summary: (p) => `WhatsApp video call ${p.name || 'the contact'}`,
    run: async (p) => {
      if (p.name) await searchAndOpenWhatsAppContact(p.name);
      return tapWhatsAppVideoCall();
    },
    tts: (p) => `Initiating video call to ${p.name || 'the contact'}.`
  },
  WHATSAPP_ASK_CALL_TYPE: {
    destructive: false,
    readOnly: true,
    params: { name: { type: 'string', maxLength: 80 } },
    run: () => ({ prompt: true }),
    tts: (p) => `Aap ${p.name || 'ko'} audio call karna chahte hain ya video call?`
  },

  VOLUME_UP: {
    destructive: false, params: {}, aiName: 'volume_up',
    description: 'Increase the phone media volume.',
    summary: () => 'Volume up', run: () => volumeUp(), tts: () => 'Volume increased.'
  },
  VOLUME_DOWN: {
    destructive: false, params: {}, aiName: 'volume_down',
    description: 'Decrease the phone media volume.',
    summary: () => 'Volume down', run: () => volumeDown(), tts: () => 'Volume decreased.'
  },
  MUTE: {
    destructive: false, params: {}, aiName: 'mute',
    description: 'Toggle mute on the phone.',
    summary: () => 'Toggle mute', run: () => volumeMute(), tts: () => 'Phone muted.'
  },
  BRIGHTNESS: {
    destructive: false,
    params: { level: { type: 'number', minimum: 0, maximum: 255 } },
    required: ['level'],
    aiName: 'set_brightness',
    description: 'Set screen brightness (0-255).',
    summary: (p) => `Set brightness to ${p.level}`,
    run: (p) => setBrightness(p.level),
    tts: (p) => `Brightness set to ${p.level > 200 ? 'maximum' : p.level < 50 ? 'minimum' : 'adjusted level'}.`
  },
  FLASHLIGHT: {
    destructive: false,
    params: { state: { type: 'boolean' } },
    required: ['state'],
    aiName: 'toggle_flashlight',
    description: 'Turn the phone flashlight on (state=true) or off (state=false).',
    summary: (p) => `Flashlight ${p.state ? 'on' : 'off'}`,
    run: (p) => toggleFlashlight(Boolean(p.state)),
    tts: (p) => `Flashlight turned ${p.state ? 'on' : 'off'}.`
  },
  OPEN_APP: {
    destructive: false,
    params: { appName: { type: 'string', minLength: 1, maxLength: 64 } },
    required: ['appName'],
    aiName: 'open_app',
    description: 'Launch an app on the phone by its display name (e.g. "YouTube").',
    summary: (p) => `Open ${p.appName}`,
    run: (p) => openApp(p.appName),
    tts: (p) => `Opening ${p.appName} on your phone.`
  },
  OPEN_URL: {
    destructive: false,
    params: { url: { type: 'string', minLength: 4, maxLength: 2000 } },
    required: ['url'],
    aiName: 'open_url',
    description: 'Open an http/https URL in the phone browser.',
    summary: (p) => `Open ${p.url}`,
    run: (p) => openUrl(p.url),
    tts: () => 'Opening website in browser.'
  },
  WIFI_ON: {
    destructive: false, params: {}, aiName: 'wifi_on',
    description: 'Turn phone Wi-Fi on.', summary: () => 'Wi-Fi on',
    run: () => toggleWifi(true), tts: () => 'WiFi has been turned on.'
  },
  WIFI_OFF: {
    destructive: false, params: {}, aiName: 'wifi_off',
    description: 'Turn phone Wi-Fi off.', summary: () => 'Wi-Fi off',
    run: () => toggleWifi(false), tts: () => 'WiFi has been turned off.'
  },
  BLUETOOTH_ON: {
    destructive: false, params: {}, aiName: 'bluetooth_on',
    description: 'Turn phone Bluetooth on.', summary: () => 'Bluetooth on',
    run: () => toggleBluetooth(true), tts: () => 'Bluetooth has been enabled.'
  },
  BLUETOOTH_OFF: {
    destructive: false, params: {}, aiName: 'bluetooth_off',
    description: 'Turn phone Bluetooth off.', summary: () => 'Bluetooth off',
    run: () => toggleBluetooth(false), tts: () => 'Bluetooth has been disabled.'
  },
  TAKE_PHOTO: {
    destructive: false, params: {}, aiName: 'take_photo',
    description: 'Open the camera and capture a photo.', summary: () => 'Take a photo',
    run: () => takePhoto(), tts: () => 'Photo captured successfully.'
  },
  MEDIA_PLAY: {
    destructive: false, params: {}, aiName: 'media_play_pause',
    description: 'Toggle media play/pause on the phone.', summary: () => 'Play/pause media',
    run: () => mediaPlayPause(), tts: () => 'Media playback toggled.'
  },
  MEDIA_NEXT: {
    destructive: false, params: {}, aiName: 'media_next',
    description: 'Skip to the next track.', summary: () => 'Next track',
    run: () => mediaNext(), tts: () => 'Skipped to next track.'
  },
  MEDIA_PREV: {
    destructive: false, params: {}, aiName: 'media_previous',
    description: 'Go to the previous track.', summary: () => 'Previous track',
    run: () => mediaPrevious(), tts: () => 'Playing previous track.'
  },
  HOME: {
    destructive: false, params: {}, aiName: 'press_home',
    description: 'Press the Home button.', summary: () => 'Home',
    run: () => pressHome(), tts: () => 'Home screen activated.'
  },
  BACK: {
    destructive: false, params: {}, aiName: 'press_back',
    description: 'Press the Back button.', summary: () => 'Back',
    run: () => pressBack(), tts: () => 'Navigated back.'
  },
  RECENTS: {
    destructive: false, params: {}, aiName: 'open_recents',
    description: 'Open the recent apps switcher.', summary: () => 'Recent apps',
    run: () => openRecents(), tts: () => 'Recent apps opened.'
  },
  NOTIFICATIONS: {
    destructive: false, params: {}, aiName: 'open_notifications',
    description: 'Open the notification shade.', summary: () => 'Notifications',
    run: () => openNotifications(), tts: () => 'Notification shade opened.'
  },
  GET_DIAGNOSTICS: {
    destructive: false,
    readOnly: true,
    params: {},
    aiName: 'get_diagnostics',
    description: 'Read device status: connection, model, battery level/temperature, resolution, Android version.',
    summary: () => 'Read device diagnostics',
    run: () => getDeviceDiagnostics(),
    tts: () => ''
  },

  RUN_MACRO: {
    destructive: false,
    params: { name: { type: 'string', minLength: 1, maxLength: 80 } },
    required: ['name'],
    aiName: 'run_macro',
    description: 'Run a saved automation macro by its name (e.g. "Night Mode", "Morning Routine").',
    summary: (p) => `Run macro "${p.name}"`,
    run: async (p, ctx) => {
      if (typeof ctx.runMacro !== 'function') throw new Error('Macros are not available here');
      return ctx.runMacro(p.name);
    },
    tts: (p) => `Running the ${p.name} macro.`
  },

  GOD_MODE: {
    destructive: true,
    params: {},
    summary: () => 'Run the GOD_MODE override sequence',
    run: async () => {
      await toggleWifi(true);
      await setBrightness(255);
      await toggleFlashlight(true);
      await openApp('camera');
      await takePhoto();
      await mediaPlayPause();
      return { sequence: 'god_mode', done: true };
    },
    tts: () => 'God mode sequence executed. System override complete.'
  },
  CANCEL: {
    destructive: false,
    readOnly: true,
    params: {},
    summary: () => 'Cancel',
    run: () => ({ cancelled: true }),
    tts: () => 'Okay, maine cancel kar diya.'
  }
};

export function getAction(name) {
  return ACTIONS[name];
}

export function listActionNames() {
  return Object.keys(ACTIONS);
}

export function aiToolNameFor(intent) {
  return ACTIONS[intent]?.aiName;
}
export function intentForAiTool(toolName) {
  for (const [intent, action] of Object.entries(ACTIONS)) {
    if (action.aiName === toolName) return intent;
  }
  return undefined;
}

export function listAiTools() {
  const tools = [];
  for (const action of Object.values(ACTIONS)) {
    if (!action.aiName) continue;
    const properties = action.params || {};
    tools.push({
      name: action.aiName,
      description: action.description || action.summary?.({}) || action.aiName,
      strict: true,
      input_schema: {
        type: 'object',
        properties,
        required: Array.isArray(action.required) ? action.required : [],
        additionalProperties: false
      }
    });
  }
  return tools;
}

export async function runAction(name, params = {}, ctx = {}) {
  const action = ACTIONS[name];
  if (!action) {
    throw new Error(`Unknown action: ${name}`);
  }

  assertJsonSchema(params ?? {}, {
    type: 'object',
    properties: action.params || {},
    additionalProperties: true
  });

  if (action.destructive && ctx.requireConfirm && typeof ctx.confirm === 'function') {
    const summary = action.summary ? action.summary(params) : name;
    const approved = await ctx.confirm(summary);
    if (!approved) {
      return { ok: false, skipped: true, intent: name, reason: 'declined' };
    }
  }

  const result = await action.run(params, ctx);
  const tts = action.tts ? action.tts(params, result) : undefined;
  return { ok: true, intent: name, result, tts };
}
