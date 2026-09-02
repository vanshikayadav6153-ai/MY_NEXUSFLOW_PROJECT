const speechSynth = window.speechSynthesis;
let vaniVoice = null;

function loadVaniVoice() {
  const voices = speechSynth.getVoices();
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

if (speechSynth.onvoiceschanged !== undefined) {
  speechSynth.onvoiceschanged = loadVaniVoice;
}
loadVaniVoice();

function vaniSpeak(text) {
  if (!speechSynth || !text) return;

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

window.vaniSpeak = vaniSpeak;

const btnVoiceTrigger = document.getElementById('btn-voice-trigger');
const btnSttLang = document.getElementById('btn-stt-lang');
const waveformWrapper = document.getElementById('waveform-wrapper');
const voiceCanvas = document.getElementById('voice-canvas');
const cmdInput = document.getElementById('cmd-text-input');
const canvasCtx = voiceCanvas.getContext('2d');

let SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
let recognition = null;
let isListening = false;

const STT_LANGS = ['hi-IN', 'en-IN'];
function getSttLang() {
  try {
    const v = localStorage.getItem('nx_stt_lang');
    return STT_LANGS.includes(v) ? v : 'hi-IN';
  } catch { return 'hi-IN'; }
}
function setSttLang(lang) {
  try { localStorage.setItem('nx_stt_lang', lang); } catch {  }
  if (recognition) recognition.lang = lang;
  if (btnSttLang) btnSttLang.textContent = lang === 'hi-IN' ? 'हिं' : 'EN';
}
let sttLang = getSttLang();

let lastAlternatives = [];
let settleTimer = null;
let watchdogTimer = null;
let restartPending = false;
const SETTLE_MS = 1200;
const WATCHDOG_MS = 12000;
let autoSend = true;

function clearTimers() {
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

function submitSettled() {
  clearTimers();
  const text = cmdInput.value.trim();
  if (!text) return;
  if (typeof submitCommand === 'function') {
    submitCommand({ alternatives: lastAlternatives.slice(0, 5), source: 'voice', lang: sttLang });
  }
  lastAlternatives = [];
  forceStop = true;
  try { recognition.stop(); } catch {  }
  setTimeout(() => stopListeningState(), 400);
}

let audioCtx = null;
let analyser = null;
let microphone = null;
let javascriptNode = null;
let animationFrameId = null;
let isMicAccessGranted = false;
let wavePhase = 0;

let forceStop = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;
  recognition.lang = sttLang;

  try {
    if (SpeechGrammarList) {
      const names = (window.contactsData || []).map((c) => (c.name || '').toLowerCase()).filter(Boolean);
      const verbs = ['vani', 'call', 'whatsapp', 'message', 'flashlight', 'torch', 'volume', 'brightness',
        'photo', 'unlock', 'shutdown', 'open', 'play', 'pause', 'next', 'previous', 'home', 'back', 'screenshot'];
      const terms = [...new Set([...verbs, ...names])].join(' | ');
      if (terms) {
        const gl = new SpeechGrammarList();
        gl.addFromString(`#JSGF V1.0; grammar cmd; public <cmd> = ${terms} ;`, 1);
        recognition.grammars = gl;
      }
    }
  } catch {  }

  recognition.onstart = () => {
    isListening = true;
    forceStop = false;
    restartPending = false;
    btnVoiceTrigger.classList.add('active');
    waveformWrapper.classList.remove('hidden');
    startAudioVisualizer();
    clearTimers();
    watchdogTimer = setTimeout(() => {
      if (typeof appendTerminalLine === 'function') appendTerminalLine('[SPEECH] No speech detected - stopped listening.', 'adb-debug');
      forceStop = true;
      try { recognition.stop(); } catch {  }
    }, WATCHDOG_MS);
    if (typeof appendTerminalLine === 'function') {
      appendTerminalLine(`[SPEECH] Listening (${sttLang}). Speak your command...`, 'system');
    }
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const result = event.results[i];
      if (result.isFinal) {
        const alts = [];
        for (let j = 0; j < result.length; j++) {
          const t = (result[j].transcript || '').trim();
          if (t) alts.push(t);
        }
        if (alts.length) {
          lastAlternatives = alts;
          cmdInput.value = alts[0];
          if (typeof appendTerminalLine === 'function') {
            const extra = alts.length > 1 ? ` (+${alts.length - 1} alt)` : '';
            appendTerminalLine(`[SPEECH] Heard: "${alts[0]}"${extra}`, 'adb-success');
          }
          if (autoSend) {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(submitSettled, SETTLE_MS);
          }
        }
      } else {
        interimTranscript += result[0].transcript;
      }
    }

    if (interimTranscript) {
      cmdInput.value = interimTranscript;
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = setTimeout(submitSettled, SETTLE_MS); }
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') {
      if (typeof appendTerminalLine === 'function') appendTerminalLine(`[SPEECH] ${event.error}`, 'adb-debug');
      return;
    }
    if (typeof appendTerminalLine === 'function') {
      appendTerminalLine(`[SPEECH ERROR] ${event.error}`, 'warning');
    }
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'network') {
      forceStop = true;
      clearTimers();
      stopListeningState();
    }
  };

  recognition.onend = () => {
    if (!forceStop && isListening && !settleTimer && !restartPending) {
      restartPending = true;
      setTimeout(() => {
        restartPending = false;
        if (!forceStop && isListening) {
          try { recognition.start(); } catch { stopListeningState(); }
        }
      }, 250);
    } else if (forceStop || !isListening) {
      stopListeningState();
    }
  };
} else {
  btnVoiceTrigger.style.display = 'none';
  if (btnSttLang) btnSttLang.style.display = 'none';
  console.warn('SpeechRecognition is not supported in this browser.');
}

