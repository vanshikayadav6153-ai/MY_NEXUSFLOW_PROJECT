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

export async function readSmsInbox(limit = 50) {
  try {
    const { stdout } = await execAsync(
      `${ADB} shell "content query --uri content://sms/inbox --projection address:body:date:read --sort 'date DESC' --limit ${limit} 2>/dev/null"`,
      { timeout: 15000 }
    );

    const messages = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      if (!line.includes('Row:')) continue;

      const addressMatch = line.match(/address=(.*?),/);
      const bodyMatch = line.match(/body=(.*?),/);
      const dateMatch = line.match(/date=(\d+)/);
      const readMatch = line.match(/read=(\d)/);

      if (addressMatch) {
        messages.push({
          from: addressMatch[1]?.trim() || 'Unknown',
          body: bodyMatch?.[1]?.trim() || '',
          date: dateMatch ? new Date(parseInt(dateMatch[1])).toISOString() : null,
          timestamp: dateMatch ? parseInt(dateMatch[1]) : 0,
          read: readMatch?.[1] === '1'
        });
      }
    }

    return { success: true, messages, total: messages.length };
  } catch (error) {
    return { success: false, error: error.message, messages: [] };
  }
}

export async function readSmsSent(limit = 20) {
  try {
    const { stdout } = await execAsync(
      `${ADB} shell "content query --uri content://sms/sent --projection address:body:date --sort 'date DESC' --limit ${limit} 2>/dev/null"`,
      { timeout: 15000 }
    );

    const messages = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      if (!line.includes('Row:')) continue;

      const addressMatch = line.match(/address=(.*?),/);
      const bodyMatch = line.match(/body=(.*?),/);
      const dateMatch = line.match(/date=(\d+)/);

      if (addressMatch) {
        messages.push({
          to: addressMatch[1]?.trim() || 'Unknown',
          body: bodyMatch?.[1]?.trim() || '',
          date: dateMatch ? new Date(parseInt(dateMatch[1])).toISOString() : null,
          timestamp: dateMatch ? parseInt(dateMatch[1]) : 0
        });
      }
    }

    return { success: true, messages, total: messages.length };
  } catch (error) {
    return { success: false, error: error.message, messages: [] };
  }
}

export async function readCallLog(limit = 50) {
  try {
    const { stdout } = await execAsync(
      `${ADB} shell "content query --uri content://call_log/calls --projection number:name:date:duration:type --sort 'date DESC' --limit ${limit} 2>/dev/null"`,
      { timeout: 15000 }
    );

    const calls = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      if (!line.includes('Row:')) continue;

      const numberMatch = line.match(/number=(.*?),/);
      const nameMatch = line.match(/name=(.*?),/);
      const dateMatch = line.match(/date=(\d+)/);
      const durationMatch = line.match(/duration=(\d+)/);
      const typeMatch = line.match(/type=(\d)/);

      if (numberMatch) {
        const type = typeMatch ? parseInt(typeMatch[1]) : 0;
        const typeLabel = type === 1 ? 'incoming' : type === 2 ? 'outgoing' : type === 3 ? 'missed' : 'unknown';

        calls.push({
          number: numberMatch[1]?.trim() || 'Unknown',
          name: nameMatch?.[1]?.trim() || null,
          date: dateMatch ? new Date(parseInt(dateMatch[1])).toISOString() : null,
          timestamp: dateMatch ? parseInt(dateMatch[1]) : 0,
          duration: durationMatch ? parseInt(durationMatch[1]) : 0,
          durationFormatted: formatDuration(durationMatch ? parseInt(durationMatch[1]) : 0),
          type: typeLabel
        });
      }
    }

    return { success: true, calls, total: calls.length };
  } catch (error) {
    return { success: false, error: error.message, calls: [] };
  }
}

export async function sendSms(number, message) {
  try {
    const escaped = message.replace(/'/g, "'\\''");
    await execAsync(
      `${ADB} shell "am start -a android.intent.action.SENDTO -d sms:${number} --es sms_body '${escaped}' --ez exit_on_sent true"`,
      { timeout: 10000 }
    );

    await new Promise(resolve => setTimeout(resolve, 2000));

    return {
      success: true,
      message: `SMS compose opened for ${number}. Message pre-filled.`
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function formatDuration(seconds) {
  if (seconds === 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}
