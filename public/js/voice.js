// ==========================================================================
// NexusFlow Voice Processing, TTS Engine & Waveform Visualization
// ==========================================================================

// ==========================================================================
// FEATURE 2: Vani Text-to-Speech (TTS) Response Engine
// ==========================================================================

const speechSynth = window.speechSynthesis;
let vaniVoice = null;

// Load and cache best female voice for Vani
function loadVaniVoice() {
  const voices = speechSynth.getVoices();
  // Prefer Indian English female, then any English female, then default
  vaniVoice = voices.find(v => v.lang.includes('en-IN') && v.name.toLowerCase().includes('female')) ||
              voices.find(v => v.lang.includes('en-IN')) ||
              voices.find(v => v.lang.includes('en') && v.name.toLowerCase().includes('female')) ||
              voices.find(v => v.lang.includes('en-GB')) ||
              voices.find(v => v.lang.includes('en-US')) ||
              voices[0] || null;
  
  if (vaniVoice) {
    console.log(`[VANI TTS] Voice loaded: ${vaniVoice.name} (${vaniVoice.lang})`);
  }
}

// Voices load asynchronously in some browsers
if (speechSynth.onvoiceschanged !== undefined) {
  speechSynth.onvoiceschanged = loadVaniVoice;
}
loadVaniVoice();

/**
 * Vani speaks the given text aloud using browser TTS.
 * Exposed globally so app.js can call it on pipeline events.
 */
function vaniSpeak(text) {
  if (!speechSynth || !text) return;
  
  // Cancel any ongoing speech first
  speechSynth.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.1;
  utterance.volume = 1.0;
  
  if (vaniVoice) {
    utterance.voice = vaniVoice;
  }
  
  utterance.onstart = () => {
    if (typeof appendTerminalLine === 'function') {
      appendTerminalLine(`[VANI TTS] Speaking: "${text}"`, 'adb-info');
    }
  };
  
  speechSynth.speak(utterance);
}

// Expose globally for app.js to use
window.vaniSpeak = vaniSpeak;

const btnVoiceTrigger = document.getElementById('btn-voice-trigger');
const waveformWrapper = document.getElementById('waveform-wrapper');
const voiceCanvas = document.getElementById('voice-canvas');
const cmdInput = document.getElementById('cmd-text-input');
const canvasCtx = voiceCanvas.getContext('2d');

let SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

// Audio Visualizer states
let audioCtx = null;
let analyser = null;
let microphone = null;
let javascriptNode = null;
let animationFrameId = null;
let isMicAccessGranted = false;
let wavePhase = 0; // Phase for fallback animation

// Initialize Speech Recognition if supported
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  // Use en-IN (Indian English) for much better Hinglish / English command detection
  recognition.lang = 'en-IN'; 

  recognition.onstart = () => {
    isListening = true;
    btnVoiceTrigger.classList.add('active');
    waveformWrapper.classList.remove('hidden');
    
    // Start canvas visualizer
    startAudioVisualizer();
    if (typeof appendTerminalLine === 'function') {
      appendTerminalLine('[SPEECH] Microphone active. Speak command now...', 'system');
    }
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (typeof appendTerminalLine === 'function') {
      appendTerminalLine(`[SPEECH] Voice Captured: "${transcript}"`, 'adb-info');
    }
    
    // Put transcript into text box and auto-submit
    cmdInput.value = transcript;
    if (typeof submitCommand === 'function') {
      submitCommand();
    }
  };

  recognition.onerror = (event) => {
    if (typeof appendTerminalLine === 'function') {
      appendTerminalLine(`[SPEECH] Recognition error: ${event.error}`, 'adb-error');
    }
    stopListeningState();
  };

  recognition.onend = () => {
    stopListeningState();
  };
} else {
  btnVoiceTrigger.style.display = 'none';
  console.warn('SpeechRecognition is not supported in this browser.');
}

// Voice Trigger Click
btnVoiceTrigger.addEventListener('click', () => {
  if (!recognition) return;

  if (isListening) {
    recognition.stop();
  } else {
    try {
      recognition.start();
    } catch (e) {
      console.error(e);
      stopListeningState();
    }
  }
});

function stopListeningState() {
  isListening = false;
  btnVoiceTrigger.classList.remove('active');
  waveformWrapper.classList.add('hidden');
  stopAudioVisualizer();
}

// ==========================================================================
// Canvas Waveform Visualizer Logic
// ==========================================================================

async function startAudioVisualizer() {
  // If analyser not yet initialized, request mic
  if (!audioCtx) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      isMicAccessGranted = true;
      
      // Setup Web Audio API
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      
      microphone = audioCtx.createMediaStreamSource(stream);
      microphone.connect(analyser);
    } catch (err) {
      console.warn('Microphone stream access denied. Falling back to synthetic visualizer wave.', err);
      isMicAccessGranted = false;
    }
  }

  // Resume context if suspended (browser security autoplay policies)
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  // Launch render loop
  drawWaveform();
}

function stopAudioVisualizer() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function drawWaveform() {
  animationFrameId = requestAnimationFrame(drawWaveform);

  const width = voiceCanvas.width;
  const height = voiceCanvas.height;

  // Clear canvas with dark glass gradient overlay
  canvasCtx.fillStyle = 'rgba(5, 8, 20, 0.2)';
  canvasCtx.fillRect(0, 0, width, height);

  if (isMicAccessGranted && analyser) {
    // 1. Draw Real Mic input wave
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
    canvasCtx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0; // scale value
      const y = (v * height) / 2;

      // Make it symmetric and centered
      const centerOff = height / 2;
      const waveVal = y - centerOff;

      if (i === 0) {
        canvasCtx.moveTo(x, centerOff + waveVal);
      } else {
        canvasCtx.lineTo(x, centerOff + waveVal);
      }

      x += sliceWidth;
    }

    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();

    // Draw secondary symmetric wave for visual punch (purple)
    canvasCtx.strokeStyle = 'rgba(189, 0, 255, 0.4)';
    canvasCtx.beginPath();
    x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;
      const centerOff = height / 2;
      const waveVal = y - centerOff;

      if (i === 0) {
        canvasCtx.moveTo(x, centerOff - waveVal);
      } else {
        canvasCtx.lineTo(x, centerOff - waveVal);
      }
      x += sliceWidth;
    }
    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();

  } else {
    // 2. Draw Synthetic Cyber Wave (Mock fallback)
    canvasCtx.lineWidth = 1.5;
    
    // Wave 1: Cyan
    canvasCtx.strokeStyle = 'rgba(0, 240, 255, 0.85)';
    canvasCtx.beginPath();
    wavePhase += 0.15;
    
    for (let x = 0; x < width; x++) {
      const angle = (x / width) * Math.PI * 6 + wavePhase;
      // Fade amplitude near edges
      const edgeScale = Math.sin((x / width) * Math.PI);
      const y = (height / 2) + Math.sin(angle) * 15 * edgeScale;
      
      if (x === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
    }
    canvasCtx.stroke();

    // Wave 2: Purple (Slightly slower and out of phase)
    canvasCtx.strokeStyle = 'rgba(189, 0, 255, 0.6)';
    canvasCtx.beginPath();
    for (let x = 0; x < width; x++) {
      const angle = (x / width) * Math.PI * 4 - wavePhase * 0.8;
      const edgeScale = Math.sin((x / width) * Math.PI);
      const y = (height / 2) + Math.sin(angle) * 10 * edgeScale;
      
      if (x === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
    }
    canvasCtx.stroke();
  }
}
