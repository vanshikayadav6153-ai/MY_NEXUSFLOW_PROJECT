export const JOB_STATES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

const TERMINAL_STATES = new Set([
  JOB_STATES.SUCCEEDED,
  JOB_STATES.FAILED,
  JOB_STATES.CANCELLED
]);

const scheduleMicrotask = typeof queueMicrotask === 'function'
  ? queueMicrotask
  : (callback) => Promise.resolve().then(callback);

export class JobQueue {
  constructor({ maxHistory = 100, onEvent = null, idPrefix = 'job' } = {}) {
    if (!Number.isInteger(maxHistory) || maxHistory < 0) {
      throw new TypeError('maxHistory must be a non-negative integer');
    }

    if (onEvent !== null && typeof onEvent !== 'function') {
      throw new TypeError('onEvent must be a function or null');
    }

    this.maxHistory = maxHistory;
    this.onEvent = onEvent;
    this.idPrefix = String(idPrefix || 'job');

    this._pendingByResource = new Map();
    this._jobs = new Map();
    this._runningResources = new Set();
    this._scheduledResources = new Set();
    this._terminalJobIds = [];
    this._sequence = 0;
  }

  enqueue(resourceKey, task, metadata = {}) {
    const normalizedResourceKey = this._validateResourceKey(resourceKey);
    if (typeof task !== 'function') {
      throw new TypeError('task must be a function');
    }

    const job = {
      id: this._createId(),
      resourceKey: normalizedResourceKey,
      task,
      metadata: cloneValue(metadata),
      state: JOB_STATES.QUEUED,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      cancelledAt: null,
      result: undefined,
      error: null
    };

    this._jobs.set(job.id, job);
    const pending = this._pendingByResource.get(normalizedResourceKey) || [];
    pending.push(job);
    this._pendingByResource.set(normalizedResourceKey, pending);

    this._emit('queued', job);
    this._scheduleDrain(normalizedResourceKey);
    return this._snapshot(job);
  }

  get(jobId) {
    const job = this._jobs.get(String(jobId));
    return job ? this._snapshot(job) : null;
  }

  list(options = {}) {
    const filters = typeof options === 'string' ? { resourceKey: options } : (options || {});
    const stateFilter = filters.states === undefined
      ? null
      : new Set(Array.isArray(filters.states) ? filters.states : [filters.states]);
    const resourceKey = filters.resourceKey === undefined ? null : String(filters.resourceKey);
    const limit = filters.limit === undefined ? Infinity : Number(filters.limit);

    if (limit !== Infinity && (!Number.isInteger(limit) || limit < 0)) {
      throw new TypeError('limit must be a non-negative integer');
    }

    if (limit === 0) return [];

    const jobs = [];
    for (const job of this._jobs.values()) {
      if (resourceKey !== null && job.resourceKey !== resourceKey) continue;
      if (stateFilter && !stateFilter.has(job.state)) continue;
      jobs.push(this._snapshot(job));
      if (jobs.length >= limit) break;
    }
    return jobs;
  }

  cancel(jobId) {
    const job = this._jobs.get(String(jobId));
    if (!job || job.state !== JOB_STATES.QUEUED) return false;

    const pending = this._pendingByResource.get(job.resourceKey);
    if (pending) {
      const index = pending.indexOf(job);
      if (index !== -1) pending.splice(index, 1);
      if (pending.length === 0) this._pendingByResource.delete(job.resourceKey);
    }

    job.state = JOB_STATES.CANCELLED;
    job.cancelledAt = now();
    job.finishedAt = job.cancelledAt;
    this._emit('cancelled', job);
    this._recordTerminal(job);
    this._trimHistory();
    return true;
  }

