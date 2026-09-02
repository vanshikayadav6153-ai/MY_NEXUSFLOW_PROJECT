import assert from 'node:assert/strict';
import test from 'node:test';

import { scaleToDevice } from '../server/screenMirror.js';

test('scaleToDevice maps normalized points to device pixels', () => {
  assert.deepEqual(scaleToDevice(0, 0, '1080x2400'), { x: 0, y: 0 });
  assert.deepEqual(scaleToDevice(1, 1, '1080x2400'), { x: 1079, y: 2399 });
  assert.deepEqual(scaleToDevice(0.5, 0.5, '1080x2400'), { x: 540, y: 1200 });
});

test('scaleToDevice clamps out-of-range and bad input', () => {
  assert.deepEqual(scaleToDevice(-1, 2, '1000x1000'), { x: 0, y: 999 });
  assert.deepEqual(scaleToDevice(NaN, undefined, '1000x1000'), { x: 0, y: 0 });
});

test('scaleToDevice tolerates odd resolution strings', () => {
  assert.deepEqual(scaleToDevice(0.5, 0.5, 'Physical size: 720 x 1600'), { x: 360, y: 800 });
  // unknown -> default 1080x2400
  const d = scaleToDevice(1, 1, 'unknown');
  assert.deepEqual(d, { x: 1079, y: 2399 });
});
