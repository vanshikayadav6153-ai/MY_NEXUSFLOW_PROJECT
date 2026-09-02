# NexusFlow

Control an Android phone from your PC over ADB — with voice, a Claude‑powered
assistant, one‑tap automation macros, and a live screen mirror you can click
and scroll.

Node.js + Express + WebSocket server, plain‑JS single‑page frontend, ADB under
the hood. No build step.

---

## What it does

| Area | |
|---|---|
| **Command pipeline** | Natural‑language commands (English / Hindi / Hinglish) → intent → ADB. Calls, WhatsApp, apps, volume, brightness, flashlight, media, navigation, wifi/bluetooth, screenshots, PC shutdown. |
| **Voice** | Web Speech recognition with a 5‑best transcript list, Hinglish phonetic normalization, fuzzy contact matching, and a `हिं / EN` toggle. Misheard words are cleaned server‑side or handed to the AI to disambiguate — usually right in one try. |
| **Vani (AI assistant)** | Claude (`@anthropic-ai/sdk`) with **tool use** — the model calls the same action registry the deterministic parser uses, so validation, the per‑device job queue, and confirmation all apply. Falls back to Claude whenever the keyword parser misses. Optional: the app runs fine without an API key (the AI tab just shows "disabled"). |
| **Macros** | Save a sequence of commands ("Morning Routine", "Night Mode"), run it with one tap or "vani <name> chalao". Live per‑step progress. |
| **Live mirror** | ~3 fps screen stream in the phone frame. Click → tap, drag → swipe, **mouse wheel → scroll** — no need to touch the phone. |
| **Files** | Browse `/sdcard`, upload (PC → phone), download, delete, mkdir. |
| **Auto‑unlock** | If enabled in Settings and a PIN is saved, a phone that connects over USB while locked is unlocked automatically. |

---

## Setup

Requires **Node.js ≥ 20.6** and a Windows PC (ADB auto‑installs on first run;
the bundled `platform-tools` path is used if present).

```bash
npm install
npm start            # serves http://localhost:3000 and opens Chrome
```

Connect your Android phone by USB with **USB debugging** enabled and accept the
RSA prompt. Chrome is used because the voice features need the Web Speech API.

### Optional: enable the AI assistant

Create a `.env` file in the project root (see `.env.example`):

```
ANTHROPIC_API_KEY=sk-ant-...
# NEXUSFLOW_AI_MODEL=claude-sonnet-5   # default
```

Restart. Without a key everything else still works.

---

## Security model

By default the server is **localhost‑only** — any request from another machine
on the LAN is refused for both the REST API and the WebSocket.

To allow LAN access, set a shared token:

```
NEXUSFLOW_AUTH_TOKEN=<a long random string>
# NEXUSFLOW_ALLOWED_ORIGINS=http://localhost:3000,http://192.168.1.20:3000
```

With a token set, every `/api/*` call needs `Authorization: Bearer <token>` and
every WebSocket upgrade needs `?token=<token>`; browser origins are checked
against the allowlist. Rate limits apply throughout.

Other guarantees:

- Every ADB call that carries user input goes through `execFile` with an
  argument array — no shell, no command injection.
- Destructive actions (call, WhatsApp send, unlock, PC shutdown, delete) from
  the AI or a non‑loopback client require an in‑app **Confirm** before they run.
- Screenshots / mirror frames are written to `server/.runtime/` (gitignored)
  and served only behind the auth gate — never from `public/`.
- `config.json` (which can hold the unlock PIN) is gitignored; the PIN is never
  sent to the browser.

**Do not expose this to the internet without `NEXUSFLOW_AUTH_TOKEN` and HTTPS
(a TLS reverse proxy or a private tunnel).**

---

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `ANTHROPIC_API_KEY` | — | enables the Vani AI assistant |
| `NEXUSFLOW_AI_MODEL` | `claude-sonnet-5` | assistant model |
| `NEXUSFLOW_AUTH_TOKEN` | — | unset = localhost‑only; set = bearer‑token auth for LAN |
| `NEXUSFLOW_ALLOWED_ORIGINS` | `http://localhost:3000`, `http://127.0.0.1:3000` | WebSocket origin allowlist |
| `NEXUSFLOW_NO_BROWSER` | — | `1` = don't auto‑launch Chrome on start |

All of these can live in `.env` (real env vars win).

---

## Usage

- **Type or speak** a command in the center panel: *"Yash ko call karo"*,
  *"flashlight on kar do"*, *"open youtube"*, *"shutdown pc"*.
- **Vani AI tab** — chat with the assistant; it can act on the phone via tools.
- **Macros tab** — build/run sequences.
- **Files tab** — browse and transfer.
- **Live mirror** — click the LIVE MIRROR button under the phone frame; then
  click / drag / wheel over the image.
- **Settings** — unlock PIN, auto‑unlock toggle, WhatsApp send‑button
  calibration, wireless ADB.

---

## Tests

```bash
npm test          # node --test, ~60 tests, no extra deps
```

Coverage: NLP safety guards + Hinglish voice, the action registry + AI tool
schemas, the AI agentic loop (with a fake client), the job queue, shell‑escaping
in `adb.js`, file‑transfer path validation, the auth wiring (spawns a real
server), macros, and the mirror coordinate math. CI runs on Node 20 & 22
(`.github/workflows/ci.yml`).

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full picture. In
short:

```
voice.js / text box ─┐
                     ├─► WS execute_command ─► JobQueue (per device)
Vani chat  ──────────┘                             │
                                                   ▼
                              pipeline.js: parseCandidates (NLP + fuzzy)
                                 │ intent found            │ UNKNOWN
                                 ▼                         ▼
                       actions/registry.js  ◄────  ai/assistant.js (Claude tool use)
                                 │
                                 ▼
                               adb.js  (execFile, per-device -s)
```

The **Action Registry** (`server/actions/registry.js`) is the single execution
layer: each action has a JSON‑schema for its params, a `destructive` flag, and a
thin wrapper over an `adb.js` export. The NLP fast path and Claude's tool calls
both go through `runAction()`, so they get the same validation, queueing and
confirmation.

---

## Project layout

```
server/
  index.js          HTTP + WebSocket, routes, auth wiring, pollers, graceful shutdown
  pipeline.js       parse → execute one command; AI fallback; macro step runner
  actions/registry.js   the action registry (NLP + AI share this)
  adb.js            ADB abstraction (runAdbArgs = execFile, no shell)
  nlp.js            Hinglish keyword parser + normalizeHinglish + fuzzy contacts
  ai/               client / tools / systemPrompt / assistant (Claude tool-use loop)
  security.js       bearer-token middleware, rate limiter, origin allowlist, schema validator
  jobQueue.js       per-resource FIFO queue
  deviceState.js    cached, single-flight device diagnostics
  config/index.js   config + env-only secret accessors + JSON schemas
  fileTransfer.js   ADB file browser/transfer (execFile, /sdcard sandbox)
  macros.js         macro CRUD + executeMacro
  screenMirror.js   frame capture + tap/swipe
public/
  index.html, css/styles.css
  js/  wsClient.js (reconnecting) · app.js · voice.js · aiChat.js · macros.js · fileManager.js · particles.js
test/               node --test suites
```

---

## Notes

- SMS/call‑log and clipboard modules exist (`server/messaging.js`,
  `server/clipboard.js`) but are not wired — modern Android restricts both.
- `Ctrl+C` shuts the server down gracefully (stops the poller, lets a running
  job finish for up to 4s, closes sockets).
