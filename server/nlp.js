const globalNlpContext = {
  lastContact: null,
  pendingAction: null
};

export function parseCommand(text, contacts = [], context) {
  const nlpContext = context && typeof context === 'object' ? context : globalNlpContext;
  if (!('lastContact' in nlpContext)) nlpContext.lastContact = null;
  if (!('pendingAction' in nlpContext)) nlpContext.pendingAction = null;

  let normalized = text.toLowerCase().trim();

  const wakeWordRegex = /^(vani|wani|वाणी|वानी|vaney|wanee|vany|bany)\b/i;
  const wakeWordMatch = normalized.match(wakeWordRegex);
  let wakeWordDetected = false;
  let processedText = normalized;

  if (wakeWordMatch) {
    wakeWordDetected = true;
    processedText = normalized.replace(wakeWordRegex, '').trim().replace(/^[.,\/#!$%\^&\*;:{}=\-_`~()]+/g, "").trim();
    logDebug(`Wake word 'Vani' detected! Processing command: "${processedText}"`);
  }

  const cleanedText = processedText.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");

  logDebug(`Normalizing input command: "${text}" -> "${cleanedText}" (Wake word detected: ${wakeWordDetected})`);

  const wakeWordPrefix = wakeWordDetected ? 'Vani Activated ➔ ' : '';

  if (nlpContext.pendingAction && nlpContext.pendingAction.type === 'WHATSAPP_CALL') {
    if (cleanedText.includes('video')) {
       const name = nlpContext.pendingAction.name;
       nlpContext.pendingAction = null;
       return {
         intent: 'WHATSAPP_VIDEO_CALL',
         pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_VIDEO_CALL)', 'ADB Video Call Tap'],
         details: { name }
       };
    } else if (cleanedText.includes('audio') || cleanedText.includes('voice')) {
       const name = nlpContext.pendingAction.name;
       nlpContext.pendingAction = null;
       return {
         intent: 'WHATSAPP_AUDIO_CALL',
         pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_AUDIO_CALL)', 'ADB Audio Call Tap'],
         details: { name }
       };
    } else if (cleanedText.includes('cancel') || cleanedText.includes('rehnedo') || cleanedText.includes('chhod do')) {
       nlpContext.pendingAction = null;
       return { intent: 'CANCEL', pipeline: ['Input Received', 'Cancelled Context'], details: {} };
    }
  }

  const isInformationalQuery = /\b(how\s+(do|to|can|would|should|does)|what\s+(is|are|does|do)|can\s+you\s+(explain|tell)|explain\s+how|is\s+it\s+possible|kaise\s+(karu|karte|hota|hoti))\b/i.test(cleanedText);
  const isNegatedRequest = /\bdon['’]?t\b|\bdo\s+not\b|\bnever\b|\bmat\s+kar|\bnahi\s+kar|\bmat\s+karna\b/i.test(cleanedText);
  const blockDestructive = isInformationalQuery || isNegatedRequest;
  if (blockDestructive) {
    logDebug(`Safety guard: informational/negated phrasing detected -> destructive intents suppressed`);
  }

  if (/^(cancel|cancel it|cancel karo|rehne do|rehnedo|chhod do|chhodo|ruko|abort|stop it|nevermind|never mind)$/i.test(cleanedText.trim())) {
    nlpContext.pendingAction = null;
    return {
      intent: 'CANCEL',
      pipeline: ['Input Received', wakeWordPrefix + 'NLP (CANCEL)'],
      details: { wakeWordDetected }
    };
  }

  const shutdownKeywords = [
    'shutdown pc', 'shutdown computer', 'turn off pc', 'turn off computer',
    'power off pc', 'pc shutdown', 'pc band', 'computer band', 'system band',
    'computer shutdown', 'laptop shutdown', 'shutdown my pc', 'pc ko shutdown'
  ];
  if (!blockDestructive && shutdownKeywords.some(keyword => cleanedText.includes(keyword))) {
    return {
      intent: 'SHUTDOWN',
      pipeline: ['Input Received', wakeWordPrefix + 'NLP Intent Extracted (SHUTDOWN)', 'OS Trigger compiled', 'Shutdown Initiated'],
      details: { target: 'PC', wakeWordDetected }
    };
  }

  const unlockKeywords = [
    'unlock phone', 'unlock mobile', 'unlock android', 'bypass lock', 'open lock',
    'phone unlock', 'mobile unlock', 'lock kholo', 'unlock kar', 'screen unlock',
    'password unlock'
  ];
  if (!blockDestructive && unlockKeywords.some(keyword => cleanedText.includes(keyword))) {
    return {
      intent: 'UNLOCK',
      pipeline: ['Input Received', wakeWordPrefix + 'NLP Intent Extracted (UNLOCK)', 'ADB Check', 'ADB Swipe Command', 'PIN Submission'],
      details: { target: 'Phone', wakeWordDetected }
    };
  }


  if (['volume up', 'volume badha', 'volume badhao', 'awaz badha', 'sound up', 'loud kar', 'volume increase'].some(k => cleanedText.includes(k))) {
    return { intent: 'VOLUME_UP', pipeline: ['Input Received', wakeWordPrefix + 'NLP (VOLUME_UP)', 'ADB Keyevent'], details: { target: 'Phone', wakeWordDetected } };
  }
  if (['volume down', 'volume kam', 'volume kam kar', 'awaz kam', 'sound down', 'volume decrease'].some(k => cleanedText.includes(k))) {
    return { intent: 'VOLUME_DOWN', pipeline: ['Input Received', wakeWordPrefix + 'NLP (VOLUME_DOWN)', 'ADB Keyevent'], details: { target: 'Phone', wakeWordDetected } };
  }
  if (['mute', 'silent', 'chup kar', 'awaz band', 'sound mute', 'volume mute'].some(k => cleanedText.includes(k))) {
    return { intent: 'MUTE', pipeline: ['Input Received', wakeWordPrefix + 'NLP (MUTE)', 'ADB Keyevent'], details: { target: 'Phone', wakeWordDetected } };
  }
  const brightnessMatch = cleanedText.match(/(brightness|roshni|light)\s*(up|down|high|low|max|min|full|kam|zyada|badha|low kar|increase|decrease|\d+)/);
  if (brightnessMatch) {
    let level = 180;
    const val = brightnessMatch[2];
    if (['up', 'high', 'max', 'full', 'zyada', 'badha', 'increase'].includes(val)) level = 255;
    else if (['down', 'low', 'min', 'kam', 'decrease', 'low kar'].includes(val)) level = 30;
    else if (!isNaN(parseInt(val))) level = Math.min(255, parseInt(val));
    return { intent: 'BRIGHTNESS', pipeline: ['Input Received', wakeWordPrefix + 'NLP (BRIGHTNESS)', 'ADB Settings Write'], details: { level, wakeWordDetected } };
  }
  if (['flashlight', 'torch', 'flash on', 'flash off', 'torch on', 'torch off', 'flash light'].some(k => cleanedText.includes(k))) {
    const turnOn = !cleanedText.includes('off') && !cleanedText.includes('band');
    return { intent: 'FLASHLIGHT', pipeline: ['Input Received', wakeWordPrefix + 'NLP (FLASHLIGHT)', 'ADB Torch Toggle'], details: { state: turnOn, wakeWordDetected } };
  }
  let appNameForOpen = null;
  const hindiFirstMatch = cleanedText.match(/(.+?)\s+(?:open|launch|start|kholo|chalu)(?:\s+karo|\s+kar|\s+do|\s+app)?$/i);
  if (hindiFirstMatch) {
    appNameForOpen = hindiFirstMatch[1].trim();
  } else {
    const englishFirstMatch = cleanedText.match(/(?:open|launch|start|kholo|chalu kar|chalu)\s+(.+?)(?:\s+app)?$/i);
    if (englishFirstMatch) {
      appNameForOpen = englishFirstMatch[1].trim();
    }
  }

  if (appNameForOpen && !cleanedText.includes('url') && !cleanedText.includes('http') && !cleanedText.includes('www') && !cleanedText.includes('website')) {
    return { intent: 'OPEN_APP', pipeline: ['Input Received', wakeWordPrefix + 'NLP (OPEN_APP)', 'ADB Monkey Launch'], details: { appName: appNameForOpen, wakeWordDetected } };
  }
  const urlMatch = cleanedText.match(/(?:open|browse|go to|visit|kholo)\s+(?:url|website|site)?\s*(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9]+\.com[^\s]*)/);
  if (urlMatch) {
    return { intent: 'OPEN_URL', pipeline: ['Input Received', wakeWordPrefix + 'NLP (OPEN_URL)', 'ADB Browser Intent'], details: { url: urlMatch[1], wakeWordDetected } };
  }
  if (['wifi on', 'wifi chalu', 'wifi enable', 'wifi start'].some(k => cleanedText.includes(k))) {
    return { intent: 'WIFI_ON', pipeline: ['Input Received', wakeWordPrefix + 'NLP (WIFI_ON)', 'ADB SVC Command'], details: { wakeWordDetected } };
  }
  if (['wifi off', 'wifi band', 'wifi disable', 'wifi stop'].some(k => cleanedText.includes(k))) {
    return { intent: 'WIFI_OFF', pipeline: ['Input Received', wakeWordPrefix + 'NLP (WIFI_OFF)', 'ADB SVC Command'], details: { wakeWordDetected } };
  }
  if (['bluetooth on', 'bluetooth chalu', 'bluetooth enable'].some(k => cleanedText.includes(k))) {
    return { intent: 'BLUETOOTH_ON', pipeline: ['Input Received', wakeWordPrefix + 'NLP (BLUETOOTH_ON)', 'ADB Intent Dispatch'], details: { wakeWordDetected } };
  }
  if (['bluetooth off', 'bluetooth band', 'bluetooth disable'].some(k => cleanedText.includes(k))) {
    return { intent: 'BLUETOOTH_OFF', pipeline: ['Input Received', wakeWordPrefix + 'NLP (BLUETOOTH_OFF)', 'ADB Intent Dispatch'], details: { wakeWordDetected } };
  }
  if (['take photo', 'take picture', 'take selfie', 'photo le', 'photo khicho', 'capture photo', 'camera capture', 'photo lena'].some(k => cleanedText.includes(k))) {
    return { intent: 'TAKE_PHOTO', pipeline: ['Input Received', wakeWordPrefix + 'NLP (TAKE_PHOTO)', 'Camera Launch', 'Shutter Key'], details: { wakeWordDetected } };
  }
  if (['play music', 'pause music', 'play pause', 'gaana play', 'gaana pause', 'song play', 'music play', 'music pause'].some(k => cleanedText.includes(k))) {
    return { intent: 'MEDIA_PLAY', pipeline: ['Input Received', wakeWordPrefix + 'NLP (MEDIA_PLAY)', 'ADB Media Keyevent'], details: { wakeWordDetected } };
  }
  if (['next song', 'next track', 'agla gaana', 'skip song', 'next music'].some(k => cleanedText.includes(k))) {
    return { intent: 'MEDIA_NEXT', pipeline: ['Input Received', wakeWordPrefix + 'NLP (MEDIA_NEXT)', 'ADB Media Keyevent'], details: { wakeWordDetected } };
  }
  if (['previous song', 'previous track', 'pichla gaana', 'last song', 'prev song'].some(k => cleanedText.includes(k))) {
    return { intent: 'MEDIA_PREV', pipeline: ['Input Received', wakeWordPrefix + 'NLP (MEDIA_PREV)', 'ADB Media Keyevent'], details: { wakeWordDetected } };
  }
  if (['go home', 'home screen', 'home button', 'home press', 'press home'].some(k => cleanedText.includes(k))) {
    return { intent: 'HOME', pipeline: ['Input Received', wakeWordPrefix + 'NLP (HOME)', 'ADB Keyevent'], details: { wakeWordDetected } };
  }
  if (['go back', 'back button', 'press back', 'back press', 'piche jao'].some(k => cleanedText.includes(k))) {
    return { intent: 'BACK', pipeline: ['Input Received', wakeWordPrefix + 'NLP (BACK)', 'ADB Keyevent'], details: { wakeWordDetected } };
  }
  if (['recent apps', 'recent app', 'show recents', 'open recents', 'multitask'].some(k => cleanedText.includes(k))) {
    return { intent: 'RECENTS', pipeline: ['Input Received', wakeWordPrefix + 'NLP (RECENTS)', 'ADB Keyevent'], details: { wakeWordDetected } };
  }
  if (['notification', 'notifications', 'show notifications', 'open notifications', 'notification shade'].some(k => cleanedText.includes(k))) {
    return { intent: 'NOTIFICATIONS', pipeline: ['Input Received', wakeWordPrefix + 'NLP (NOTIFICATIONS)', 'ADB Statusbar Cmd'], details: { wakeWordDetected } };
  }

  if (['god mode', 'showtime', 'show time', 'hacker mode', 'initiate protocol', 'execute protocol'].some(k => cleanedText.includes(k))) {
    return { intent: 'GOD_MODE', pipeline: ['Input Received', wakeWordPrefix + 'NLP (GOD_MODE)', 'ADB Rapid Sequence Execution'], details: { wakeWordDetected } };
  }

  const phoneRegex = /\b\+?\d{10,12}\b/g;
  const phoneMatches = cleanedText.match(phoneRegex);
  let rawPhoneNumber = phoneMatches ? phoneMatches[0] : null;

  const sortedContacts = [...contacts].sort((a, b) => b.name.length - a.name.length);
  let resolvedContact = null;

  for (const contact of sortedContacts) {
    const contactNameLower = contact.name.toLowerCase();

    if (cleanedText.includes(contactNameLower)) {
      resolvedContact = contact;
      break;
    }
  }

  if (!resolvedContact) {
    const fuzzy = bestFuzzyContact(cleanedText, sortedContacts);
    if (fuzzy) {
      resolvedContact = fuzzy;
      logDebug(`NLP fuzzy contact match: "${fuzzy.name}"`);
    }
  }

  const hasPronoun = ['him', 'her', 'them', 'usko', 'usey', 'isko', 'isey', 'usse', 'usko'].some(p => cleanedText.includes(` ${p} `) || cleanedText.endsWith(` ${p}`));
  if (!resolvedContact && hasPronoun && nlpContext.lastContact) {
    resolvedContact = nlpContext.lastContact;
    logDebug(`NLP Context Memory: Resolved pronoun to previous contact "${resolvedContact.name}"`);
  }

  if (resolvedContact) {
    nlpContext.lastContact = resolvedContact;
  }

  const isWhatsApp = cleanedText.includes('whatsapp') ||
                     cleanedText.includes('message') ||
                     cleanedText.includes('msg') ||
                     cleanedText.includes('sms');

  const isCall = cleanedText.includes('call') ||
                 cleanedText.includes('dial') ||
                 cleanedText.includes('phone') ||
                 cleanedText.includes('lagao') ||
                 cleanedText.includes('milao') ||
                 cleanedText.includes('baat');

  const targetNumber = resolvedContact ? resolvedContact.number : rawPhoneNumber;
  const targetName = resolvedContact ? resolvedContact.name : (rawPhoneNumber ? 'Unknown Number' : null);


  const searchMatch = cleanedText.match(/(?:search|dhundho)\s+(.+)/i);
  if (searchMatch) {
    const rawName = searchMatch[1].trim().replace(/\b(ko|karo)\b/ig, '').trim();
    const finalName = targetName || rawName;
    if (finalName) {
       return {
         intent: 'WHATSAPP_OPEN_CHAT',
         pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_OPEN_CHAT)', 'Live In-App Search', 'ADB Chat Open'],
         details: { name: finalName, number: targetNumber, wakeWordDetected }
       };
    }
  }

  const typeMatch = cleanedText.match(/(?:type|likho|likh do)\s+(?:sms|message|msg)?\s*(.+)/i);
  if (typeMatch) {
    return {
       intent: 'WHATSAPP_TYPE_MESSAGE',
       pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_TYPE_MESSAGE)', 'ADB Input Text'],
       details: { message: typeMatch[1].trim(), wakeWordDetected }
    };
  }

  if (['send sms', 'send message', 'bhej do', 'send kar do', 'send it'].some(k => cleanedText.includes(k))) {
    return {
       intent: 'WHATSAPP_SEND_MESSAGE',
       pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_SEND_MESSAGE)', 'ADB Button Tap'],
       details: { wakeWordDetected }
    };
  }

  const waCallMatch = cleanedText.match(/(?:whatsapp|watsapp)\s*(?:pe)?\s*call\s*(?:karo|lagao)?\s*(.+)?/i);
  if (waCallMatch) {
    let extractedName = targetName;
    if (!extractedName && waCallMatch[1]) {
      extractedName = waCallMatch[1].trim().replace(/\b(ko|karo)\b/ig, '').trim();
    }

    nlpContext.pendingAction = { type: 'WHATSAPP_CALL', name: extractedName };

    return {
       intent: 'WHATSAPP_ASK_CALL_TYPE',
       pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_ASK_CALL_TYPE)', 'TTS Prompt'],
       details: { name: extractedName, number: targetNumber, wakeWordDetected }
    };
  }

  if (isWhatsApp && targetNumber) {
    let message = extractWhatsAppMessage(cleanedText, targetName, rawPhoneNumber);

    return {
      intent: 'WHATSAPP',
      pipeline: ['Input Received', wakeWordPrefix + 'NLP Intent Extracted (WHATSAPP)', 'Contact Resolution', 'ADB Intent Launch', 'Send Auto-Click'],
      details: {
        name: targetName,
        number: targetNumber,
        message: message || 'Hello!',
        wakeWordDetected
      }
    };
  }

  if (isCall && targetNumber) {
    return {
      intent: 'CALL',
      pipeline: ['Input Received', wakeWordPrefix + 'NLP Intent Extracted (CALL)', 'Contact Resolution', 'ADB Call Intent Launch'],
      details: {
        name: targetName,
        number: targetNumber,
        wakeWordDetected
      }
    };
  }

  if (targetNumber && (isCall || isWhatsApp)) {
    if (isWhatsApp) {
      return {
        intent: 'WHATSAPP',
        pipeline: ['Input Received', wakeWordPrefix + 'NLP Intent Extracted (WHATSAPP)', 'Contact Resolution', 'ADB Intent Launch', 'Send Auto-Click'],
        details: {
          name: targetName,
          number: targetNumber,
          message: 'Hello!',
          wakeWordDetected
        }
      };
    } else {
      return {
        intent: 'CALL',
        pipeline: ['Input Received', wakeWordPrefix + 'NLP Intent Extracted (CALL)', 'Contact Resolution', 'ADB Call Intent Launch'],
        details: {
          name: targetName,
          number: targetNumber,
          wakeWordDetected
        }
      };
    }
  }

  return {
    intent: 'UNKNOWN',
    pipeline: ['Input Received', 'NLP Parsing (FAILED)'],
    details: { rawText: text, wakeWordDetected }
  };
}

