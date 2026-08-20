import { describe, expect, it } from 'vitest';

import {
  getRequestRateLimitIdentity,
  isTrustedPasswordResetRedirect,
  normalizeIdempotencyKey,
} from '../supabase/functions/make-server-d962235e/httpSecurity';

const headers = (values: Record<string, string>) => ({
  header(name: string) {
    return values[name.toLowerCase()];
  },
});

describe('Edge HTTP security boundary', () => {
  it('trusts only one configured valid proxy address', () => {
    expect(getRequestRateLimitIdentity(
      headers({ 'cf-connecting-ip': '203.0.113.8' }),
      'cf-connecting-ip',
    )).toBe('ip:203.0.113.8');

    expect(getRequestRateLimitIdentity(
      headers({
        'cf-connecting-ip': '203.0.113.8, 10.0.0.1',
        'x-wmatch-install-id': 'a'.repeat(32),
      }),
      'cf-connecting-ip',
    )).toBe(`install:${'a'.repeat(32)}`);
  });

  it('never treats x-forwarded-for as a trusted single-hop header', () => {
    expect(getRequestRateLimitIdentity(
      headers({
        'x-forwarded-for': '203.0.113.8',
        'x-wmatch-install-id': 'b'.repeat(32),
      }),
      'x-forwarded-for',
    )).toBe(`install:${'b'.repeat(32)}`);
  });

  it('binds password reset redirects to exact HTTPS path and 256-bit state', () => {
    const expected = 'https://example.com/WMatch_web/auth/reset-password';
    const state = 'c'.repeat(64);

    expect(isTrustedPasswordResetRedirect(`${expected}?state=${state}`, expected)).toBe(true);
    expect(isTrustedPasswordResetRedirect(`http://example.com/WMatch_web/auth/reset-password?state=${state}`, expected)).toBe(false);
    expect(isTrustedPasswordResetRedirect(`https://example.com/other?state=${state}`, expected)).toBe(false);
    expect(isTrustedPasswordResetRedirect(`${expected}?state=short`, expected)).toBe(false);
  });

  it('accepts bounded idempotency keys only', () => {
    expect(normalizeIdempotencyKey('message:1234')).toBe('message:1234');
    expect(normalizeIdempotencyKey('short')).toBeNull();
    expect(normalizeIdempotencyKey('x'.repeat(181))).toBeNull();
  });
});
