import { describe, it, expect } from 'vitest';
import { AdapterErrorKind, ERROR_HINTS, classifyAdapterError } from '../../../src/domain/errors.js';

describe('AdapterErrorKind', () => {
  it('has 7 enum values', () => {
    const values = Object.values(AdapterErrorKind);
    expect(values).toHaveLength(7);
  });

  it('enum values are lowercase strings', () => {
    for (const v of Object.values(AdapterErrorKind)) {
      expect(v).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('ERROR_HINTS', () => {
  it('has a hint for every AdapterErrorKind', () => {
    for (const kind of Object.values(AdapterErrorKind)) {
      const hint = ERROR_HINTS[kind];
      expect(hint).toBeDefined();
      expect(hint.message).toBeTruthy();
      expect(hint.fix).toBeTruthy();
    }
  });

  it('adapter_not_found has doctorHint', () => {
    expect(ERROR_HINTS[AdapterErrorKind.ADAPTER_NOT_FOUND].doctorHint).toBe(true);
  });

  it('unknown has doctorHint', () => {
    expect(ERROR_HINTS[AdapterErrorKind.UNKNOWN].doctorHint).toBe(true);
  });

  it('auth_failed has no doctorHint', () => {
    expect(ERROR_HINTS[AdapterErrorKind.AUTH_FAILED].doctorHint).toBeUndefined();
  });
});

describe('classifyAdapterError', () => {
  it('ENOENT → SPAWN_FAILED', () => {
    expect(classifyAdapterError('spawn ENOENT')).toBe(AdapterErrorKind.SPAWN_FAILED);
  });

  it('spawn failed → SPAWN_FAILED', () => {
    expect(classifyAdapterError('Spawn failed: /usr/bin/foo')).toBe(AdapterErrorKind.SPAWN_FAILED);
  });

  it('command not found → ADAPTER_NOT_FOUND', () => {
    expect(classifyAdapterError('claude: command not found')).toBe(AdapterErrorKind.ADAPTER_NOT_FOUND);
  });

  it('not found → ADAPTER_NOT_FOUND', () => {
    expect(classifyAdapterError('CLI not found on PATH')).toBe(AdapterErrorKind.ADAPTER_NOT_FOUND);
  });

  it('auth → AUTH_FAILED', () => {
    expect(classifyAdapterError('Authentication failed')).toBe(AdapterErrorKind.AUTH_FAILED);
  });

  it('unauthorized → AUTH_FAILED', () => {
    expect(classifyAdapterError('Request unauthorized')).toBe(AdapterErrorKind.AUTH_FAILED);
  });

  it('401 → AUTH_FAILED', () => {
    expect(classifyAdapterError('HTTP 401 error')).toBe(AdapterErrorKind.AUTH_FAILED);
  });

  it('invalid api key → AUTH_FAILED', () => {
    expect(classifyAdapterError('Invalid API key provided')).toBe(AdapterErrorKind.AUTH_FAILED);
  });

  it('timeout → TIMEOUT', () => {
    expect(classifyAdapterError('Request timeout after 60s')).toBe(AdapterErrorKind.TIMEOUT);
  });

  it('timed out → TIMEOUT', () => {
    expect(classifyAdapterError('Connection timed out')).toBe(AdapterErrorKind.TIMEOUT);
  });

  it('ETIMEDOUT → TIMEOUT', () => {
    expect(classifyAdapterError('connect ETIMEDOUT 1.2.3.4:443')).toBe(AdapterErrorKind.TIMEOUT);
  });

  it('rate limit → RATE_LIMIT', () => {
    expect(classifyAdapterError('Rate limit exceeded')).toBe(AdapterErrorKind.RATE_LIMIT);
  });

  it('429 → RATE_LIMIT', () => {
    expect(classifyAdapterError('HTTP 429 Too Many Requests')).toBe(AdapterErrorKind.RATE_LIMIT);
  });

  it('too many requests → RATE_LIMIT', () => {
    expect(classifyAdapterError('Too many requests, slow down')).toBe(AdapterErrorKind.RATE_LIMIT);
  });

  it('non-zero exitCode without keyword → PROCESS_CRASH', () => {
    expect(classifyAdapterError('Segmentation fault', 139)).toBe(AdapterErrorKind.PROCESS_CRASH);
  });

  it('exitCode 1 → PROCESS_CRASH', () => {
    expect(classifyAdapterError('Unknown error occurred', 1)).toBe(AdapterErrorKind.PROCESS_CRASH);
  });

  it('exitCode 0 + no keyword → UNKNOWN', () => {
    expect(classifyAdapterError('Something weird', 0)).toBe(AdapterErrorKind.UNKNOWN);
  });

  it('no exitCode + no keyword → UNKNOWN', () => {
    expect(classifyAdapterError('Something else')).toBe(AdapterErrorKind.UNKNOWN);
  });

  it('ENOENT takes priority over exitCode', () => {
    expect(classifyAdapterError('ENOENT /bin/claude', 127)).toBe(AdapterErrorKind.SPAWN_FAILED);
  });

  it('auth takes priority over exitCode', () => {
    expect(classifyAdapterError('Unauthorized access', 1)).toBe(AdapterErrorKind.AUTH_FAILED);
  });

  it('case insensitive matching', () => {
    expect(classifyAdapterError('RATE LIMIT exceeded')).toBe(AdapterErrorKind.RATE_LIMIT);
    expect(classifyAdapterError('AUTHENTICATION FAILED')).toBe(AdapterErrorKind.AUTH_FAILED);
    expect(classifyAdapterError('TIMEOUT')).toBe(AdapterErrorKind.TIMEOUT);
  });
});