function extractWhatsAppMessage(text, contactName, rawNumber) {
  let cleaned = text;

  const stopPhrases = [
    'send whatsapp to', 'whatsapp to', 'whatsapp message to', 'whatsapp message', 'whatsapp msg', 'whatsapp',
    'send message to', 'message to', 'message', 'msg to', 'msg', 'sms to', 'sms',
    'saying', 'say', 'write', 'ki', 'bhejo', 'likho', 'karo', 'ko', 'par'
  ];

  if (contactName) {
    cleaned = cleaned.replace(contactName.toLowerCase(), '');
  }
  if (rawNumber) {
    cleaned = cleaned.replace(rawNumber, '');
  }

  for (const phrase of stopPhrases) {
    const regex = new RegExp(`\\b${phrase}\\b`, 'g');
    cleaned = cleaned.replace(regex, '');
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (cleaned.length > 0) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return '';
}

function logDebug(msg) {
  console.log(`[NLP DEBUG] ${msg}`);
}


const HINGLISH_FIXES = [
  [/^\s*(funny|bunny|nanny|vaani|vani ji|when he|wami|honey|ronnie)\b/i, 'vani'],
  [/\b(whats app|whats up|what'?s app|what'?s up|watsapp|watts app|whatsaap|whatsp)\b/gi, 'whatsapp'],
  [/\b(kaul|kall|khaul|caul)\b/gi, 'call'],
  [/\b(phone karo|phone kar do|phone lagao)\b/gi, 'call'],
  [/\b(flash light|flashlite|flash lite|flesh light|flashlyt)\b/gi, 'flashlight'],
  [/\b(tortch|taurch|torche)\b/gi, 'torch'],
  [/\bvol (up|down)\b/gi, 'volume $1'],
  [/\b(volume badhao|volume badha do|awaaz badhao|aawaz badhao)\b/gi, 'volume up'],
  [/\b(volume kam karo|volume ghatao|awaaz kam karo)\b/gi, 'volume down'],
  [/\b(brightness badhao|brightness badha do|roshni badhao)\b/gi, 'brightness up'],
  [/\b(brightness kam karo|brightness ghatao|roshni kam karo)\b/gi, 'brightness down'],
  [/\b(photo lo|photo le lo|photo kheencho|photo khinch|selfie lo|take selfie)\b/gi, 'take photo'],
  [/\b(un lock|unlok|unluck)\b/gi, 'unlock'],
  [/\b(shut down|shatdown|shutdaun|shut daun)\b/gi, 'shutdown'],
  [/\b(pc band karo|computer band karo|laptop band karo)\b/gi, 'shutdown pc'],
  [/\b(gaana chalao|song chalao|music chalao|play gaana)\b/gi, 'play music'],
  [/\b(agla gaana|next gaana|next gana)\b/gi, 'next song'],
  [/\b(pichla gaana|previous gaana|last gaana)\b/gi, 'previous song'],
  [/\b(home jao|home chalo|ghar jao)\b/gi, 'go home'],
  [/\b(peeche jao|wapas jao|back jao)\b/gi, 'go back'],
];

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  'full': 255, 'maximum': 255, 'max': 255, 'minimum': 10, 'min': 10
};

