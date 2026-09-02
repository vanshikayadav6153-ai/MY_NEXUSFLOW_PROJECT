import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateMacro,
  saveMacro,
  getMacroById,
  deleteMacro,
  executeMacro
} from '../server/macros.js';

test('validateMacro accepts a well-formed macro', () => {
  assert.doesNotThrow(() => validateMacro({
    name: 'Night Mode',
    description: 'dim + mute',
    steps: [{ command: 'brightness low', delay: 1000 }, { command: 'mute' }]
  }));
});

test('validateMacro rejects malformed macros', () => {
  assert.throws(() => validateMacro({ steps: [{ command: 'x' }] }), /format/i);          // no name
  assert.throws(() => validateMacro({ name: 'x', steps: [] }), /format/i);               // no steps
  assert.throws(() => validateMacro({ name: 'x', steps: [{ command: '' }] }), /format/i); // empty command
  assert.throws(() => validateMacro({ name: 'x', steps: [{ command: 'a', delay: 999999 }] }), /format/i); // delay too big
  assert.throws(() => validateMacro({ name: 'x', steps: [{ command: 'a' }], bogus: 1 }), /format/i); // extra prop
  assert.throws(() => validateMacro({
    name: 'x', steps: Array.from({ length: 51 }, () => ({ command: 'a' }))
  }), /format/i); // > 50 steps
});

test('executeMacro runs steps in order through the injected runner', async () => {
  const id = `__test_${Date.now()}`;
  saveMacro({
    id,
    name: 'Test Seq',
    steps: [
      { command: 'step one', delay: 0 },
      { command: 'step two', delay: 0 },
      { command: 'step three', delay: 0 }
    ]
  });
  try {
    const ran = [];
    const progress = [];
    const result = await executeMacro(
      id,
      async (cmd) => { ran.push(cmd); },
      (s) => progress.push(`${s.stepIndex}:${s.status}`)
    );

    assert.deepEqual(ran, ['step one', 'step two', 'step three']);
    assert.equal(result.success, true);
    assert.equal(result.successCount, 3);
    assert.ok(progress.includes('0:executing'));
    assert.ok(progress.includes('2:success'));
  } finally {
    deleteMacro(id);
  }
});

test('executeMacro reports a failing step without aborting the rest', async () => {
  const id = `__test_${Date.now()}_b`;
  saveMacro({ id, name: 'Test Fail', steps: [{ command: 'ok1' }, { command: 'boom' }, { command: 'ok2' }] });
  try {
    const ran = [];
    const result = await executeMacro(id, async (cmd) => {
      ran.push(cmd);
      if (cmd === 'boom') throw new Error('kaboom');
    }, () => {});
    assert.deepEqual(ran, ['ok1', 'boom', 'ok2']);
    assert.equal(result.success, false);
    assert.equal(result.successCount, 2);
  } finally {
    deleteMacro(id);
  }
});

test('getMacroById / deleteMacro round-trip', () => {
  const id = `__test_${Date.now()}_c`;
  saveMacro({ id, name: 'RoundTrip', steps: [{ command: 'home' }] });
  assert.equal(getMacroById(id)?.name, 'RoundTrip');
  assert.equal(deleteMacro(id).success, true);
  assert.equal(getMacroById(id), null);
});
