import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAdbPath() {
  const localAdb = path.join(__dirname, 'bin', 'platform-tools', 'adb.exe');
  if (fs.existsSync(localAdb)) return `"${localAdb}"`;
  return 'adb';
}

const ADB = getAdbPath();

export async function getPhoneClipboard() {
  try {

    const { stdout } = await execAsync(
      `${ADB} shell "am broadcast -a clipper.get 2>/dev/null || settings get secure clipboard_text 2>/dev/null || echo ''"`,
      { timeout: 5000 }
    );

    let clipText = stdout.trim();

    if (!clipText || clipText === '') {
      try {
        const { stdout: dumpOut } = await execAsync(
          `${ADB} shell "dumpsys clipboard 2>/dev/null | head -20"`,
          { timeout: 5000 }
        );
        const match = dumpOut.match(/mPrimaryClip.*?TEXT.*?\"(.*?)\"/s);
        if (match) clipText = match[1];
      } catch (e) {  }
    }

    return { success: true, text: clipText || '' };
  } catch (error) {
    return { success: false, error: error.message, text: '' };
  }
}

export async function setPhoneClipboard(text) {
  try {
    const escaped = text.replace(/'/g, "'\\''").replace(/"/g, '\\"');

    await execAsync(
      `${ADB} shell "am broadcast -a clipper.set -e text '${escaped}' 2>/dev/null; echo done"`,
      { timeout: 5000 }
    );

    return { success: true, message: `Clipboard synced to phone: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPcClipboard() {
  try {
    const { stdout } = await execAsync('powershell -command "Get-Clipboard"', { timeout: 5000 });
    return { success: true, text: stdout.trim() };
  } catch (error) {
    return { success: false, error: error.message, text: '' };
  }
}

export async function setPcClipboard(text) {
  try {
    const escaped = text.replace(/"/g, '`"').replace(/'/g, "''");
    await execAsync(`powershell -command "Set-Clipboard -Value '${escaped}'"`, { timeout: 5000 });
    return { success: true, message: 'Clipboard set on PC' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
