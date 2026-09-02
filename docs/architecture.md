# NexusFlow architecture

## Request flow

Every command — typed, spoken, from the Vani chat, or a macro step — ends up at
**`runAction(intent, params, ctx)`** in `server/actions/registry.js`.

```
                    ┌─────────────────────────── browser ───────────────────────────┐
   voice.js  ──►  submitCommand({command, alternatives[], source:'voice'})
   text box  ──►  submitCommand({command})
   aiChat.js ──►  {type:'ai_chat', message}
                    └──────────────────────── WebSocket (wsClient.js, reconnecting) ─┘
                                           │
                        server/index.js  ws.on('message')
                                           │  enqueueCommand / ai_chat
                                           ▼
                        server/jobQueue.js   — one job at a time per deviceId,
                                               concurrent across devices
                                           ▼
                        server/pipeline.js   runCommandText(text, session, opts)
                          │
                          ├─ "ai:" prefix ─────────────► ai/assistant.js
                          │
                          ├─ parseCandidates(candidates)      (nlp.js)
                          │     normalizeHinglish → parseCommand → first non-UNKNOWN
                          │
                          ├─ intent !== UNKNOWN ─► runAction(intent, details, ctx)   (registry.js)
                          │
                          └─ intent === UNKNOWN ─► ai/assistant.js
                                                    (candidate list handed to Claude)
                                           ▼
                        ai/assistant.js   Claude tool-use loop:
                          messages.create({ tools: listAiTools() })
                          while stop_reason === 'tool_use':
                            for each tool_use → runAction(intentForAiTool(name), input, ctx)
                            (destructive → ctx.confirm() first)
                            post ALL tool_result blocks in one user message
                                           ▼
                        registry.runAction   assertJsonSchema(params) → action.run(params, ctx)
                                           ▼
                        server/adb.js   runAdbArgs(['-s', id, ...])  (execFile, no shell)
```

## Key modules

### `actions/registry.js` — the single execution layer
`ACTIONS[intent] = { destructive, local?, readOnly?, params (JSON schema),
required, aiName, run(params, ctx), tts(params), summary(params) }`.

- `runAction()` validates `params` against the same schema Claude sees, runs the
  confirmation gate when `ctx.requireConfirm && action.destructive`, then calls
  `action.run`.
- `listAiTools()` projects every action with an `aiName` into an Anthropic
  `tools[]` entry (`input_schema` = the action's `params`).
- `run` handlers are thin wrappers over `adb.js` exports — no ADB logic lives
  here.

### `pipeline.js`
`runCommandText(text, session, opts)` — the shared entry point. Emits
`pipeline_*` WS events for the visualiser. `configurePipeline({ broadcast,
startPcShutdown, runMacroByName })` injects transport so the module stays
import‑safe for tests. `runAssistantText()` wraps the assistant and treats
"AI disabled" as a normal state (soft reply, no failure event).

### `ai/`
- `client.js` — `getClient()` (key from `ANTHROPIC_API_KEY` only), `AI_MODEL`,
  `isAiEnabled()`.
- `tools.js` — `buildTools()` = `listAiTools()`, plus `intentForAiTool`.
- `systemPrompt.js` — the Vani persona + rules ("call the tool, don't claim").
- `assistant.js` — `runAssistant({ text, session, onEvent, actionCtx, client })`.
  History lives on `session.aiHistory` (per socket, never a module global).
  Typed error handling for rate‑limit / auth / connection / refusal.

### `nlp.js`
`parseCommand(text, contacts, context)` — keyword/regex intent parser with
safety guards (informational questions and negations never fire destructive
intents). `normalizeHinglish(text)` fixes common speech mis‑hearings.
`bestFuzzyContact()` (Dice ≥ 0.8 or Levenshtein ≤ 2). `parseCandidates()` runs
the parser over an ordered list of speech candidates and returns the first that
resolves.

### `security.js` (consumed by `index.js`)
`createHttpAccessMiddleware`, `authorizeWebSocketUpgrade`, `createRateLimiter`,
`assertJsonSchema` / `validateJsonSchema`, `sendSafeError`. Bearer token compared
in constant time; loopback‑only when no token is configured.

### `jobQueue.js`
`new JobQueue({ onEvent })`; `enqueue(resourceKey, task, meta)`. FIFO per key,
concurrent across keys, terminal‑state history, `cancel()` for not‑yet‑started
jobs. `resourceKey` = the current device id (`deviceState.currentDeviceKey()`).

### `deviceState.js`
`getDiagnostics()` — one in‑flight probe at a time + a 1.5 s cache, so the 5 s
server poll and any client request share one set of ADB calls.
`invalidateDiagnostics()` forces a re‑probe.

## WebSocket messages

Client → server: `execute_command` (`{command, alternatives?, source?}`),
`ai_chat` (`{message}`), `confirm_action` (`{id, approved}`), `cancel_shutdown`,
`cancel_job` (`{jobId}`), `request_diagnostics`.

Server → client: `diagnostics`, `adb_log`, `pipeline_start` / `pipeline_step` /
`pipeline_end`, `command_queued`, `job_event`, `macro_step`, `confirm_request`
(`{id, summary}`), `ai_delta` / `ai_reply` / `ai_action` / `ai_event`,
`shutdown_timer_*`, `system_alert`.

## HTTP routes (all under `/api`, all behind the auth gate except `auth/*` and `health`)

`GET health` · `POST auth/login` · `GET auth/status` ·
`GET/POST/DELETE contacts` · `GET/POST config` · `GET diagnostics` ·
`GET screenshot` + `GET screen/current` · `POST sync-contacts` ·
`POST wireless/enable|disable` ·
`GET macros` `POST macros` `PUT/DELETE macros/:id` `POST macros/:id/run` ·
`GET jobs` `POST jobs/:id/cancel` ·
`GET mirror/frame` `POST mirror/tap` `POST mirror/swipe` ·
`POST unlock` ·
`GET files/list` `POST files/upload` `GET files/download` `DELETE files/delete`
`POST files/mkdir` `GET files/storage`.

## Graceful shutdown

`SIGINT` / `SIGTERM` → clear the diagnostics poll, cancel any PC‑shutdown timer,
wait up to 4 s for a running job, close every WebSocket, `server.close()`, exit.
