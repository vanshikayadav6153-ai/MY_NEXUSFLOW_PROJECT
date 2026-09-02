import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIONS,
  listActionNames,
  listAiTools,
  runAction,
  getAction,
  intentForAiTool
} from '../server/actions/registry.js';
import { parseCommand } from '../server/nlp.js';
import { validateJsonSchema } from '../server/security.js';

const destructiveIntents = [
  'SHUTDOWN',
  'UNLOCK',
  'CALL',
  'WHATSAPP',
  'WHATSAPP_SEND_MESSAGE',
  'WHATSAPP_AUDIO_CALL',
  'WHATSAPP_VIDEO_CALL'
];

test('every intent parseCommand can emit has a registry entry', () => {
  const samples = [
    'Vani shutdown my PC',
    'unlock phone',
    'call +919876543210',
    'whatsapp +919876543210 saying hello',
    'volume up', 'volume down', 'mute', 'brightness 200', 'flashlight on',
    'open youtube', 'open website google.com',
    'wifi on', 'wifi off', 'bluetooth on', 'bluetooth off',
    'take photo', 'play music', 'next song', 'previous song',
    'go home', 'go back', 'recent apps', 'notifications',
    'god mode', 'cancel',
    'search Rahul', 'type hello there', 'send message',
    'whatsapp call Rahul'
  ];
  for (const text of samples) {
    const { intent } = parseCommand(text, []);
    if (intent === 'UNKNOWN') continue;
    assert.ok(ACTIONS[intent], `no registry entry for intent "${intent}" (from "${text}")`);
  }
});

test('all known destructive intents are flagged destructive', () => {
  for (const name of destructiveIntents) {
    assert.ok(getAction(name), `missing action ${name}`);
    assert.equal(getAction(name).destructive, true, `${name} must be destructive`);
  }
});

test('safe device controls are not flagged destructive', () => {
  for (const name of ['VOLUME_UP', 'FLASHLIGHT', 'OPEN_APP', 'HOME', 'GET_DIAGNOSTICS']) {
    assert.equal(getAction(name).destructive, false, `${name} must not be destructive`);
  }
});

test('listAiTools returns valid, self-consistent tool definitions', () => {
  const tools = listAiTools();
  assert.ok(tools.length > 10);
  const seen = new Set();
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/, `tool name not snake_case: ${tool.name}`);
    assert.ok(!seen.has(tool.name), `duplicate tool name ${tool.name}`);
    seen.add(tool.name);
    assert.equal(tool.strict, true);
    assert.equal(tool.input_schema.type, 'object');
    assert.equal(tool.input_schema.additionalProperties, false);
    assert.ok(Array.isArray(tool.input_schema.required));
    // schema itself must be well-formed for our validator
    const check = validateJsonSchema({}, { ...tool.input_schema, required: [] });
    assert.ok(check.valid || check.errors.every((e) => typeof e.message === 'string'));
    // every tool maps back to exactly one intent
    assert.ok(intentForAiTool(tool.name), `no intent for tool ${tool.name}`);
  }
});

test('runAction rejects an unknown action', async () => {
  await assert.rejects(() => runAction('NOT_A_REAL_ACTION', {}, {}), /Unknown action/);
});

test('runAction validates params before executing', async () => {
  // invalid phone number must be rejected by schema, never reaching adb
  await assert.rejects(() => runAction('CALL', { number: 'lol; rm -rf /' }, {}));
  await assert.rejects(() => runAction('BRIGHTNESS', { level: 9999 }, {}));
});

test('a destructive action is skipped when confirmation is declined', async () => {
  let ran = false;
  const spyAction = {
    destructive: true,
    params: {},
    summary: () => 'spy',
    run: () => { ran = true; return 'did it'; }
  };
  ACTIONS.__SPY__ = spyAction;
  try {
    const out = await runAction('__SPY__', {}, {
      requireConfirm: true,
      confirm: async () => false
    });
    assert.equal(out.ok, false);
    assert.equal(out.skipped, true);
    assert.equal(ran, false, 'run() must not execute when confirmation is declined');
  } finally {
    delete ACTIONS.__SPY__;
  }
});

test('a destructive action runs when confirmation is granted', async () => {
  let ran = false;
  ACTIONS.__SPY__ = {
    destructive: true,
    params: {},
    summary: () => 'spy',
    run: () => { ran = true; return 'ok'; },
    tts: () => 'done'
  };
  try {
    const out = await runAction('__SPY__', {}, { requireConfirm: true, confirm: async () => true });
    assert.equal(out.ok, true);
    assert.equal(ran, true);
    assert.equal(out.tts, 'done');
  } finally {
    delete ACTIONS.__SPY__;
  }
});

test('listActionNames covers the registry', () => {
  assert.deepEqual(new Set(listActionNames()), new Set(Object.keys(ACTIONS)));
});
