import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const AUTH_TOKEN_ENV = 'NEXUSFLOW_AUTH_TOKEN';

const DEFAULT_JSON_LIMIT = 1_048_576;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_MAX = 60;
const DEFAULT_RATE_KEYS = 10_000;
const OWN = Object.prototype.hasOwnProperty;

export class HttpError extends Error {
  constructor(statusCode, code, message, { expose = statusCode < 500 } = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = validStatus(statusCode) ? statusCode : 500;
    this.code = typeof code === 'string' && code ? code : 'INTERNAL_ERROR';
    this.expose = Boolean(expose) && this.statusCode < 500;
  }
}

export function getConfiguredAuthToken(env = process.env) {
  const value = env?.[AUTH_TOKEN_ENV];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getRequestIp(request, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = getHeader(request, 'x-forwarded-for');
    if (forwarded) {
      const firstAddress = forwarded.split(',')[0]?.trim();
      if (firstAddress) return firstAddress;
    }
  }

  return request?.socket?.remoteAddress
    ?? request?.connection?.remoteAddress
    ?? null;
}

export function isLoopbackAddress(address) {
  if (typeof address !== 'string' || !address.trim()) return false;

  let value = address.trim().toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (!value || value.includes('%')) return false;

  const ipv4 = parseIpv4(value);
  if (ipv4) return ipv4[0] === 127;

  const ipv6 = expandIpv6(value);
  if (!ipv6) return false;

  if (ipv6.slice(0, 7).every((part) => part === 0) && ipv6[7] === 1) {
    return true;
  }

  return ipv6.slice(0, 5).every((part) => part === 0)
    && ipv6[5] === 0xffff
    && (ipv6[6] >> 8) === 127;
}

export function isRequestFromLoopback(request, options) {
  return isLoopbackAddress(getRequestIp(request, options));
}

export function readBearerToken(request) {
  const authorization = getHeader(request, 'authorization');
  const match = typeof authorization === 'string'
    ? /^\s*Bearer\s+([^\s,]+)\s*$/i.exec(authorization)
    : null;
  return match?.[1] ?? null;
}

export function verifyBearerToken(request, { authToken = getConfiguredAuthToken() } = {}) {
  const expected = normalizeAuthToken(authToken);
  const supplied = readBearerToken(request);
  return Boolean(expected && supplied && tokensEqual(supplied, expected));
}

export function createHttpAccessMiddleware({
  authToken = getConfiguredAuthToken(),
  trustProxy = false,
} = {}) {
  const expected = normalizeAuthToken(authToken);

  return function nexusFlowAccessControl(request, response, next) {
    const allowed = expected
      ? verifyBearerToken(request, { authToken: expected })
      : isRequestFromLoopback(request, { trustProxy });

    if (allowed) return typeof next === 'function' ? next() : undefined;

    const error = expected
      ? new HttpError(401, 'AUTH_REQUIRED', 'Authentication required.')
      : new HttpError(403, 'LOCAL_ONLY', 'Remote access is disabled.');

    if (expected && typeof response?.setHeader === 'function') {
      response.setHeader('WWW-Authenticate', 'Bearer realm="NexusFlow"');
    }
    return sendSafeError(response, error);
  };
}

export function getWebSocketUrlToken(request, { tokenParam = 'token' } = {}) {
  if (typeof request?.url !== 'string' || !isSafeQueryKey(tokenParam)) return null;

  try {
    const url = new URL(request.url, 'http://nexusflow.invalid');
    const values = url.searchParams.getAll(tokenParam);
    return values.length === 1 && values[0] ? values[0] : null;
  } catch {
    return null;
  }
}

export function normalizeOrigin(origin) {
  if (typeof origin !== 'string' || !origin.trim()) return null;

  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin === 'null' ? null : url.origin;
  } catch {
    return null;
  }
}

export function isOriginAllowed(origin, allowedOrigins = [], { allowMissingOrigin = true } = {}) {
  if (origin === undefined || origin === null || origin === '') return allowMissingOrigin;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  const entries = typeof allowedOrigins === 'string'
    ? [allowedOrigins]
    : allowedOrigins && typeof allowedOrigins[Symbol.iterator] === 'function'
      ? allowedOrigins
      : [];

  for (const entry of entries) {
    if (normalizeOrigin(entry) === normalizedOrigin) return true;
  }
  return false;
}

