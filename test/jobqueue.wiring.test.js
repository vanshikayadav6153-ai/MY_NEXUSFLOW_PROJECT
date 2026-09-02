import assert from 'node:assert/strict';
import test from 'node:test';

import { JobQueue, JOB_STATES } from '../server/jobQueue.js';

const tick = () => new Promise((r) => setTimeout(r, 15));

test('jobs for one resource key run strictly one at a time', async () => {
  const q = new JobQueue();
  const events = [];
  let active = 0;
  let maxActive = 0;

  const task = (label) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${label}`);
    await tick();
    events.push(`end:${label}`);
    active -= 1;
  };

  q.enqueue('deviceA', task('a1'), {});
  q.enqueue('deviceA', task('a2'), {});
  q.enqueue('deviceA', task('a3'), {});

  while (q.list({ states: [JOB_STATES.QUEUED, JOB_STATES.RUNNING] }).length > 0) {
    await tick();
  }

  assert.equal(maxActive, 1, 'never more than one task running for deviceA');
  assert.deepEqual(events, [
    'start:a1', 'end:a1',
    'start:a2', 'end:a2',
    'start:a3', 'end:a3'
  ]);
});

test('different resource keys run concurrently', async () => {
  const q = new JobQueue();
  let concurrent = 0;
  let peak = 0;

  const slow = () => async () => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await tick();
    concurrent -= 1;
  };

  q.enqueue('deviceA', slow());
  q.enqueue('deviceB', slow());
  q.enqueue('deviceC', slow());

  while (q.list({ states: [JOB_STATES.QUEUED, JOB_STATES.RUNNING] }).length > 0) {
    await tick();
  }
  assert.equal(peak, 3, 'all three device keys ran at once');
});

test('a failing task becomes a failed job, not an unhandled rejection', async () => {
  const q = new JobQueue();
  const snap = q.enqueue('deviceA', async () => { throw new Error('boom'); });
  while (q.get(snap.id).state === JOB_STATES.QUEUED || q.get(snap.id).state === JOB_STATES.RUNNING) {
    await tick();
  }
  const finished = q.get(snap.id);
  assert.equal(finished.state, JOB_STATES.FAILED);
  assert.equal(finished.error.message, 'boom');
});

test('a queued job can be cancelled before it starts', async () => {
  const q = new JobQueue();
  q.enqueue('deviceA', async () => { await tick(); });      // occupies the worker
  const pending = q.enqueue('deviceA', async () => { await tick(); });
  assert.equal(q.cancel(pending.id), true);
  assert.equal(q.get(pending.id).state, JOB_STATES.CANCELLED);
});
