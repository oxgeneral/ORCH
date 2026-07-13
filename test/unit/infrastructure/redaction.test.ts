import { describe, expect, it } from 'vitest';
import { sanitizeForPersistence, sanitizeText } from '../../../src/infrastructure/security/redaction.js';

describe('redaction', () => {
  it('redacts quoted key-value secrets', () => {
    expect(sanitizeText('{"api_key":"supersecret12345"}')).toBe('{"api_key":"[REDACTED]"}');
    expect(sanitizeText('TOKEN="supersecret12345"')).toBe('TOKEN="[REDACTED]"');
    expect(sanitizeText('password: "supersecret12345"')).toBe('password: "[REDACTED]"');
    expect(sanitizeText('Authorization: Basic abcdef12345')).toBe('Authorization: Basic [REDACTED]');
    expect(sanitizeText('Set-Cookie: session=abcdef12345; HttpOnly')).toBe('Set-Cookie: [REDACTED]');
    expect(sanitizeText('cookies="session=abcdef12345"')).toBe('cookies="[REDACTED]"');
    expect(sanitizeText('{"access_token":"abcdef12345"}')).toBe('{"access_token":"[REDACTED]"}');
  });

  it('redacts object values when keys are sensitive', () => {
    expect(sanitizeForPersistence({ token: 'opaque-session-token', private_key: 'key', cookies: 'sid=1', nested: { password: 'pw' } })).toEqual({
      token: '[REDACTED]',
      private_key: '[REDACTED]',
      cookies: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });
  });
});