export function authorizeWebSocketUpgrade(request, {
  authToken = getConfiguredAuthToken(),
  tokenParam = 'token',
  allowedOrigins = [],
  allowMissingOrigin = true,
  trustProxy = false,
} = {}) {
  const expected = normalizeAuthToken(authToken);
  const clientIp = getRequestIp(request, { trustProxy });

  if (expected) {
    const supplied = getWebSocketUrlToken(request, { tokenParam });
    if (!supplied || !tokensEqual(supplied, expected)) {
      return upgradeFailure(401, 'AUTH_REQUIRED', clientIp);
    }
  } else if (!isLoopbackAddress(clientIp)) {
    return upgradeFailure(403, 'LOCAL_ONLY', clientIp);
  }

  if (!isOriginAllowed(getHeader(request, 'origin'), allowedOrigins, { allowMissingOrigin })) {
    return upgradeFailure(403, 'ORIGIN_NOT_ALLOWED', clientIp);
  }

  return { ok: true, statusCode: 101, code: 'OK', clientIp };
}

export function createRateLimiter({
  windowMs = DEFAULT_RATE_WINDOW_MS,
  max = DEFAULT_RATE_MAX,
  maxKeys = DEFAULT_RATE_KEYS,
  keyGenerator = (request, options) => getRequestIp(request, options) || 'unknown',
  trustProxy = false,
  now = Date.now,
} = {}) {
  const safeWindowMs = positiveInteger(windowMs, 'windowMs');
  const safeMax = positiveInteger(max, 'max');
  const safeMaxKeys = positiveInteger(maxKeys, 'maxKeys');
  if (typeof keyGenerator !== 'function') throw new TypeError('keyGenerator must be a function.');
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  const buckets = new Map();
  let lastPruneAt = 0;

  function currentTime() {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  }

  function prune(timestamp) {
    if (timestamp - lastPruneAt < safeWindowMs && buckets.size < safeMaxKeys) return;
    lastPruneAt = timestamp;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= timestamp) buckets.delete(key);
    }
  }

  function check(key) {
    const timestamp = currentTime();
    prune(timestamp);
    const safeKey = rateLimitKey(key);
    let bucket = buckets.get(safeKey);

    if (!bucket || bucket.resetAt <= timestamp) {
      if (!bucket && buckets.size >= safeMaxKeys) buckets.delete(buckets.keys().next().value);
      bucket = { count: 0, resetAt: timestamp + safeWindowMs };
      buckets.set(safeKey, bucket);
    }

    if (bucket.count >= safeMax) {
      return rateLimitResult(false, bucket, safeMax, timestamp);
    }

    bucket.count += 1;
    return rateLimitResult(true, bucket, safeMax, timestamp);
  }

  function middleware(request, response, next) {
    const result = check(keyGenerator(request, { trustProxy }));
    setRateLimitHeaders(response, result);
    if (result.allowed) return typeof next === 'function' ? next() : undefined;
    return sendSafeError(response, new HttpError(429, 'RATE_LIMITED', 'Too many requests.'));
  }

  return {
    check,
    middleware,
    reset: () => buckets.clear(),
    get size() {
      return buckets.size;
    },
  };
}

export async function readJsonBody(request, {
  limitBytes = DEFAULT_JSON_LIMIT,
  requireJsonContentType = false,
} = {}) {
  const safeLimit = positiveInteger(limitBytes, 'limitBytes');
  if (request?.body !== undefined) return request.body;

  if (requireJsonContentType && !isJsonContentType(getHeader(request, 'content-type'))) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected an application/json request body.');
  }

  const contentLength = Number(getHeader(request, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > safeLimit) {
    request?.resume?.();
    throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  }

  if (!request || typeof request[Symbol.asyncIterator] !== 'function') {
    throw new HttpError(400, 'INVALID_BODY', 'Unable to read request body.');
  }

  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > safeLimit) {
        request.resume?.();
        throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_BODY', 'Unable to read request body.');
  }

  const source = Buffer.concat(chunks).toString('utf8');
  if (!source.trim()) throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON body.');

  try {
    return JSON.parse(source);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON body.');
  }
}

