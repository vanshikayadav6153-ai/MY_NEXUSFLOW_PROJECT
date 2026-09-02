import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAdbPath() {
  const localAdb = path.join(__dirname, 'bin', 'platform-tools', 'adb.exe');
  if (fs.existsSync(localAdb)) return localAdb;
  return 'adb';
}

function normalizePhonePath(value, { allowSdcardRoot = true } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw new Error('A valid phone path is required');
  }

  if (value.includes('\0') || value.includes('\\')) {
    throw new Error('Invalid phone path');
  }

  const normalized = path.posix.normalize(value.trim());
  const isSdcard = normalized === '/sdcard';
  const isInsideSdcard = normalized.startsWith('/sdcard/');

  if ((!allowSdcardRoot && isSdcard) || (!isSdcard && !isInsideSdcard)) {
    throw new Error('File manager access is limited to /sdcard');
  }

  return normalized;
}

function safePhoneFileName(phonePath) {
  const name = path.posix.basename(phonePath);
  if (!name || name === '.' || name === '..' || name.length > 255) {
    throw new Error('Invalid file name');
  }
  return name;
}

export async function listPhoneFiles(phonePath = '/sdcard') {
  try {
    const safePath = normalizePhonePath(phonePath);
    const { stdout } = await execFileAsync(getAdbPath(), ['shell', 'ls', '-la', '--', safePath], { timeout: 10000 });
    const lines = stdout.trim().split('\n');
    const files = [];

    for (const line of lines) {
      if (line.startsWith('total') || !line.trim()) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) continue;

      const permissions = parts[0];
      const isDirectory = permissions.startsWith('d');
      const isLink = permissions.startsWith('l');
      const size = parseInt(parts[4]) || 0;

      let name = parts.slice(7).join(' ');

      if (isLink && name.includes(' -> ')) {
        name = name.split(' -> ')[0];
      }

      if (name === '.' || name === '..') continue;

      const ext = isDirectory ? 'folder' : path.extname(name).toLowerCase().replace('.', '') || 'file';

      files.push({
        name,
        path: `${safePath}/${name}`,
        isDirectory,
        isLink,
        size,
        permissions,
        ext,
        sizeFormatted: formatFileSize(size)
      });
    }

    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return { success: true, files, currentPath: safePath };
  } catch (error) {
    return { success: false, error: error.message, files: [], currentPath: phonePath };
  }
}

export async function pullFileFromPhone(phonePath, destDir) {
  try {
    const safePhonePath = normalizePhonePath(phonePath, { allowSdcardRoot: false });
    const fileName = safePhoneFileName(safePhonePath);
    const destPath = path.join(destDir, fileName);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const { stderr } = await execFileAsync(getAdbPath(), ['pull', safePhonePath, destPath], { timeout: 120000 });

    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      return {
        success: true,
        fileName,
        localPath: destPath,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        message: `Successfully pulled ${fileName} (${formatFileSize(stats.size)})`
      };
    }

    throw new Error(stderr || 'File was not created on PC');
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function pushFileToPhone(localPath, phoneDest = '/sdcard/Download') {
  try {
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }

    const fileName = path.basename(localPath);
    const safeDestination = normalizePhonePath(phoneDest);
    const fullPhoneDest = path.posix.join(safeDestination, fileName);

    await execFileAsync(getAdbPath(), ['push', localPath, fullPhoneDest], { timeout: 120000 });

    await execFileAsync(getAdbPath(), ['shell', 'ls', '-la', '--', fullPhoneDest], { timeout: 5000 });

    const stats = fs.statSync(localPath);
    return {
      success: true,
      fileName,
      phonePath: fullPhoneDest,
      size: stats.size,
      sizeFormatted: formatFileSize(stats.size),
      message: `Successfully pushed ${fileName} to ${safeDestination}`
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deletePhoneFile(phonePath, isDirectory = false) {
  try {
    const safePath = normalizePhonePath(phonePath, { allowSdcardRoot: false });

    await execFileAsync(
      getAdbPath(),
      ['shell', 'rm', isDirectory ? '-rf' : '-f', '--', safePath],
      { timeout: 15000 }
    );

    return {
      success: true,
      message: `Deleted: ${path.posix.basename(safePath)}`
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createPhoneDirectory(phonePath) {
  try {
    const safePath = normalizePhonePath(phonePath, { allowSdcardRoot: false });
    await execFileAsync(getAdbPath(), ['shell', 'mkdir', '-p', '--', safePath], { timeout: 5000 });
    return { success: true, message: `Created directory: ${safePath}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getStorageInfo() {
  try {
    const { stdout } = await execFileAsync(getAdbPath(), ['shell', 'df', '/sdcard'], { timeout: 5000 });
    const lines = stdout.trim().split('\n');

    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      const total = parseInt(parts[1]) * 1024;
      const used = parseInt(parts[2]) * 1024;
      const available = parseInt(parts[3]) * 1024;
      const usePercent = parts[4];

      return {
        success: true,
        total: formatFileSize(total),
        used: formatFileSize(used),
        available: formatFileSize(available),
        usePercent,
        totalBytes: total,
        usedBytes: used,
        availableBytes: available
      };
    }

    throw new Error('Could not parse storage info');
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export function getFileTypeIcon(ext) {
  const icons = {
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', bmp: '🖼️',
    mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', webm: '🎬', '3gp': '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵', m4a: '🎵',
    pdf: '📄', doc: '📝', docx: '📝', txt: '📝', rtf: '📝',
    xls: '📊', xlsx: '📊', csv: '📊',
    ppt: '📊', pptx: '📊',
    js: '💻', py: '💻', html: '💻', css: '💻', json: '💻', xml: '💻',
    zip: '📦', rar: '📦', tar: '📦', gz: '📦', '7z': '📦',
    apk: '📱', aab: '📱',
    folder: '📁',
    file: '📄'
  };
  return icons[ext] || '📄';
}
