import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(__dirname, 'bin');
const LOCAL_ADB_DIR = path.join(BIN_DIR, 'platform-tools');
const LOCAL_ADB_PATH = path.join(LOCAL_ADB_DIR, 'adb.exe');

let adbPath = 'adb'; // Default to system ADB
let isAdbReady = false;

// Logger helper for streaming to UI
let logStreamCallback = null;
export function setLogCallback(callback) {
  logStreamCallback = callback;
}

function log(message, type = 'info') {
  console.log(`[ADB] [${type.toUpperCase()}] ${message}`);
  if (logStreamCallback) {
    logStreamCallback({ message, type, timestamp: new Date().toISOString() });
  }
}

/**
 * Downloads and extracts ADB if not present in path or locally.
 */
export async function ensureAdbInstalled() {
  log('Checking ADB environment...', 'info');
  
  // 1. Check system ADB
  try {
    const { stdout } = await execAsync('adb version');
    log(`System ADB detected: ${stdout.trim().split('\n')[0]}`, 'success');
    adbPath = 'adb';
    isAdbReady = true;
    return true;
  } catch (err) {
    log('System ADB not found in PATH. Checking local installation...', 'info');
  }

  // 2. Check local ADB
  if (fs.existsSync(LOCAL_ADB_PATH)) {
    log(`Local ADB detected at: ${LOCAL_ADB_PATH}`, 'success');
    adbPath = LOCAL_ADB_PATH;
    isAdbReady = true;
    return true;
  }

  // 3. Download and extract local ADB
  log('Local ADB not found. Starting automatic download from Google servers...', 'info');
  const adbUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
  const zipPath = path.join(BIN_DIR, 'platform-tools.zip');

  try {
    if (!fs.existsSync(BIN_DIR)) {
      fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    log('Downloading Platform Tools zip...', 'info');
    const response = await fetch(adbUrl);
    if (!response.ok) {
      throw new Error(`Failed to download platform-tools: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(zipPath, Buffer.from(buffer));
    log('Download completed. Extracting archive...', 'info');

    // Extract using Windows PowerShell Expand-Archive (built-in, zero dependencies)
    const powerShellCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`;
    await execAsync(powerShellCmd);
    log('Archive extracted successfully.', 'success');

    // Clean up zip
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    if (fs.existsSync(LOCAL_ADB_PATH)) {
      adbPath = LOCAL_ADB_PATH;
      isAdbReady = true;
      log('Local ADB is now set up and ready to use.', 'success');
      return true;
    } else {
      throw new Error('ADB executable not found in extracted directory.');
    }
  } catch (error) {
    log(`ADB setup failed: ${error.message}. Please connect manual ADB.`, 'error');
    isAdbReady = false;
    return false;
  }
}

/**
 * Helper to run ADB command and return stdout
 */
export async function runAdb(argsString) {
  if (!isAdbReady) {
    await ensureAdbInstalled();
  }
  
  const cmd = `"${adbPath}" ${argsString}`;
  log(`Executing: ${cmd}`, 'debug');
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr && stderr.trim() && !stderr.includes('daemon started successfully')) {
      log(`ADB stderr warning: ${stderr.trim()}`, 'warning');
    }
    return stdout.trim();
  } catch (error) {
    log(`Command failed: ${cmd}. Error: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Returns connected devices
 */
export async function getDevices() {
  try {
    const output = await runAdb('devices');
    const lines = output.split('\n').map(line => line.trim()).filter(line => line);
    const devices = [];
    
    // First line is "List of devices attached"
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length >= 2) {
        devices.push({
          id: parts[0],
          status: parts[1]
        });
      }
    }
    return devices;
  } catch (error) {
    return [];
  }
}

/**
 * Fetches real-time status diagnostics of connected device
 */
export async function getDeviceDiagnostics() {
  const devices = await getDevices();
  if (devices.length === 0) {
    return { connected: false, message: 'No devices connected. Connect via USB.' };
  }

  const deviceId = devices[0].id;
  try {
    // Brand & Model
    const brand = await runAdb(`-s ${deviceId} shell getprop ro.product.brand`);
    const model = await runAdb(`-s ${deviceId} shell getprop ro.product.model`);
    const release = await runAdb(`-s ${deviceId} shell getprop ro.build.version.release`);

    // Battery
    const batteryDump = await runAdb(`-s ${deviceId} shell dumpsys battery`);
    const batteryLevelMatch = batteryDump.match(/level:\s+(\d+)/);
    const batteryTempMatch = batteryDump.match(/temperature:\s+(\d+)/);
    const batteryStatusMatch = batteryDump.match(/status:\s+(\d+)/);

    const batteryLevel = batteryLevelMatch ? parseInt(batteryLevelMatch[1]) : null;
    const batteryTemp = batteryTempMatch ? parseFloat(batteryTempMatch[1]) / 10 : null; // Dumpsys gives temp in tenths of degree C
    
    // Battery Status: 1 = Unknown, 2 = Charging, 3 = Discharging, 4 = Not Charging, 5 = Full
    const statusCodes = { 1: 'Unknown', 2: 'Charging', 3: 'Discharging', 4: 'Not Charging', 5: 'Full' };
    const batteryStatus = batteryStatusMatch ? statusCodes[batteryStatusMatch[1]] || 'Unknown' : 'Unknown';

    // Resolution
    const sizeOutput = await runAdb(`-s ${deviceId} shell wm size`);
    const sizeMatch = sizeOutput.match(/Physical size:\s+(\d+x\d+)/);
    const resolution = sizeMatch ? sizeMatch[1] : 'Unknown';

    return {
      connected: true,
      deviceId,
      brand: brand.toUpperCase(),
      model,
      androidVersion: release,
      batteryLevel,
      batteryTemp,
      batteryStatus,
      resolution
    };
  } catch (error) {
    return {
      connected: true,
      deviceId,
      error: error.message
    };
  }
}

/**
 * Captures screen and pulls image to public/screen.png
 */
export async function captureScreen(outputPath) {
  const devices = await getDevices();
  if (devices.length === 0) {
    throw new Error('No device connected');
  }
  const deviceId = devices[0].id;
  
  log('Taking screenshot of mobile screen...', 'info');
  const tempPhonePath = '/sdcard/nexus_temp.png';
  
  await runAdb(`-s ${deviceId} shell screencap -p ${tempPhonePath}`);
  
  // Make sure output folder exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await runAdb(`-s ${deviceId} pull ${tempPhonePath} "${outputPath}"`);
  await runAdb(`-s ${deviceId} shell rm ${tempPhonePath}`);
  log('Screenshot successfully transferred to PC dashboard.', 'success');
  return true;
}

/**
 * Checks if mobile screen is active (on)
 */
export async function isScreenOn(deviceId) {
  try {
    const output = await runAdb(`-s ${deviceId} shell dumpsys power`);
    // Check for mHoldingDisplaySuspendBlocker=true or mInteractive=true or Display Power: state=ON
    const isInteractive = output.includes('mInteractive=true') || output.includes('Display Power: state=ON') || output.includes('mScreenOn=true');
    return isInteractive;
  } catch (e) {
    return false;
  }
}

/**
 * Checks if the phone's keyguard (lock screen) is currently showing
 */
export async function isPhoneLocked(deviceId) {
  try {
    const output = await runAdb(`-s ${deviceId} shell dumpsys window`);
    // Check multiple indicators for lock screen state
    const isShowing = output.includes('mDreamingLockscreen=true') ||
                      output.includes('mShowingLockscreen=true') ||
                      output.includes('isStatusBarKeyguard=true') ||
                      output.includes('showing=true');
    
    // Also check via keyguard service
    try {
      const kgOutput = await runAdb(`-s ${deviceId} shell dumpsys trust`);
      const deviceLocked = kgOutput.includes('deviceLocked=true');
      return isShowing || deviceLocked;
    } catch (e) {
      return isShowing;
    }
  } catch (e) {
    // If we can't determine, assume locked for safety
    return true;
  }
}

/**
 * Unlocks phone by waking screen, swiping, and typing PIN if needed.
 * Intelligently detects if the phone is already unlocked and skips if so.
 */
export async function unlockPhone(pin) {
  const devices = await getDevices();
  if (devices.length === 0) {
    throw new Error('No device connected');
  }
  const deviceId = devices[0].id;

  log('Executing Phone Unlock pipeline...', 'info');

  // 1. Wake screen if off
  const screenActive = await isScreenOn(deviceId);
  if (!screenActive) {
    log('Screen is currently OFF. Sending WAKEUP key...', 'info');
    await runAdb(`-s ${deviceId} shell input keyevent KEYCODE_WAKEUP`);
    await new Promise(resolve => setTimeout(resolve, 800));
  } else {
    log('Screen is already ON.', 'info');
  }

  // 2. CHECK IF PHONE IS ALREADY UNLOCKED
  const locked = await isPhoneLocked(deviceId);
  if (!locked) {
    log('Phone is already UNLOCKED! No action needed. Skipping unlock sequence.', 'success');
    return { alreadyUnlocked: true };
  }
  log('Keyguard lockscreen is ACTIVE. Proceeding with unlock...', 'info');

  // 3. Dismiss keyguard (swipe up)
  log('Dismissing keyguard lockscreen (swipe up)...', 'info');
  const sizeOutput = await runAdb(`-s ${deviceId} shell wm size`);
  const sizeMatch = sizeOutput.match(/Physical size:\s+(\d+)x(\d+)/);
  let startX = 500, startY = 1600, endX = 500, endY = 400;
  
  if (sizeMatch) {
    const width = parseInt(sizeMatch[1]);
    const height = parseInt(sizeMatch[2]);
    startX = Math.floor(width / 2);
    startY = Math.floor(height * 0.8);
    endX = Math.floor(width / 2);
    endY = Math.floor(height * 0.2);
  }
  
  await runAdb(`-s ${deviceId} shell input swipe ${startX} ${startY} ${endX} ${endY} 250`);
  await new Promise(resolve => setTimeout(resolve, 700));

  // 4. Input PIN if provided
  if (pin) {
    log('Typing security PIN...', 'info');
    await runAdb(`-s ${deviceId} shell input text ${pin}`);
    await new Promise(resolve => setTimeout(resolve, 300));
    log('Submitting PIN...', 'info');
    await runAdb(`-s ${deviceId} shell input keyevent 66`); // Enter key
  } else {
    log('Unlock swipe completed (No PIN configured).', 'success');
  }

  log('Phone unlock process completed.', 'success');
  return { alreadyUnlocked: false };
}

/**
 * Initiates phone call
 */
export async function makeCall(phoneNumber) {
  const devices = await getDevices();
  if (devices.length === 0) {
    throw new Error('No device connected');
  }
  const deviceId = devices[0].id;

  log(`Initiating call pipeline to: ${phoneNumber}`, 'info');
  
  // Clean phone number (leave only digits and maybe a leading +)
  const cleanNumber = phoneNumber.replace(/[^0-9+]/g, '');

  try {
    // Try to trigger CALL intent directly (places the call instantly)
    log(`Sending DIRECT_CALL intent...`, 'info');
    await runAdb(`-s ${deviceId} shell am start -a android.intent.action.CALL -d tel:${cleanNumber}`);
    log(`Direct call intent triggered successfully. Check phone screen.`, 'success');
  } catch (error) {
    // If it fails (due to lack of system permissions for adb call), fall back to DIAL intent
    log(`Direct call intent failed or blocked. Retrying with DIAL intent...`, 'warning');
    await runAdb(`-s ${deviceId} shell am start -a android.intent.action.DIAL -d tel:${cleanNumber}`);
    
    // Simulate pressing the CALL dialer button (on most dialers, pressing KEYCODE_CALL triggers it)
    await new Promise(resolve => setTimeout(resolve, 1000));
    log(`Sending KEYCODE_CALL input event to dial number...`, 'info');
    await runAdb(`-s ${deviceId} shell input keyevent KEYCODE_CALL`);
    log(`Dialer command executed.`, 'success');
  }
  return true;
}

/**
 * Automates WhatsApp messages
 */
export async function sendWhatsAppMessage(phoneNumber, message, coords) {
  const devices = await getDevices();
  if (devices.length === 0) {
    throw new Error('No device connected');
  }
  const deviceId = devices[0].id;

  log(`Executing WhatsApp messaging pipeline for ${phoneNumber}...`, 'info');

  // Formats number to WhatsApp standard: numeric country code + local number, no spaces or +
  // E.g., if number doesn't start with country code, we ask user to write it, or default to 91 (India) if standard 10 digit
  let formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
  if (formattedNumber.length === 10) {
    formattedNumber = '91' + formattedNumber; // Default to India country code if 10-digit
    log(`No country code specified. Defaulted to India (+91): ${formattedNumber}`, 'warning');
  }

  // 1. Wake phone and unlock first
  const screenActive = await isScreenOn(deviceId);
  if (!screenActive) {
    log('Screen is OFF. Waking up device...', 'info');
    await runAdb(`-s ${deviceId} shell input keyevent KEYCODE_WAKEUP`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // 2. Open WhatsApp intent preloaded with message
  log('Launching WhatsApp conversation window...', 'info');
  // Escape & and other URI characters for cmd
  const encodedText = encodeURIComponent(message);
  const whatsappUrl = `whatsapp://send?phone=${formattedNumber}&text=${encodedText}`;
  
  // Note: we wrap the url in double quotes to avoid shell breaking on '&'
  await runAdb(`-s ${deviceId} shell am start -a android.intent.action.VIEW -d "${whatsappUrl}"`);
  
  // 3. Wait for WhatsApp to load and focus input box
  log('Waiting for WhatsApp layout to render (3 seconds)...', 'info');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. Click Send button.
  // We can calculate coordinates if they are not explicitly provided.
  // Standard Send button on WhatsApp compose screen is on the right side.
  // Let's get actual resolution to make a smart guess.
  const sizeOutput = await runAdb(`-s ${deviceId} shell wm size`);
  const sizeMatch = sizeOutput.match(/Physical size:\s+(\d+)x(\d+)/);
  
  let sendX = 990;
  let sendY = 1250; // default for mid screen if keyboard is open
  
  if (sizeMatch) {
    const width = parseInt(sizeMatch[1]);
    const height = parseInt(sizeMatch[2]);
    
    if (coords && coords.x && coords.y) {
      // Coords can be supplied in percentages (e.g. 0.9 for 90%)
      sendX = coords.x <= 1 ? Math.floor(width * coords.x) : coords.x;
      sendY = coords.y <= 1 ? Math.floor(height * coords.y) : coords.y;
      log(`Using user-calibrated click coordinates: X=${sendX}, Y=${sendY}`, 'info');
    } else {
      // Default guess: typical WhatsApp send button coordinates (approx 91% width, 53% height when keyboard is open, or 92% width, 90% height when keyboard is closed)
      // Usually, when opening via URL, the message is prefilled, keyboard opens automatically.
      // So the send button is right above the keyboard on the right side.
      // We default to 91% width, 55% height
      sendX = Math.floor(width * 0.91);
      sendY = Math.floor(height * 0.55);
      log(`Guessed send button coordinates: X=${sendX}, Y=${sendY} (based on ${width}x${height} screen)`, 'info');
    }
  }

  log(`Simulating click on Send button at (${sendX}, ${sendY})...`, 'info');
  await runAdb(`-s ${deviceId} shell input tap ${sendX} ${sendY}`);
  
  // Wait a beat and try coordinate tap again as backup
  await new Promise(resolve => setTimeout(resolve, 500));
  await runAdb(`-s ${deviceId} shell input tap ${sendX} ${sendY}`);

  // FEATURE 5: Intelligent Fallback — also try KEYCODE_ENTER
  // On many WhatsApp layouts, pressing Enter while the text field is focused sends the message.
  // This acts as a universal safety net regardless of screen coordinates.
  await new Promise(resolve => setTimeout(resolve, 400));
  log('Sending KEYCODE_ENTER as intelligent fallback to ensure delivery...', 'info');
  await runAdb(`-s ${deviceId} shell input keyevent 66`);
  
  log('WhatsApp message command pipeline executed with multi-fallback.', 'success');
  return true;
}

/**
 * FEATURE 3: Syncs contacts from the connected Android phone via ADB content provider.
 * Reads from contacts content provider and returns parsed name+number pairs.
 */
export async function syncPhoneContacts() {
  const devices = await getDevices();
  if (devices.length === 0) {
    throw new Error('No device connected');
  }
  const deviceId = devices[0].id;

  log('Starting phone contacts sync via ADB content provider...', 'info');

  try {
    // Query contacts using Android content provider
    const output = await runAdb(
      `-s ${deviceId} shell content query --uri content://com.android.contacts/data/phones --projection display_name:data1`
    );

    if (!output || output.includes('No result found')) {
      log('No contacts found on the device.', 'warning');
      return [];
    }

    const lines = output.split('\n').filter(line => line.trim().startsWith('Row:'));
    const contacts = [];
    const seen = new Set();

    for (const line of lines) {
      // Each line looks like: Row: 0 display_name=John, data1=+919876543210
      const nameMatch = line.match(/display_name=([^,]+)/);
      const numberMatch = line.match(/data1=([^,\s]+)/);

      if (nameMatch && numberMatch) {
        const name = nameMatch[1].trim();
        let number = numberMatch[1].trim().replace(/[^0-9+]/g, '');
        
        // Skip empty entries
        if (!name || !number || name === 'NULL' || number === 'NULL') continue;
        
        // Remove leading + and country code normalization
        if (number.startsWith('+')) {
          number = number.substring(1); // Remove + sign
        }
        if (number.startsWith('91') && number.length === 12) {
          number = number.substring(2); // Strip Indian country code for storage
        }
        
        // Deduplicate by name+number
        const key = `${name.toLowerCase()}_${number}`;
        if (!seen.has(key)) {
          seen.add(key);
          contacts.push({
            id: `phone_${Date.now()}_${contacts.length}`,
            name,
            number
          });
        }
      }
    }

    log(`Successfully synced ${contacts.length} contacts from device.`, 'success');
    return contacts;
  } catch (error) {
    log(`Contact sync failed: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * FEATURE 4: Enables ADB-over-WiFi (Wireless Mode).
 * After enabling, the phone can be controlled without USB cable.
 */
export async function enableWirelessAdb() {
  const devices = await getDevices();
  if (devices.length === 0) {
    throw new Error('No device connected via USB. Connect USB first to enable wireless.');
  }
  const deviceId = devices[0].id;

  log('Enabling wireless ADB mode...', 'info');

  try {
    // 1. Get phone's Wi-Fi IP address
    const ipOutput = await runAdb(`-s ${deviceId} shell ip route`);
    const ipMatch = ipOutput.match(/src\s+(\d+\.\d+\.\d+\.\d+)/);
    
    if (!ipMatch) {
      throw new Error('Could not determine device Wi-Fi IP address. Ensure phone is connected to WiFi.');
    }
    const phoneIp = ipMatch[1];
    log(`Device Wi-Fi IP detected: ${phoneIp}`, 'info');

    // 2. Switch ADB to TCP/IP mode on port 5555
    log('Switching ADB transport to TCP/IP on port 5555...', 'info');
    await runAdb(`-s ${deviceId} tcpip 5555`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Connect to device wirelessly
    log(`Connecting to ${phoneIp}:5555 wirelessly...`, 'info');
    const connectResult = await runAdb(`connect ${phoneIp}:5555`);
    log(`Wireless connection result: ${connectResult}`, 'success');

    if (connectResult.includes('connected') || connectResult.includes('already connected')) {
      log(`Wireless ADB activated successfully! You can now remove the USB cable.`, 'success');
      return { success: true, ip: phoneIp, port: 5555 };
    } else {
      throw new Error(`Connection response: ${connectResult}`);
    }
  } catch (error) {
    log(`Wireless ADB setup failed: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Disables wireless ADB and reverts to USB transport.
 */
export async function disableWirelessAdb() {
  log('Disabling wireless ADB mode, reverting to USB transport...', 'info');
  try {
    await runAdb('disconnect');
    log('All wireless connections disconnected. Reverting to USB.', 'success');
    return { success: true };
  } catch (error) {
    log(`Failed to disconnect wireless: ${error.message}`, 'warning');
    return { success: false, error: error.message };
  }
}

// ========================================================================
// EXTENDED DEVICE CONTROL COMMANDS
// ========================================================================

async function getFirstDevice() {
  const devices = await getDevices();
  if (devices.length === 0) throw new Error('No device connected');
  return devices[0].id;
}

/** Volume Up */
export async function volumeUp() {
  const id = await getFirstDevice();
  log('Increasing volume...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_VOLUME_UP`);
  await runAdb(`-s ${id} shell input keyevent KEYCODE_VOLUME_UP`);
  await runAdb(`-s ${id} shell input keyevent KEYCODE_VOLUME_UP`);
  log('Volume increased.', 'success');
}

/** Volume Down */
export async function volumeDown() {
  const id = await getFirstDevice();
  log('Decreasing volume...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_VOLUME_DOWN`);
  await runAdb(`-s ${id} shell input keyevent KEYCODE_VOLUME_DOWN`);
  await runAdb(`-s ${id} shell input keyevent KEYCODE_VOLUME_DOWN`);
  log('Volume decreased.', 'success');
}

/** Volume Mute Toggle */
export async function volumeMute() {
  const id = await getFirstDevice();
  log('Toggling mute...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_VOLUME_MUTE`);
  log('Volume mute toggled.', 'success');
}

/** Set Screen Brightness (0-255) */
export async function setBrightness(level) {
  const id = await getFirstDevice();
  const val = Math.max(0, Math.min(255, parseInt(level) || 128));
  log(`Setting screen brightness to ${val}/255...`, 'info');
  await runAdb(`-s ${id} shell settings put system screen_brightness_mode 0`);
  await runAdb(`-s ${id} shell settings put system screen_brightness ${val}`);
  log(`Brightness set to ${val}.`, 'success');
}

/** Toggle Flashlight/Torch */
export async function toggleFlashlight(state) {
  const id = await getFirstDevice();
  const onOff = state ? 'true' : 'false';
  log(`Setting flashlight: ${state ? 'ON' : 'OFF'}...`, 'info');
  try {
    await runAdb(`-s ${id} shell cmd statusbar expand-settings`);
    await new Promise(r => setTimeout(r, 500));
    // Flashlight shell cmd (Android 6+)
    await runAdb(`-s ${id} shell "service call SurfaceFlinger 1015 i32 ${state ? 1 : 0}"`);
    log(`Flashlight ${state ? 'enabled' : 'disabled'}.`, 'success');
  } catch (e) {
    // Alternative: Use keyevent or shell cmd
    log(`Flashlight toggle via keyevent fallback...`, 'warning');
    await runAdb(`-s ${id} shell input keyevent KEYCODE_HOME`);
  }
}

/** Open a specific app by package name or common name */
export async function openApp(appName) {
  const id = await getFirstDevice();
  
  // Map common names to package names
  const appMap = {
    'camera': 'com.android.camera',
    'gallery': 'com.google.android.apps.photos',
    'photos': 'com.google.android.apps.photos',
    'settings': 'com.android.settings',
    'chrome': 'com.android.chrome',
    'youtube': 'com.google.android.youtube',
    'maps': 'com.google.android.apps.maps',
    'gmail': 'com.google.android.gm',
    'calculator': 'com.google.android.calculator',
    'clock': 'com.google.android.deskclock',
    'calendar': 'com.google.android.calendar',
    'whatsapp': 'com.whatsapp',
    'instagram': 'com.instagram.android',
    'facebook': 'com.facebook.katana',
    'twitter': 'com.twitter.android',
    'spotify': 'com.spotify.music',
    'telegram': 'org.telegram.messenger',
    'netflix': 'com.netflix.mediaclient',
    'phone': 'com.android.dialer',
    'contacts': 'com.android.contacts',
    'messages': 'com.google.android.apps.messaging',
    'files': 'com.google.android.documentsui',
    'play store': 'com.android.vending',
    'music': 'com.google.android.music'
  };

  const pkg = appMap[appName.toLowerCase()] || appName;
  log(`Opening app: ${appName} (${pkg})...`, 'info');
  
  try {
    await runAdb(`-s ${id} shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
    log(`App "${appName}" launched successfully.`, 'success');
  } catch (error) {
    log(`Failed to open ${appName}. Trying alternative launch...`, 'warning');
    try {
      await runAdb(`-s ${id} shell am start -n ${pkg}/.MainActivity`);
    } catch (e2) {
      throw new Error(`App "${appName}" could not be found or launched.`);
    }
  }
}

/** Open a URL in default browser */
export async function openUrl(url) {
  const id = await getFirstDevice();
  let fullUrl = url;
  if (!fullUrl.startsWith('http')) fullUrl = 'https://' + fullUrl;
  log(`Opening URL: ${fullUrl}...`, 'info');
  await runAdb(`-s ${id} shell am start -a android.intent.action.VIEW -d "${fullUrl}"`);
  log(`URL opened in browser.`, 'success');
}

/** Toggle WiFi on/off */
export async function toggleWifi(enable) {
  const id = await getFirstDevice();
  const state = enable ? 'enable' : 'disable';
  log(`Turning WiFi ${state}...`, 'info');
  await runAdb(`-s ${id} shell svc wifi ${state}`);
  log(`WiFi ${state}d.`, 'success');
}

/** Toggle Bluetooth on/off */
export async function toggleBluetooth(enable) {
  const id = await getFirstDevice();
  const state = enable ? 'enable' : 'disable';
  log(`Turning Bluetooth ${state}...`, 'info');
  try {
    await runAdb(`-s ${id} shell am start -a android.bluetooth.adapter.action.REQUEST_${enable ? 'ENABLE' : 'DISABLE'}`);
    log(`Bluetooth ${state} request sent.`, 'success');
  } catch (e) {
    await runAdb(`-s ${id} shell svc bluetooth ${state}`);
    log(`Bluetooth ${state}d.`, 'success');
  }
}

/** Take a photo using the camera */
export async function takePhoto() {
  const id = await getFirstDevice();
  log('Opening camera and capturing photo...', 'info');
  await runAdb(`-s ${id} shell am start -a android.media.action.STILL_IMAGE_CAMERA`);
  await new Promise(r => setTimeout(r, 2500));
  // Simulate shutter press
  await runAdb(`-s ${id} shell input keyevent KEYCODE_CAMERA`);
  await new Promise(r => setTimeout(r, 500));
  await runAdb(`-s ${id} shell input keyevent KEYCODE_FOCUS`);
  await runAdb(`-s ${id} shell input keyevent KEYCODE_CAMERA`);
  log('Photo captured!', 'success');
}

/** Play/Pause media */
export async function mediaPlayPause() {
  const id = await getFirstDevice();
  log('Toggling media play/pause...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE`);
  log('Media play/pause toggled.', 'success');
}

/** Next Track */
export async function mediaNext() {
  const id = await getFirstDevice();
  log('Skipping to next track...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_MEDIA_NEXT`);
  log('Next track.', 'success');
}

/** Previous Track */
export async function mediaPrevious() {
  const id = await getFirstDevice();
  log('Going to previous track...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_MEDIA_PREVIOUS`);
  log('Previous track.', 'success');
}

/** Press Home button */
export async function pressHome() {
  const id = await getFirstDevice();
  log('Pressing HOME button...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_HOME`);
  log('Home screen activated.', 'success');
}

/** Press Back button */
export async function pressBack() {
  const id = await getFirstDevice();
  log('Pressing BACK button...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_BACK`);
  log('Back pressed.', 'success');
}

/** Open recent apps */
export async function openRecents() {
  const id = await getFirstDevice();
  log('Opening recent apps...', 'info');
  await runAdb(`-s ${id} shell input keyevent KEYCODE_APP_SWITCH`);
  log('Recent apps opened.', 'success');
}

/** Open notification shade */
export async function openNotifications() {
  const id = await getFirstDevice();
  log('Pulling down notification shade...', 'info');
  await runAdb(`-s ${id} shell cmd statusbar expand-notifications`);
  log('Notification shade opened.', 'success');
}

/** Type text on the phone */
export async function typeText(text) {
  const id = await getFirstDevice();
  // Escape special shell characters
  const escaped = text.replace(/ /g, '%s').replace(/'/g, "\\'");
  log(`Typing text: "${text}"...`, 'info');
  await runAdb(`-s ${id} shell input text "${escaped}"`);
  log('Text typed on device.', 'success');
}
