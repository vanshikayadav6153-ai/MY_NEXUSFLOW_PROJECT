import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deviceShellQuote,
  assertDeviceId,
  assertPackageName,
  assertComponent,
  openApp
} from '../server/adb.js';

test('deviceShellQuote wraps arbitrary text as one inert single-quoted token', () => {
  assert.equal(deviceShellQuote('hello world'), "'hello world'");
  // shell metacharacters are neutralised - the whole thing is one token
  assert.equal(deviceShellQuote('a" & calc.exe | rm -rf / #'), "'a\" & calc.exe | rm -rf / #'");
  // an embedded single quote is closed, escaped, reopened (POSIX '\'' idiom)
  assert.equal(deviceShellQuote("it's a $(trap)"), "'it'\\''s a $(trap)'");
  assert.equal(deviceShellQuote("x'; reboot; '"), "'x'\\''; reboot; '\\'''");
  // reconstructing what a POSIX shell would parse yields the original string
  const original = "a'b\"c ; d";
  const quoted = deviceShellQuote(original);
  assert.equal(quoted.replace(/'\\''/g, "\u0000").replace(/^'|'$/g, '').replace(/\u0000/g, "'"), original);
});

test('assertDeviceId accepts real serials and rejects shell metacharacters', () => {
  assert.equal(assertDeviceId('emulator-5554'), 'emulator-5554');
  assert.equal(assertDeviceId('192.168.1.5:5555'), '192.168.1.5:5555');
  for (const bad of ['a; rm -rf /', 'dev ice', '$(whoami)', 'a|b', 'a&b', '`x`', '']) {
    assert.throws(() => assertDeviceId(bad), /Invalid device id/);
  }
});

test('assertPackageName only accepts dotted identifiers', () => {
  assert.equal(assertPackageName('com.whatsapp'), 'com.whatsapp');
  assert.equal(assertPackageName('com.foo.bar_baz2'), 'com.foo.bar_baz2');
  for (const bad of ['com.whatsapp; rm', 'whatsapp', 'com.', '.com', 'com..x', 'com.x/.M', 'a b']) {
    assert.throws(() => assertPackageName(bad), /Invalid package name/);
  }
});

test('assertComponent only accepts package/activity identifiers', () => {
  assert.equal(assertComponent('com.whatsapp/.Main'), 'com.whatsapp/.Main');
  assert.equal(assertComponent('com.x.y/com.x.y.MainActivity'), 'com.x.y/com.x.y.MainActivity');
  for (const bad of ['com.x/.M; reboot', 'com.whatsapp', 'com.x/', '/.M', 'a/b c']) {
    assert.throws(() => assertComponent(bad), /Invalid component/);
  }
});

test('openApp rejects an app name with shell metacharacters before touching adb', async () => {
  for (const bad of ['x; rm -rf /', 'app`whoami`', 'a$(b)', 'a|b', 'a"b']) {
    await assert.rejects(() => openApp(bad), /letters, digits, spaces/);
  }
});