export function normalizeHinglish(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = ' ' + text.toLowerCase().replace(/\s+/g, ' ').trim() + ' ';

  for (const [re, rep] of HINGLISH_FIXES) out = out.replace(re, rep);

  out = out.replace(/\b(brightness|volume|level)\s+(?:to\s+|ko\s+)?([a-z]+)\b/gi, (m, key, word) => {
    const n = NUMBER_WORDS[word.toLowerCase()];
    return n === undefined ? m : `${key} ${n}`;
  });

  return out.replace(/\s+/g, ' ').trim();
}

export function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function dice(a, b) {
  a = String(a).toLowerCase().replace(/\s+/g, '');
  b = String(b).toLowerCase().replace(/\s+/g, '');
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.substr(i, 2);
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.substr(i, 2);
    const count = bigrams.get(bg) || 0;
    if (count > 0) { bigrams.set(bg, count - 1); overlap++; }
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

export function bestFuzzyContact(text, contacts) {
  const tokens = String(text).toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  const chunks = new Set(tokens);
  for (let i = 0; i < tokens.length - 1; i++) chunks.add(tokens[i] + ' ' + tokens[i + 1]);

  let best = null;
  let bestScore = 0;
  for (const contact of contacts) {
    const name = String(contact.name || '').toLowerCase();
    if (name.length < 3) continue;
    for (const chunk of chunks) {
      const d = levenshtein(chunk, name);
      const maxLen = Math.max(chunk.length, name.length);
      const near = (name.length >= 4 && d <= 2) || (name.length < 4 && d <= 1);
      const sim = dice(chunk, name);
      const score = Math.max(sim, near ? 1 - d / (maxLen || 1) : 0);
      if ((near || sim >= 0.8) && score > bestScore) {
        bestScore = score;
        best = contact;
      }
    }
  }
  return best;
}

export function parseCandidates(candidates, contacts = [], context) {
  const tried = [];
  const list = (Array.isArray(candidates) ? candidates : [candidates])
    .map((c) => (typeof c === 'string' ? c : ''))
    .filter(Boolean);

  const seen = new Set();
  let firstParse = null;
  let firstText = list[0] || '';

  for (const raw of list) {
    const normalized = normalizeHinglish(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tried.push(normalized);

    const parsed = parseCommand(normalized, contacts, context);
    if (!firstParse) { firstParse = parsed; firstText = normalized; }
    if (parsed.intent && parsed.intent !== 'UNKNOWN') {
      return { parsed, chosenText: normalized, tried };
    }
  }

  return {
    parsed: firstParse || parseCommand(firstText, contacts, context),
    chosenText: firstText,
    tried
  };
}