export function validateJsonSchema(value, schema, { maxErrors = 25 } = {}) {
  const safeMaxErrors = positiveInteger(maxErrors, 'maxErrors');
  const errors = [];
  const addError = (path, message) => {
    if (errors.length < safeMaxErrors) errors.push({ path, message });
  };

  function visit(current, currentSchema, path) {
    if (errors.length >= safeMaxErrors) return;
    if (!isSchemaObject(currentSchema)) {
      addError(path, 'Invalid schema.');
      return;
    }

    if (OWN.call(currentSchema, 'type') && !matchesType(current, currentSchema.type)) {
      addError(path, `Expected ${schemaTypeName(currentSchema.type)}.`);
      return;
    }

    if (Array.isArray(currentSchema.enum) && !currentSchema.enum.some((entry) => jsonEqual(entry, current))) {
      addError(path, 'Value is not allowed.');
    }

    if (typeof current === 'string') {
      if (isFiniteNumber(currentSchema.minLength) && current.length < currentSchema.minLength) {
        addError(path, `Must contain at least ${currentSchema.minLength} characters.`);
      }
      if (isFiniteNumber(currentSchema.maxLength) && current.length > currentSchema.maxLength) {
        addError(path, `Must contain at most ${currentSchema.maxLength} characters.`);
      }
      if (OWN.call(currentSchema, 'pattern')) {
        const expression = patternFromSchema(currentSchema.pattern);
        if (!expression) addError(path, 'Invalid schema pattern.');
        else if (!expression.test(current)) addError(path, 'Has an invalid format.');
      }
    }

    if (typeof current === 'number' && Number.isFinite(current)) {
      if (isFiniteNumber(currentSchema.minimum) && current < currentSchema.minimum) {
        addError(path, `Must be at least ${currentSchema.minimum}.`);
      }
      if (isFiniteNumber(currentSchema.maximum) && current > currentSchema.maximum) {
        addError(path, `Must be at most ${currentSchema.maximum}.`);
      }
    }

    if (Array.isArray(current)) {
      if (isFiniteNumber(currentSchema.minItems) && current.length < currentSchema.minItems) {
        addError(path, `Must contain at least ${currentSchema.minItems} items.`);
      }
      if (isFiniteNumber(currentSchema.maxItems) && current.length > currentSchema.maxItems) {
        addError(path, `Must contain at most ${currentSchema.maxItems} items.`);
      }
      if (isSchemaObject(currentSchema.items)) {
        current.forEach((item, index) => visit(item, currentSchema.items, `${path}[${index}]`));
      }
    }

    if (isJsonObject(current)) {
      const properties = isSchemaObject(currentSchema.properties) ? currentSchema.properties : {};
      const required = Array.isArray(currentSchema.required) ? currentSchema.required : [];
      for (const property of required) {
        if (typeof property === 'string' && !OWN.call(current, property)) {
          addError(propertyPath(path, property), 'Is required.');
        }
      }

      for (const [property, child] of Object.entries(properties)) {
        if (OWN.call(current, property)) visit(current[property], child, propertyPath(path, property));
      }

      if (currentSchema.additionalProperties === false) {
        for (const property of Object.keys(current)) {
          if (!OWN.call(properties, property)) addError(propertyPath(path, property), 'Is not allowed.');
        }
      } else if (isSchemaObject(currentSchema.additionalProperties)) {
        for (const property of Object.keys(current)) {
          if (!OWN.call(properties, property)) {
            visit(current[property], currentSchema.additionalProperties, propertyPath(path, property));
          }
        }
      }
    }
  }

  visit(value, schema, '$');
  return { valid: errors.length === 0, errors };
}

export function assertJsonSchema(value, schema, options) {
  const result = validateJsonSchema(value, schema, options);
  if (!result.valid) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body does not match the expected format.');
  }
  return value;
}

export async function readValidatedJsonBody(request, schema, options = {}) {
  const body = await readJsonBody(request, options);
  return assertJsonSchema(body, schema, options);
}

