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

let cameraFeedInterval = null;
let cameraCallback = null;

export async function launchCamera(facing = 'back') {
  try {

    await execAsync(`${ADB} shell am force-stop com.android.camera2 2>/dev/null; ${ADB} shell am force-stop com.android.camera 2>/dev/null`, { timeout: 5000 });

    const facingId = facing === 'front' ? 1 : 0;
    await execAsync(
      `${ADB} shell "am start -a android.media.action.STILL_IMAGE_CAMERA --ei android.intent.extras.CAMERA_FACING ${facingId}"`,
      { timeout: 5000 }
    );

    await new Promise(resolve => setTimeout(resolve, 2000));

    return { success: true, facing, message: `Camera launched (${facing})` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function captureCameraFrame() {
  try {
    const tempPath = path.join(__dirname, '../public/camera_frame.png');
    await execAsync(`${ADB} exec-out screencap -p > "${tempPath}"`, { timeout: 10000 });

    if (fs.existsSync(tempPath)) {
      const data = fs.readFileSync(tempPath);
      const base64 = data.toString('base64');
      try { fs.unlinkSync(tempPath); } catch (e) {  }
      return { success: true, frame: base64 };
    }

    throw new Error('Failed to capture camera frame');
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function startCameraFeed(fps = 2, onFrame) {
  stopCameraFeed();

  const interval = Math.floor(1000 / Math.max(1, Math.min(5, fps)));
  cameraCallback = onFrame;
  let isCapturing = false;

  cameraFeedInterval = setInterval(async () => {
    if (isCapturing) return;
    isCapturing = true;

    try {
      const result = await captureCameraFrame();
      if (result.success && cameraCallback) {
        cameraCallback(result.frame);
      }
    } catch (e) {  }
    finally { isCapturing = false; }
  }, interval);

  return { success: true, fps };
}

export function stopCameraFeed() {
  if (cameraFeedInterval) {
    clearInterval(cameraFeedInterval);
    cameraFeedInterval = null;
    cameraCallback = null;
  }
  return { success: true };
}

export function isCameraFeedActive() {
  return cameraFeedInterval !== null;
}

export async function capturePhoto() {
  try {

    await execAsync(`${ADB} shell input keyevent 27`, { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    return { success: true, message: 'Photo captured via camera shutter' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function switchCamera() {
  try {

    await execAsync(`${ADB} shell input keyevent 175 2>/dev/null || echo done`, { timeout: 5000 });
    return { success: true, message: 'Camera switched' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
