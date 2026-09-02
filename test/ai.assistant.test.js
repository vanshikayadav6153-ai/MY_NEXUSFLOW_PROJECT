import assert from 'node:assert/strict';
import test from 'node:test';

import { runAssistant } from '../server/ai/assistant.js';
import { buildTools } from '../server/ai/tools.js';
import { ACTIONS } from '../server/actions/registry.js';

/** A fake Anthropic client that replays a scripted list of responses. */
function fakeClient(script) {
  let i = 0;
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        if (i >= script.length) throw new Error('fakeClient: script exhausted');
        return script[i++];
      }
    }
  };
}

const textResp = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolResp = (name, id = 't1', input = {}) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input }]
});

test('buildTools exposes a tool for every AI-enabled action', () => {
  const tools = buildTools();
  assert.ok(tools.find((t) => t.name === 'make_call'));
  assert.ok(tools.find((t) => t.name === 'toggle_flashlight'));
  assert.ok(tools.every((t) => t.input_schema && t.input_schema.type === 'object'));
});

test('a plain answer returns the text and records history', async () => {
  const session = { aiHistory: [] };
  const client = fakeClient([textResp('battery is at 80%')]);
  const events = [];
  const r = await runAssistant({ text: 'how is the phone?', session, client, onEvent: (e) => events.push(e) });

  assert.equal(r.ok, true);
  assert.equal(r.reply, 'battery is at 80%');
  assert.equal(session.aiHistory[0].role, 'user');
  assert.equal(session.aiHistory.at(-1).role, 'assistant');
  assert.ok(events.some((e) => e.type === 'ai_reply' && e.reply === 'battery is at 80%'));
});

test('a safe tool call runs through runAction and a single tool_result is sent back', async () => {
  let ran = 0;
  ACTIONS.__SPY_SAFE__ = {
    destructive: false, aiName: 'spy_safe', params: {}, description: 'spy',
    run: () => { ran += 1; return { echoed: true }; }
  };
  try {
    const session = { aiHistory: [] };
    const client = fakeClient([toolResp('spy_safe'), textResp('did it')]);
    const r = await runAssistant({ text: 'do the spy thing', session, client });

    assert.equal(ran, 1, 'the action ran exactly once');
    assert.equal(r.ok, true);
    assert.equal(r.reply, 'did it');
    assert.deepEqual(r.actionsTaken, [{ tool: 'spy_safe', intent: '__SPY_SAFE__' }]);

    // history: user, assistant(tool_use), user(tool_result), assistant(text)
    const toolResultTurn = session.aiHistory.find(
      (m) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
    );
    assert.ok(toolResultTurn, 'a tool_result user turn exists');
    assert.equal(toolResultTurn.content.length, 1, 'exactly one tool_result block');
    assert.equal(toolResultTurn.content[0].tool_use_id, 't1');
  } finally {
    delete ACTIONS.__SPY_SAFE__;
  }
});

test('a destructive tool call does NOT execute when confirmation is declined', async () => {
  let ran = 0;
  ACTIONS.__SPY_DANGER__ = {
    destructive: true, aiName: 'spy_danger', params: {}, summary: () => 'spy danger',
    run: () => { ran += 1; return 'boom'; }
  };
  try {
    const session = { aiHistory: [], confirm: async () => false };
    const client = fakeClient([toolResp('spy_danger'), textResp('could not do it')]);
    const r = await runAssistant({ text: 'do the dangerous thing', session, client });

    assert.equal(ran, 0, 'declined destructive action must not run');
    const toolResultTurn = session.aiHistory.find(
      (m) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
    );
    assert.equal(toolResultTurn.content[0].is_error, true);
    assert.match(toolResultTurn.content[0].content, /declined/i);
  } finally {
    delete ACTIONS.__SPY_DANGER__;
  }
});

test('a destructive tool call DOES execute when confirmation is granted', async () => {
  let ran = 0;
  ACTIONS.__SPY_DANGER__ = {
    destructive: true, aiName: 'spy_danger', params: {}, summary: () => 'spy danger',
    run: () => { ran += 1; return 'ok'; }, tts: () => 'done'
  };
  try {
    const session = { aiHistory: [], confirm: async () => true };
    const client = fakeClient([toolResp('spy_danger'), textResp('done')]);
    await runAssistant({ text: 'go', session, client });
    assert.equal(ran, 1);
  } finally {
    delete ACTIONS.__SPY_DANGER__;
  }
});

test('a refusal is surfaced, not retried', async () => {
  const client = fakeClient([{ stop_reason: 'refusal', content: [] }]);
  const r = await runAssistant({ text: 'do something disallowed', session: { aiHistory: [] }, client });
  assert.equal(r.refusal, true);
  assert.equal(client.calls.length, 1, 'no retry after a refusal');
});

test('runs disabled-gracefully with no client and no API key', async () => {
  const r = await runAssistant({ text: 'hi', session: { aiHistory: [] }, client: null });
  assert.equal(r.disabled, true);
  assert.match(r.reply, /ANTHROPIC_API_KEY/);
});