if (btnSttLang) {
  btnSttLang.textContent = sttLang === 'hi-IN' ? 'हिं' : 'EN';
  btnSttLang.addEventListener('click', () => {
    sttLang = sttLang === 'hi-IN' ? 'en-IN' : 'hi-IN';
    setSttLang(sttLang);
    if (isListening) {
      forceStop = true;
      try { recognition.stop(); } catch {  }
      setTimeout(() => { forceStop = false; try { recognition.start(); } catch {  } }, 300);
    }
    if (typeof appendTerminalLine === 'function') {
      appendTerminalLine(`[SPEECH] Recognition language -> ${sttLang}`, 'system');
    }
  });
}

cmdInput.addEventListener('input', () => {
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
});

btnVoiceTrigger.addEventListener('click', () => {
  if (!recognition) return;

  if (isListening) {
    forceStop = true;
    clearTimeout(settleTimer); settleTimer = null;
    if (autoSend && cmdInput.value.trim() && lastAlternatives.length) {
      submitSettled();
    } else {
      try { recognition.stop(); } catch {  }
    }
  } else {
    forceStop = false;
    lastAlternatives = [];
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
  forceStop = true;
  clearTimers();
  btnVoiceTrigger.classList.remove('active');
  waveformWrapper.classList.add('hidden');
  stopAudioVisualizer();
  if (cmdInput.value && !cmdInput.value.includes('vani')) {
  }
}


async function startAudioVisualizer() {
  if (!audioCtx) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      isMicAccessGranted = true;

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

  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

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

  canvasCtx.fillStyle = 'rgba(5, 8, 20, 0.2)';
  canvasCtx.fillRect(0, 0, width, height);

  if (isMicAccessGranted && analyser) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
    canvasCtx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;

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
    canvasCtx.lineWidth = 1.5;

    canvasCtx.strokeStyle = 'rgba(0, 240, 255, 0.85)';
    canvasCtx.beginPath();
    wavePhase += 0.15;

    for (let x = 0; x < width; x++) {
      const angle = (x / width) * Math.PI * 6 + wavePhase;
      const edgeScale = Math.sin((x / width) * Math.PI);
      const y = (height / 2) + Math.sin(angle) * 15 * edgeScale;

      if (x === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
    }
    canvasCtx.stroke();

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
