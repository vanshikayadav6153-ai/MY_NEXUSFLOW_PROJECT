(function () {
  const log = document.getElementById('ai-chat-log');
  const input = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send');
  const statusEl = document.getElementById('ai-status');
  if (!log || !input || !sendBtn) return;

  let aiEnabled = false;
  let hintShown = false;

  function addMsg(text, who) {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg-' + who;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  let thinkingEl = null;
  function setThinking(on) {
    if (on && !thinkingEl) {
      thinkingEl = addMsg('Vani is thinking…', 'bot');
      thinkingEl.classList.add('ai-msg-thinking');
    } else if (!on && thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  function applyEnabledState() {
    input.disabled = !aiEnabled;
    sendBtn.disabled = !aiEnabled;
    input.placeholder = aiEnabled
      ? "Message Vani… (e.g. 'mummy ko whatsapp karo')"
      : 'Vani is off — add ANTHROPIC_API_KEY to enable';
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (!aiEnabled) {
      if (!hintShown) {
        addMsg('Vani AI is off. Add ANTHROPIC_API_KEY to a .env file (see .env.example) and restart the server.', 'bot');
        hintShown = true;
      }
      return;
    }
    addMsg(text, 'user');
    input.value = '';
    setThinking(true);
    try {
      socket.send(JSON.stringify({ type: 'ai_chat', message: text }));
    } catch (e) {
      setThinking(false);
      addMsg('Could not reach the server.', 'bot');
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  socket.addEventListener('message', (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    switch (data.type) {
      case 'ai_delta':
        if (data.text) { setThinking(false); addMsg(data.text, 'bot'); setThinking(true); }
        break;
      case 'ai_action':
        addMsg('→ ' + (data.tool || data.intent), 'action');
        break;
      case 'ai_reply':
        setThinking(false);
        if (data.reply && !(data.disabled && hintShown)) addMsg(data.reply, 'bot');
        if (data.disabled) hintShown = true;
        break;
      case 'ai_event':
        if (data.error && data.reply) { setThinking(false); addMsg(data.reply, 'bot'); }
        break;
    }
  });

  function refreshStatus() {
    fetch('/api/ai/status')
      .then((r) => r.json())
      .then((s) => {
        aiEnabled = Boolean(s.enabled);
        applyEnabledState();
        if (statusEl) {
          statusEl.textContent = aiEnabled
            ? 'Vani online · ' + s.model
            : 'Vani is disabled — add ANTHROPIC_API_KEY to .env and restart.';
          statusEl.classList.toggle('ai-status-off', !aiEnabled);
        }
      })
      .catch(() => {});
  }

  applyEnabledState();
  refreshStatus();
})();
