/**
 * Hinglish/English Natural Language Command Parser for NexusFlow
 */

let nlpContext = {
  lastContact: null,
  pendingAction: null
};

export function parseCommand(text, contacts = []) {
  let normalized = text.toLowerCase().trim();
  
  // Detect wake word variations (Vani, Wani, वाणी, वानी, etc.) at the beginning of the command
  const wakeWordRegex = /^(vani|wani|वाणी|वानी|vaney|wanee|vany|bany)\b/i;
  const wakeWordMatch = normalized.match(wakeWordRegex);
  let wakeWordDetected = false;
  let processedText = normalized;

  if (wakeWordMatch) {
    wakeWordDetected = true;
    // Remove the wake word and strip leading whitespace/punctuation
    processedText = normalized.replace(wakeWordRegex, '').trim().replace(/^[.,\/#!$%\^&\*;:{}=\-_`~()]+/g, "").trim();
    logDebug(`Wake word 'Vani' detected! Processing command: "${processedText}"`);
  }

  // Strip all punctuation for keyword searches
  const cleanedText = processedText.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
  
  logDebug(`Normalizing input command: "${text}" -> "${cleanedText}" (Wake word detected: ${wakeWordDetected})`);

  const wakeWordPrefix = wakeWordDetected ? 'Vani Activated ➔ ' : '';

  // --- CONVERSATIONAL CONTEXT CHECK ---
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

  // 1. Detect Shutdown Intent
  const shutdownKeywords = [
    'shutdown pc', 'shutdown computer', 'turn off pc', 'turn off computer', 
    'power off pc', 'pc shutdown', 'pc band', 'computer band', 'system band', 
    'computer shutdown', 'laptop shutdown', 'shutdown my pc', 'pc ko shutdown'
  ];
  if (shutdownKeywords.some(keyword => cleanedText.includes(keyword))) {
    return {
      intent: 'SHUTDOWN',
      pipeline: ['Input Received', wakeWordPrefix + 'NLP Intent Extracted (SHUTDOWN)', 'OS Trigger compiled', 'Shutdown Initiated'],
      details: { target: 'PC', wakeWordDetected }
    };
  }

  // 2. Detect Unlock Intent
  const unlockKeywords = [
    'unlock phone', 'unlock mobile', 'unlock android', 'bypass lock', 'open lock',
    'phone unlock', 'mobile unlock', 'lock kholo', 'unlock kar', 'screen unlock',
    'password unlock'
  ];
  if (unlockKeywords.some(keyword => cleanedText.includes(keyword))) {
    return {
      intent: 'UNLOCK',
      pipeline: ['Input Received', wakeWordPrefix + 'NLP Intent Extracted (UNLOCK)', 'ADB Check', 'ADB Swipe Command', 'PIN Submission'],
      details: { target: 'Phone', wakeWordDetected }
    };
  }

  // --- EXTENDED INTENTS ---

  // Volume Up
  if (['volume up', 'volume badha', 'volume badhao', 'awaz badha', 'sound up', 'loud kar', 'volume increase'].some(k => cleanedText.includes(k))) {
    return { intent: 'VOLUME_UP', pipeline: ['Input Received', wakeWordPrefix + 'NLP (VOLUME_UP)', 'ADB Keyevent'], details: { target: 'Phone', wakeWordDetected } };
  }
  // Volume Down
  if (['volume down', 'volume kam', 'volume kam kar', 'awaz kam', 'sound down', 'volume decrease'].some(k => cleanedText.includes(k))) {
    return { intent: 'VOLUME_DOWN', pipeline: ['Input Received', wakeWordPrefix + 'NLP (VOLUME_DOWN)', 'ADB Keyevent'], details: { target: 'Phone', wakeWordDetected } };
  }
  // Mute
  if (['mute', 'silent', 'chup kar', 'awaz band', 'sound mute', 'volume mute'].some(k => cleanedText.includes(k))) {
    return { intent: 'MUTE', pipeline: ['Input Received', wakeWordPrefix + 'NLP (MUTE)', 'ADB Keyevent'], details: { target: 'Phone', wakeWordDetected } };
  }
  // Brightness
  const brightnessMatch = cleanedText.match(/(brightness|roshni|light)\s*(up|down|high|low|max|min|full|kam|zyada|badha|low kar|increase|decrease|\d+)/);
  if (brightnessMatch) {
    let level = 180;
    const val = brightnessMatch[2];
    if (['up', 'high', 'max', 'full', 'zyada', 'badha', 'increase'].includes(val)) level = 255;
    else if (['down', 'low', 'min', 'kam', 'decrease', 'low kar'].includes(val)) level = 30;
    else if (!isNaN(parseInt(val))) level = Math.min(255, parseInt(val));
    return { intent: 'BRIGHTNESS', pipeline: ['Input Received', wakeWordPrefix + 'NLP (BRIGHTNESS)', 'ADB Settings Write'], details: { level, wakeWordDetected } };
  }
  // Flashlight
  if (['flashlight', 'torch', 'flash on', 'flash off', 'torch on', 'torch off', 'flash light'].some(k => cleanedText.includes(k))) {
    const turnOn = !cleanedText.includes('off') && !cleanedText.includes('band');
    return { intent: 'FLASHLIGHT', pipeline: ['Input Received', wakeWordPrefix + 'NLP (FLASHLIGHT)', 'ADB Torch Toggle'], details: { state: turnOn, wakeWordDetected } };
  }
  // Open App
  const openAppMatch = cleanedText.match(/(?:open|launch|start|kholo|chalu kar)\s+(.+?)(?:\s+app)?$/);
  if (openAppMatch && !cleanedText.includes('url') && !cleanedText.includes('http') && !cleanedText.includes('www') && !cleanedText.includes('website')) {
    return { intent: 'OPEN_APP', pipeline: ['Input Received', wakeWordPrefix + 'NLP (OPEN_APP)', 'ADB Monkey Launch'], details: { appName: openAppMatch[1].trim(), wakeWordDetected } };
  }
  // Open URL
  const urlMatch = cleanedText.match(/(?:open|browse|go to|visit|kholo)\s+(?:url|website|site)?\s*(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9]+\.com[^\s]*)/);
  if (urlMatch) {
    return { intent: 'OPEN_URL', pipeline: ['Input Received', wakeWordPrefix + 'NLP (OPEN_URL)', 'ADB Browser Intent'], details: { url: urlMatch[1], wakeWordDetected } };
  }
  // WiFi
  if (['wifi on', 'wifi chalu', 'wifi enable', 'wifi start'].some(k => cleanedText.includes(k))) {
    return { intent: 'WIFI_ON', pipeline: ['Input Received', wakeWordPrefix + 'NLP (WIFI_ON)', 'ADB SVC Command'], details: { wakeWordDetected } };
  }
  if (['wifi off', 'wifi band', 'wifi disable', 'wifi stop'].some(k => cleanedText.includes(k))) {
    return { intent: 'WIFI_OFF', pipeline: ['Input Received', wakeWordPrefix + 'NLP (WIFI_OFF)', 'ADB SVC Command'], details: { wakeWordDetected } };
  }
  // Bluetooth
  if (['bluetooth on', 'bluetooth chalu', 'bluetooth enable'].some(k => cleanedText.includes(k))) {
    return { intent: 'BLUETOOTH_ON', pipeline: ['Input Received', wakeWordPrefix + 'NLP (BLUETOOTH_ON)', 'ADB Intent Dispatch'], details: { wakeWordDetected } };
  }
  if (['bluetooth off', 'bluetooth band', 'bluetooth disable'].some(k => cleanedText.includes(k))) {
    return { intent: 'BLUETOOTH_OFF', pipeline: ['Input Received', wakeWordPrefix + 'NLP (BLUETOOTH_OFF)', 'ADB Intent Dispatch'], details: { wakeWordDetected } };
  }
  // Take Photo
  if (['take photo', 'take picture', 'take selfie', 'photo le', 'photo khicho', 'capture photo', 'camera capture', 'photo lena'].some(k => cleanedText.includes(k))) {
    return { intent: 'TAKE_PHOTO', pipeline: ['Input Received', wakeWordPrefix + 'NLP (TAKE_PHOTO)', 'Camera Launch', 'Shutter Key'], details: { wakeWordDetected } };
  }
  // Media Controls
  if (['play music', 'pause music', 'play pause', 'gaana play', 'gaana pause', 'song play', 'music play', 'music pause'].some(k => cleanedText.includes(k))) {
    return { intent: 'MEDIA_PLAY', pipeline: ['Input Received', wakeWordPrefix + 'NLP (MEDIA_PLAY)', 'ADB Media Keyevent'], details: { wakeWordDetected } };
  }
  if (['next song', 'next track', 'agla gaana', 'skip song', 'next music'].some(k => cleanedText.includes(k))) {
    return { intent: 'MEDIA_NEXT', pipeline: ['Input Received', wakeWordPrefix + 'NLP (MEDIA_NEXT)', 'ADB Media Keyevent'], details: { wakeWordDetected } };
  }
  if (['previous song', 'previous track', 'pichla gaana', 'last song', 'prev song'].some(k => cleanedText.includes(k))) {
    return { intent: 'MEDIA_PREV', pipeline: ['Input Received', wakeWordPrefix + 'NLP (MEDIA_PREV)', 'ADB Media Keyevent'], details: { wakeWordDetected } };
  }
  // Navigation
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
  
  // God Mode Sequence
  if (['god mode', 'showtime', 'show time', 'hacker mode', 'initiate protocol', 'execute protocol'].some(k => cleanedText.includes(k))) {
    return { intent: 'GOD_MODE', pipeline: ['Input Received', wakeWordPrefix + 'NLP (GOD_MODE)', 'ADB Rapid Sequence Execution'], details: { wakeWordDetected } };
  }

  // 3. Search for phone numbers in the command
  // Matches 10-digit numbers or international numbers (e.g. +919876543210, 9876543210)
  const phoneRegex = /\b\+?\d{10,12}\b/g;
  const phoneMatches = cleanedText.match(phoneRegex);
  let rawPhoneNumber = phoneMatches ? phoneMatches[0] : null;

  // 4. Search for contacts in command text
  // Sort contacts by name length descending to avoid partial matches (e.g., "Yash Kumar" before "Yash")
  const sortedContacts = [...contacts].sort((a, b) => b.name.length - a.name.length);
  let resolvedContact = null;
  
  for (const contact of sortedContacts) {
    const contactNameLower = contact.name.toLowerCase();
    
    // Check if the contact name appears in the command text
    if (cleanedText.includes(contactNameLower)) {
      resolvedContact = contact;
      break;
    }
  }

  // Context-Aware Memory: Resolve pronouns to last contact
  const hasPronoun = ['him', 'her', 'them', 'usko', 'usey', 'isko', 'isey', 'usse', 'usko'].some(p => cleanedText.includes(` ${p} `) || cleanedText.endsWith(` ${p}`));
  if (!resolvedContact && hasPronoun && nlpContext.lastContact) {
    resolvedContact = nlpContext.lastContact;
    logDebug(`NLP Context Memory: Resolved pronoun to previous contact "${resolvedContact.name}"`);
  }

  // Store context for future commands
  if (resolvedContact) {
    nlpContext.lastContact = resolvedContact;
  }

  // Match WhatsApp keyword
  const isWhatsApp = cleanedText.includes('whatsapp') || 
                     cleanedText.includes('message') || 
                     cleanedText.includes('msg') || 
                     cleanedText.includes('sms');

  // Match Call keyword
  const isCall = cleanedText.includes('call') || 
                 cleanedText.includes('dial') || 
                 cleanedText.includes('phone') || 
                 cleanedText.includes('lagao') || 
                 cleanedText.includes('milao') || 
                 cleanedText.includes('baat');

  // Resolve target details
  const targetNumber = resolvedContact ? resolvedContact.number : rawPhoneNumber;
  const targetName = resolvedContact ? resolvedContact.name : (rawPhoneNumber ? 'Unknown Number' : null);

  // --- INTERACTIVE WHATSAPP PIPELINE ---
  
  // A. Search / Open Chat
  const searchMatch = cleanedText.match(/(?:search|dhundho)\s+(.+)/i);
  if (searchMatch) {
    const rawName = searchMatch[1].trim().replace(/\b(ko|karo)\b/ig, '').trim();
    // Use targetName if resolved, otherwise use the dynamically extracted rawName
    const finalName = targetName || rawName;
    if (finalName) {
       return {
         intent: 'WHATSAPP_OPEN_CHAT',
         pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_OPEN_CHAT)', 'Live In-App Search', 'ADB Chat Open'],
         details: { name: finalName, number: targetNumber, wakeWordDetected }
       };
    }
  }

  // B. Type Message (Without Sending)
  const typeMatch = cleanedText.match(/(?:type|likho|likh do)\s+(?:sms|message|msg)?\s*(.+)/i);
  if (typeMatch) {
    return {
       intent: 'WHATSAPP_TYPE_MESSAGE',
       pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_TYPE_MESSAGE)', 'ADB Input Text'],
       details: { message: typeMatch[1].trim(), wakeWordDetected }
    };
  }

  // C. Send Message (Tap Send)
  if (['send sms', 'send message', 'bhej do', 'send kar do', 'send it'].some(k => cleanedText.includes(k))) {
    return {
       intent: 'WHATSAPP_SEND_MESSAGE',
       pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_SEND_MESSAGE)', 'ADB Button Tap'],
       details: { wakeWordDetected }
    };
  }

  // D. Audio/Video Call (WhatsApp Call) - Prompting
  const waCallMatch = cleanedText.match(/(?:whatsapp|watsapp)\s*(?:pe)?\s*call\s*(?:karo|lagao)?\s*(.+)?/i);
  if (waCallMatch) {
    let extractedName = targetName;
    if (!extractedName && waCallMatch[1]) {
      extractedName = waCallMatch[1].trim().replace(/\b(ko|karo)\b/ig, '').trim();
    }
    
    // Set conversational state
    nlpContext.pendingAction = { type: 'WHATSAPP_CALL', name: extractedName };
    
    return {
       intent: 'WHATSAPP_ASK_CALL_TYPE',
       pipeline: ['Input Received', wakeWordPrefix + 'NLP (WHATSAPP_ASK_CALL_TYPE)', 'TTS Prompt'],
       details: { name: extractedName, number: targetNumber, wakeWordDetected }
    };
  }

  // 5. Build WhatsApp Action (Generic Auto-Send)
  if (isWhatsApp && targetNumber) {
    // Extract message payload
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

  // 6. Build Call Action
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

  // 7. Fallback logic: If name and number are matched, default to call unless whatsapp is implied
  if (targetNumber) {
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
      // Default to CALL if a contact/number is found but no specific whatsapp intent
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

  // 8. Command unrecognized
  return {
    intent: 'UNKNOWN',
    pipeline: ['Input Received', 'NLP Parsing (FAILED)'],
    details: { rawText: text, wakeWordDetected }
  };
}

/**
 * Extracts message content from a WhatsApp command text
 */
function extractWhatsAppMessage(text, contactName, rawNumber) {
  let cleaned = text;

  // Words to remove to isolate message
  const stopPhrases = [
    'send whatsapp to', 'whatsapp to', 'whatsapp message to', 'whatsapp message', 'whatsapp msg', 'whatsapp',
    'send message to', 'message to', 'message', 'msg to', 'msg', 'sms to', 'sms',
    'saying', 'say', 'write', 'ki', 'bhejo', 'likho', 'karo', 'ko', 'par'
  ];

  // Remove the phone number or contact name from the text
  if (contactName) {
    cleaned = cleaned.replace(contactName.toLowerCase(), '');
  }
  if (rawNumber) {
    cleaned = cleaned.replace(rawNumber, '');
  }

  // Remove stop phrases
  for (const phrase of stopPhrases) {
    // Replace with word boundary to avoid partial matches
    const regex = new RegExp(`\\b${phrase}\\b`, 'g');
    cleaned = cleaned.replace(regex, '');
  }

  // Clean up extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Capitalize first letter of message for professional look
  if (cleaned.length > 0) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return '';
}

function logDebug(msg) {
  console.log(`[NLP DEBUG] ${msg}`);
}
