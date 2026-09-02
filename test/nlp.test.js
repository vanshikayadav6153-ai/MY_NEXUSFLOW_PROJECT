import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommand } from '../server/nlp.js';

const contacts = [
  { name: 'Yash Kumar', number: '+919876543210' },
  { name: 'Yash', number: '+919812345678' }
];

const destructiveIntents = new Set([
  'SHUTDOWN',
  'UNLOCK',
  'CALL',
  'WHATSAPP',
  'WHATSAPP_SEND_MESSAGE',
  'WHATSAPP_AUDIO_CALL',
  'WHATSAPP_VIDEO_CALL'
]);

test('parses an explicit shutdown request and preserves wake-word metadata', () => {
  const result = parseCommand('Vani, shutdown my PC');

  assert.equal(result.intent, 'SHUTDOWN');
  assert.equal(result.details.target, 'PC');
  assert.equal(result.details.wakeWordDetected, true);
});

test('parses safe device controls without producing a destructive intent', () => {
  const result = parseCommand('Vani volume up');

  assert.equal(result.intent, 'VOLUME_UP');
  assert.equal(result.details.target, 'Phone');
  assert.equal(result.details.wakeWordDetected, true);
  assert.equal(destructiveIntents.has(result.intent), false);
});

test('clamps an explicit brightness value to Androids supported maximum', () => {
  const result = parseCommand('brightness 999');

  assert.equal(result.intent, 'BRIGHTNESS');
  assert.equal(result.details.level, 255);
});

test('recognizes an explicit flashlight-off command as an off state', () => {
  const result = parseCommand('flashlight off');

  assert.equal(result.intent, 'FLASHLIGHT');
  assert.equal(result.details.state, false);
});

test('resolves the longest matching contact for an explicit WhatsApp message', () => {
  const result = parseCommand('whatsapp Yash Kumar saying hello', contacts);

  assert.equal(result.intent, 'WHATSAPP');
  assert.equal(result.details.name, 'Yash Kumar');
  assert.equal(result.details.number, '+919876543210');
  assert.equal(result.details.message, 'Hello');
});

test('returns UNKNOWN for neutral text rather than dispatching a risky action', () => {
  const result = parseCommand('what is the weather today?');

  assert.equal(result.intent, 'UNKNOWN');
  assert.equal(destructiveIntents.has(result.intent), false);
});

test('does not shutdown for an informational question', () => {
  const result = parseCommand('How do I shutdown my PC?');

  assert.notEqual(result.intent, 'SHUTDOWN');
  assert.equal(destructiveIntents.has(result.intent), false);
});

test('does not shutdown when the user explicitly negates the request', () => {
  const result = parseCommand("don't shutdown my PC");

  assert.notEqual(result.intent, 'SHUTDOWN');
  assert.equal(destructiveIntents.has(result.intent), false);
});

test('does not unlock a phone for an informational question', () => {
  const result = parseCommand('Can you explain how to unlock a phone?');

  assert.notEqual(result.intent, 'UNLOCK');
  assert.equal(destructiveIntents.has(result.intent), false);
});

test('does not call a contact when a contact name is supplied without an action', () => {
  const result = parseCommand('Yash Kumar', contacts);

  assert.equal(result.intent, 'UNKNOWN');
  assert.equal(destructiveIntents.has(result.intent), false);
});

test('treats an explicit cancel command as CANCEL even without pending context', () => {
  const result = parseCommand('cancel');

  assert.equal(result.intent, 'CANCEL');
});
