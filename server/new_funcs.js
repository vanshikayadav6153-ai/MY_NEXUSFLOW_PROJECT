
/** Type text on the phone */
export async function typeText(text) {
  const id = await getFirstDevice();
  // Escape special shell characters
  const escaped = text.replace(/ /g, '%s').replace(/'/g, "\\'");
  log(`Typing text: "${text}"...`, 'info');
  await runAdb(`-s ${id} shell input text "${escaped}"`);
  log('Text typed on device.', 'success');
}

// ========================================================================
// WHATSAPP INTERACTIVE PIPELINE COMMANDS
// ========================================================================

/** Open WhatsApp Chat without sending a message */
export async function openWhatsAppChat(phoneNumber) {
  const id = await getFirstDevice();
  let formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
  if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;

  log(`Opening WhatsApp Chat for ${formattedNumber}...`, 'info');
  const whatsappUrl = `whatsapp://send?phone=${formattedNumber}`;
  await runAdb(`-s ${id} shell am start -a android.intent.action.VIEW -d "${whatsappUrl}"`);
  log('WhatsApp Chat opened.', 'success');
}

/** Tap the Send Button in WhatsApp */
export async function tapWhatsAppSend() {
  const id = await getFirstDevice();
  log('Tapping WhatsApp Send button...', 'info');
  // 1. Try hitting ENTER key (works on many devices)
  await runAdb(`-s ${id} shell input keyevent 66`);
  await new Promise(r => setTimeout(r, 200));

  // 2. Try tapping coordinate (approximate Send button location with keyboard open)
  const sizeOutput = await runAdb(`-s ${id} shell wm size`);
  const sizeMatch = sizeOutput.match(/Physical size:\s+(\d+)x(\d+)/);
  if (sizeMatch) {
    const width = parseInt(sizeMatch[1]);
    const height = parseInt(sizeMatch[2]);
    const sendX = Math.floor(width * 0.91);
    const sendY = Math.floor(height * 0.55); // Keyboard takes bottom half
    await runAdb(`-s ${id} shell input tap ${sendX} ${sendY}`);
  }
  log('Message Sent trigger executed.', 'success');
}

/** Tap the Audio Call Button in WhatsApp */
export async function tapWhatsAppCall() {
  const id = await getFirstDevice();
  log('Initiating WhatsApp Audio Call using Pro-Max UI Automator...', 'info');
  
  try {
    // Dump UI hierarchy to find the exact button
    await runAdb(`-s ${id} shell uiautomator dump /sdcard/window_dump.xml`);
    const xml = await runAdb(`-s ${id} shell cat /sdcard/window_dump.xml`);
    
    // Look for the "Voice call" or "Call" button via content-desc
    const callMatch = xml.match(/node[^>]+content-desc="Voice call"[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i) ||
                      xml.match(/node[^>]+content-desc="Call"[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
                      
    if (callMatch) {
      const x1 = parseInt(callMatch[1]);
      const y1 = parseInt(callMatch[2]);
      const x2 = parseInt(callMatch[3]);
      const y2 = parseInt(callMatch[4]);
      const callX = Math.floor((x1 + x2) / 2);
      const callY = Math.floor((y1 + y2) / 2);
      
      log(`Exact Call Button found at X:${callX} Y:${callY}`, 'success');
      await runAdb(`-s ${id} shell input tap ${callX} ${callY}`);
      
      // Check for confirmation popup "Start voice call?" by taking another quick dump after 1.5 seconds
      await new Promise(r => setTimeout(r, 1500));
      await runAdb(`-s ${id} shell uiautomator dump /sdcard/window_dump_confirm.xml`);
      const confirmXml = await runAdb(`-s ${id} shell cat /sdcard/window_dump_confirm.xml`);
      
      // Look for button with text="Call"
      const confirmMatch = confirmXml.match(/node[^>]+text="Call"[^>]+class="android.widget.Button"[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
      if (confirmMatch) {
        const cx1 = parseInt(confirmMatch[1]);
        const cy1 = parseInt(confirmMatch[2]);
        const cx2 = parseInt(confirmMatch[3]);
        const cy2 = parseInt(confirmMatch[4]);
        const confirmX = Math.floor((cx1 + cx2) / 2);
        const confirmY = Math.floor((cy1 + cy2) / 2);
        log(`Confirmation popup detected! Tapping Call at X:${confirmX} Y:${confirmY}`, 'warning');
        await runAdb(`-s ${id} shell input tap ${confirmX} ${confirmY}`);
      }
      log('WhatsApp Audio Call sequence completed successfully.', 'success');
    } else {
      log('Could not find Voice call button in UI. Attempting fallback coordinates...', 'warning');
      const sizeOutput = await runAdb(`-s ${id} shell wm size`);
      const sizeMatch = sizeOutput.match(/Physical size:\s+(\d+)x(\d+)/);
      if (sizeMatch) {
        const width = parseInt(sizeMatch[1]);
        const height = parseInt(sizeMatch[2]);
        // Safe fallback coordinate (avoids hitting the bottom camera button)
        await runAdb(`-s ${id} shell input tap ${Math.floor(width * 0.83)} ${Math.floor(height * 0.07)}`);
      }
    }
  } catch (error) {
    log(`Failed to execute UI Automator call sequence: ${error.message}`, 'error');
  }
}

/** Tap the Video Call Button in WhatsApp */
export async function tapWhatsAppVideoCall() {
  const id = await getFirstDevice();
  log('Initiating WhatsApp Video Call using Pro-Max UI Automator...', 'info');
  
  try {
    await runAdb(`-s ${id} shell uiautomator dump /sdcard/window_dump.xml`);
    const xml = await runAdb(`-s ${id} shell cat /sdcard/window_dump.xml`);
    
    // Look for the "Video call" button
    const callMatch = xml.match(/node[^>]+content-desc="Video call"[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
                      
    if (callMatch) {
      const x1 = parseInt(callMatch[1]);
      const y1 = parseInt(callMatch[2]);
      const x2 = parseInt(callMatch[3]);
      const y2 = parseInt(callMatch[4]);
      const callX = Math.floor((x1 + x2) / 2);
      const callY = Math.floor((y1 + y2) / 2);
      
      log(`Exact Video Call Button found at X:${callX} Y:${callY}`, 'success');
      await runAdb(`-s ${id} shell input tap ${callX} ${callY}`);
      
      await new Promise(r => setTimeout(r, 1500));
      await runAdb(`-s ${id} shell uiautomator dump /sdcard/window_dump_confirm.xml`);
      const confirmXml = await runAdb(`-s ${id} shell cat /sdcard/window_dump_confirm.xml`);
      const confirmMatch = confirmXml.match(/node[^>]+text="Call"[^>]+class="android.widget.Button"[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
      
      if (confirmMatch) {
        const cx1 = parseInt(confirmMatch[1]);
        const cy1 = parseInt(confirmMatch[2]);
        const cx2 = parseInt(confirmMatch[3]);
        const cy2 = parseInt(confirmMatch[4]);
        const confirmX = Math.floor((cx1 + cx2) / 2);
        const confirmY = Math.floor((cy1 + cy2) / 2);
        await runAdb(`-s ${id} shell input tap ${confirmX} ${confirmY}`);
      }
      log('WhatsApp Video Call sequence completed successfully.', 'success');
    } else {
      log('Could not find Video call button in UI.', 'warning');
    }
  } catch (error) {
    log(`Failed to execute UI Automator video call sequence: ${error.message}`, 'error');
  }
}

/** Perform live in-app search in WhatsApp for a contact */
export async function searchAndOpenWhatsAppContact(contactName) {
  const id = await getFirstDevice();
  log(`Performing live UI search in WhatsApp for: "${contactName}"...`, 'info');
  
  try {
    // 1. Launch WhatsApp main screen
    await runAdb(`-s ${id} shell am start -n com.whatsapp/.Main`);
    await new Promise(r => setTimeout(r, 2000));
    
    // 2. Find Search Icon (Handles both new Meta AI search bar and old magnifying glass)
    await runAdb(`-s ${id} shell uiautomator dump /sdcard/window_dump.xml`);
    const xml = await runAdb(`-s ${id} shell cat /sdcard/window_dump.xml`);
    
    let searchMatch = xml.match(/node[^>]+resource-id="com.whatsapp:id\/search_bar_inner_layout"[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i) ||
                      xml.match(/node[^>]+content-desc="Search"[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i) ||
                      xml.match(/node[^>]+resource-id="com.whatsapp:id\/menuitem_search"[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
    
    if (!searchMatch) {
      log('Search icon not found on WhatsApp main screen.', 'error');
      return false;
    }
    
    const sx = Math.floor((parseInt(searchMatch[1]) + parseInt(searchMatch[3])) / 2);
    const sy = Math.floor((parseInt(searchMatch[2]) + parseInt(searchMatch[4])) / 2);
    await runAdb(`-s ${id} shell input tap ${sx} ${sy}`);
    await new Promise(r => setTimeout(r, 1000));
    
    // 3. Type the name
    const escapedName = contactName.replace(/ /g, '%s').replace(/'/g, "\\'");
    await runAdb(`-s ${id} shell input text "${escapedName}"`);
    await new Promise(r => setTimeout(r, 2000)); // wait for search results to load
    
    // 4. Tap the first search result (usually just below the header)
    const sizeOutput = await runAdb(`-s ${id} shell wm size`);
    const sizeMatch = sizeOutput.match(/Physical size:\s+(\d+)x(\d+)/);
    if (sizeMatch) {
      const width = parseInt(sizeMatch[1]);
      const height = parseInt(sizeMatch[2]);
      
      const firstResultX = Math.floor(width / 2);
      const firstResultY = Math.floor(height * 0.20);
      
      log(`Tapping first search result roughly at X:${firstResultX} Y:${firstResultY}`, 'info');
      await runAdb(`-s ${id} shell input tap ${firstResultX} ${firstResultY}`);
      
      await new Promise(r => setTimeout(r, 2500)); // Increased wait time to ensure chat opens fully before calling
      return true;
    }
  } catch (error) {
    log(`Live UI Search failed: ${error.message}`, 'error');
    return false;
  }
}
