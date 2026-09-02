import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCommand,
  normalizeHinglish,
  parseCandidates,
  bestFuzzyContact,
  levenshtein
} from '../server/nlp.js';

const contacts = [
  { name: 'Rahul', number: '+919876543210' },
  { name: 'Mummy', number: '+919812345678' },
  { name: 'Boss', number: '+919811111111' }
];

test('normalizeHinglish fixes common speech mis-hearings', () => {
  assert.match(normalizeHinglish('watsapp mummy ko hello'), /whatsapp/);
  assert.match(normalizeHinglish("what's up rahul ko"), /whatsapp/);
  assert.equal(normalizeHinglish('flashlite on kar do'), 'flashlight on kar do');
  assert.match(normalizeHinglish('kall rahul'), /^call /);
  assert.equal(normalizeHinglish('brightness fifty'), 'brightness 50');
  assert.equal(normalizeHinglish('volume to full'), 'volume 255');
});

test('normalizeHinglish does NOT mangle common Hindi fillers', () => {
  // "bhej do" / "kar do" must survive (no number-word rewrite outside brightness/volume)
  assert.match(normalizeHinglish('mummy ko message bhej do'), /bhej do$/);
  assert.match(normalizeHinglish('flashlight on kar do'), /kar do$/);
});

test('normalizeHinglish only repairs the wake word at the start', () => {
  assert.match(normalizeHinglish('funny volume badhao'), /^vani /);
  // "honey" mid-sentence is left alone
  assert.match(normalizeHinglish('call my honey'), /honey$/);
});

test('a normalized transcript parses to the right intent', () => {
  assert.equal(parseCommand(normalizeHinglish('flashlite on kar do')).intent, 'FLASHLIGHT');
  assert.equal(parseCommand(normalizeHinglish('vol up')).intent, 'VOLUME_UP');
  assert.equal(parseCommand(normalizeHinglish('awaaz badhao')).intent, 'VOLUME_UP');
});

test('bestFuzzyContact resolves garbled names', () => {
  assert.equal(bestFuzzyContact('kall raul', contacts)?.name, 'Rahul');
  assert.equal(bestFuzzyContact('mumy ko phone', contacts)?.name, 'Mummy');
  assert.equal(bestFuzzyContact('xyzzy foobar quux', contacts), null);
  assert.ok(levenshtein('raul', 'rahul') <= 2);
});

test('parseCommand uses the fuzzy fallback for a near-miss contact', () => {
  const r = parseCommand('call raul', contacts);
  assert.equal(r.intent, 'CALL');
  assert.equal(r.details.name, 'Rahul');
  assert.equal(r.details.number, '+919876543210');
});

test('parseCandidates picks the first candidate that yields an intent', () => {
  const r = parseCandidates(['kall raul', 'call rahul please'], contacts);
  assert.equal(r.parsed.intent, 'CALL');
  assert.equal(r.parsed.details.name, 'Rahul');
  assert.ok(r.tried.length >= 1);
});

test('parseCandidates prefers order: an earlier resolvable candidate wins', () => {
  const r = parseCandidates(['flashlight on', 'volume up'], contacts);
  assert.equal(r.parsed.intent, 'FLASHLIGHT');
});

test('parseCandidates returns UNKNOWN + every tried string when nothing resolves', () => {
  const r = parseCandidates(['blah blah', 'zzz qqq', 'random noise'], contacts);
  assert.equal(r.parsed.intent, 'UNKNOWN');
  assert.equal(r.tried.length, 3);
});

test('parseCandidates dedupes candidates that normalize to the same text', () => {
  const r = parseCandidates(['kall rahul', 'call  rahul', 'CALL RAHUL'], contacts);
  assert.equal(r.tried.length, 1);
  assert.equal(r.parsed.intent, 'CALL');
});
