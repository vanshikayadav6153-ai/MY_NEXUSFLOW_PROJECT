(function () {
  const MAX_BACKOFF = 8000;
  const listeners = { message: [], open: [], close: [], reconnecting: [] };
  const sendQueue = [];

  let ws = null;
  let backoff = 250;
  let manualClose = false;
  let everConnected = false;

  function fire(type, arg) {
    for (const fn of listeners[type]) {
      try { fn(arg); } catch (e) { console.error('[NexusWS listener]', e); }
    }
  }

  function endpoint() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${proto}//${location.host}/`;
    try {
      const token = sessionStorage.getItem('nx_token');
      if (token) url += '?token=' + encodeURIComponent(token);
    } catch {  }
    return url;
  }

  function connect() {
    try {
      ws = new WebSocket(endpoint());
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      backoff = 250;
      everConnected = true;
      while (sendQueue.length && ws.readyState === WebSocket.OPEN) {
        ws.send(sendQueue.shift());
      }
      fire('open');
    });

    ws.addEventListener('message', (e) => fire('message', e));

    ws.addEventListener('close', () => {
      fire('close');
      if (!manualClose) scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      try { ws.close(); } catch {  }
    });
  }

  function scheduleReconnect() {
    if (manualClose) return;
    const delay = Math.min(MAX_BACKOFF, backoff) + Math.floor(Math.random() * 300);
    backoff = Math.min(MAX_BACKOFF, backoff * 2);
    fire('reconnecting', { delay, everConnected });
    setTimeout(connect, delay);
  }

  window.NexusWS = {
    get readyState() { return ws ? ws.readyState : WebSocket.CONNECTING; },
    get connected() { return !!ws && ws.readyState === WebSocket.OPEN; },
    send(data) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload);
      else sendQueue.push(payload);
    },
    addEventListener(type, fn) {
      if (listeners[type] && typeof fn === 'function') listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    close() { manualClose = true; if (ws) { try { ws.close(); } catch {  } } }
  };

  connect();
})();