  _scheduleDrain(resourceKey) {
    if (this._runningResources.has(resourceKey) || this._scheduledResources.has(resourceKey)) {
      return;
    }

    this._scheduledResources.add(resourceKey);
    scheduleMicrotask(() => {
      this._scheduledResources.delete(resourceKey);
      this._drain(resourceKey).catch((error) => {
        this._emit('queue-error', null, {
          resourceKey,
          error: serializeError(error)
        });
      });
    });
  }

  async _drain(resourceKey) {
    if (this._runningResources.has(resourceKey)) return;
    this._runningResources.add(resourceKey);

    try {
      const pending = this._pendingByResource.get(resourceKey);
      while (pending && pending.length > 0) {
        const job = pending.shift();
        if (!job || job.state !== JOB_STATES.QUEUED) continue;

        job.state = JOB_STATES.RUNNING;
        job.startedAt = now();
        this._emit('started', job);

        try {
          job.result = await Promise.resolve().then(() => job.task(Object.freeze({
            id: job.id,
            resourceKey: job.resourceKey,
            metadata: cloneValue(job.metadata)
          })));
          job.state = JOB_STATES.SUCCEEDED;
          job.finishedAt = now();
          this._emit('succeeded', job);
        } catch (error) {
          job.state = JOB_STATES.FAILED;
          job.error = serializeError(error);
          job.finishedAt = now();
          this._emit('failed', job);
        }

        this._recordTerminal(job);
        this._trimHistory();
      }

      if (pending && pending.length === 0 && this._pendingByResource.get(resourceKey) === pending) {
        this._pendingByResource.delete(resourceKey);
      }
    } finally {
      this._runningResources.delete(resourceKey);

      if ((this._pendingByResource.get(resourceKey) || []).length > 0) {
        this._scheduleDrain(resourceKey);
      } else {
        this._emit('idle', null, { resourceKey });
      }
    }
  }

  _snapshot(job) {
    return {
      id: job.id,
      resourceKey: job.resourceKey,
      state: job.state,
      metadata: cloneValue(job.metadata),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      cancelledAt: job.cancelledAt,
      result: cloneValue(job.result),
      error: job.error ? { ...job.error } : null
    };
  }

  _emit(type, job, extra = {}) {
    if (!this.onEvent) return;

    try {
      const event = Object.freeze({
        type,
        at: now(),
        job: job ? this._snapshot(job) : null,
        ...extra
      });
      const callbackResult = this.onEvent(event);
      if (callbackResult && typeof callbackResult.catch === 'function') {
        callbackResult.catch(() => {});
      }
    } catch {
    }
  }

  _trimHistory() {
    while (this._terminalJobIds.length > this.maxHistory) {
      const oldestJobId = this._terminalJobIds.shift();
      const oldestJob = this._jobs.get(oldestJobId);
      if (oldestJob && TERMINAL_STATES.has(oldestJob.state)) {
        this._jobs.delete(oldestJobId);
      }
    }
  }

  _recordTerminal(job) {
    this._terminalJobIds.push(job.id);
  }

  _validateResourceKey(resourceKey) {
    if (typeof resourceKey !== 'string' || resourceKey.trim().length === 0) {
      throw new TypeError('resourceKey must be a non-empty string');
    }
    return resourceKey.trim();
  }

  _createId() {
    this._sequence += 1;
    return `${this.idPrefix}_${Date.now().toString(36)}_${this._sequence.toString(36)}`;
  }
}


function now() {
  return new Date().toISOString();
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Task failed',
      ...(error.stack ? { stack: error.stack } : {})
    };
  }
  return {
    name: 'Error',
    message: typeof error === 'string' ? error : safeString(error)
  };
}

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;

  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {
  }

  if (Array.isArray(value)) return value.map(cloneValue);
  if (value instanceof Date) return new Date(value.getTime());

  const copy = {};
  for (const [key, entry] of Object.entries(value)) copy[key] = cloneValue(entry);
  return copy;
}

function safeString(value) {
  try {
    return JSON.stringify(value) || String(value);
  } catch {
    return String(value);
  }
}