export function safeErrorPayload(error) {
  if (error instanceof HttpError && error.expose) {
    return {
      statusCode: error.statusCode,
      body: { error: { code: error.code, message: error.message } },
    };
  }

  return {
    statusCode: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } },
  };
}

export function sendSafeError(response, error) {
  const payload = safeErrorPayload(error);
  if (!response || response.headersSent || response.writableEnded) return payload;

  if (typeof response.status === 'function' && typeof response.json === 'function') {
    response.status(payload.statusCode).json(payload.body);
    return payload;
  }

  response.statusCode = payload.statusCode;
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  response.setHeader?.('Cache-Control', 'no-store');
  response.end?.(JSON.stringify(payload.body));
  return payload;
}

function normalizeAuthToken(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function tokensEqual(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length > 0
    && suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function getHeader(request, name) {
  const headers = request?.headers;
  if (!headers) return undefined;
  const target = name.toLowerCase();
  const values = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === target)
    .map(([, value]) => value);

  return values.length === 1 && typeof values[0] === 'string' ? values[0] : undefined;
}

function parseIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const numbers = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    if (number > 255) return null;
    numbers.push(number);
  }
  return numbers;
}

function expandIpv6(value) {
  if (isIP(value) !== 6) return null;
  let address = value;

  if (address.includes('.')) {
    const separator = address.lastIndexOf(':');
    const ipv4 = parseIpv4(address.slice(separator + 1));
    if (separator < 0 || !ipv4) return null;
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    address = `${address.slice(0, separator)}:${high}:${low}`;
  }

  const doubleColon = address.indexOf('::');
  if (doubleColon !== address.lastIndexOf('::')) return null;
  const left = doubleColon >= 0 ? address.slice(0, doubleColon) : address;
  const right = doubleColon >= 0 ? address.slice(doubleColon + 2) : '';
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const parts = [...leftParts, ...rightParts];
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;

  if (doubleColon < 0 && parts.length !== 8) return null;
  if (doubleColon >= 0 && parts.length >= 8) return null;

  const missing = 8 - parts.length;
  const expanded = doubleColon >= 0
    ? [...leftParts, ...Array(missing).fill('0'), ...rightParts]
    : parts;
  return expanded.map((part) => Number.parseInt(part, 16));
}

function isSafeQueryKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value);
}

function upgradeFailure(statusCode, code, clientIp) {
  return { ok: false, statusCode, code, message: 'WebSocket upgrade denied.', clientIp };
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return number;
}

function rateLimitKey(value) {
  const key = typeof value === 'string' ? value : String(value ?? 'unknown');
  return key.slice(0, 512) || 'unknown';
}

function rateLimitResult(allowed, bucket, max, timestamp) {
  return {
    allowed,
    limit: max,
    remaining: Math.max(0, max - bucket.count),
    retryAfterMs: allowed ? 0 : Math.max(0, bucket.resetAt - timestamp),
    resetAt: bucket.resetAt,
  };
}

function setRateLimitHeaders(response, result) {
  if (typeof response?.setHeader !== 'function') return;
  response.setHeader('X-RateLimit-Limit', String(result.limit));
  response.setHeader('X-RateLimit-Remaining', String(result.remaining));
  response.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) response.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
}

function isJsonContentType(contentType) {
  return typeof contentType === 'string'
    && /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType);
}

function isSchemaObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesType(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => {
    switch (type) {
      case 'null': return value === null;
      case 'array': return Array.isArray(value);
      case 'object': return isJsonObject(value);
      case 'string': return typeof value === 'string';
      case 'boolean': return typeof value === 'boolean';
      case 'number': return typeof value === 'number' && Number.isFinite(value);
      case 'integer': return Number.isInteger(value);
      default: return false;
    }
  });
}

function schemaTypeName(type) {
  return Array.isArray(type) ? type.join(' or ') : String(type);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function patternFromSchema(pattern) {
  try {
    return pattern instanceof RegExp
      ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
      : typeof pattern === 'string'
        ? new RegExp(pattern)
        : null;
  } catch {
    return null;
  }
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function propertyPath(parent, property) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? `${parent}.${property}`
    : `${parent}[${JSON.stringify(property)}]`;
}

function validStatus(value) {
  return Number.isInteger(value) && value >= 400 && value <= 599;
}
