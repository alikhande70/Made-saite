/**
 * Client-IP derivation is a security control, not a convenience.
 *
 * It is the rate-limit key for login, registration, checkout and payment
 * callbacks. If a caller can choose it, it rotates per request and every one of
 * those limits stops working.
 */
import { describe, expect, it } from 'vitest';
import { deriveClientIp, isPlausibleIp, UNKNOWN_CLIENT_IP } from '@/lib/client-ip';

const xff = (forwardedFor: string | null, realIp: string | null = null) => ({ forwardedFor, realIp });

describe('behind a declared proxy', () => {
  it('takes the entry the proxy appended, not the one the client sent', () => {
    // The attacker sends 203.0.113.9; nginx appends the true peer 198.51.100.7.
    expect(deriveClientIp(xff('203.0.113.9, 198.51.100.7'), 1)).toBe('198.51.100.7');
  });

  it('counts hops from the right for a two-proxy chain', () => {
    expect(deriveClientIp(xff('203.0.113.9, 198.51.100.7, 10.0.0.5'), 2)).toBe('198.51.100.7');
  });

  it('never returns a forged leading entry, however many are supplied', () => {
    const forged = Array.from({ length: 20 }, (_, i) => `203.0.113.${i}`).join(', ');
    const derived = deriveClientIp(xff(`${forged}, 198.51.100.7`), 1);
    expect(derived).toBe('198.51.100.7');
    expect(derived.startsWith('203.0.113.')).toBe(false);
  });

  it('refuses when the chain is shorter than the declared hops', () => {
    // A direct hit on the origin, or a misconfigured proxy. Falling back to the
    // leftmost entry here would be exactly the bypass.
    expect(deriveClientIp(xff('203.0.113.9'), 2)).toBe(UNKNOWN_CLIENT_IP);
  });

  it('honours X-Real-IP only when no forwarding chain is present', () => {
    expect(deriveClientIp(xff(null, '198.51.100.7'), 1)).toBe('198.51.100.7');
    // A chain wins, because it is the one the proxy actually appended to.
    expect(deriveClientIp(xff('203.0.113.9, 198.51.100.7', '203.0.113.1'), 1)).toBe('198.51.100.7');
  });

  it('rejects values that are not addresses', () => {
    // Otherwise each garbage value becomes its own bucket — the same bypass.
    expect(deriveClientIp(xff('not-an-ip'), 1)).toBe(UNKNOWN_CLIENT_IP);
    expect(deriveClientIp(xff('999.999.999.999'), 1)).toBe(UNKNOWN_CLIENT_IP);
    expect(deriveClientIp(xff("'; drop table users; --"), 1)).toBe(UNKNOWN_CLIENT_IP);
  });

  it('accepts IPv4 and IPv6, with or without a port', () => {
    expect(deriveClientIp(xff('198.51.100.7'), 1)).toBe('198.51.100.7');
    expect(deriveClientIp(xff('198.51.100.7:44321'), 1)).toBe('198.51.100.7:44321');
    expect(deriveClientIp(xff('2001:db8::1'), 1)).toBe('2001:db8::1');
  });
});

describe('with no proxy declared', () => {
  it('ignores the forwarding header entirely', () => {
    // Nothing in the request can be trusted to name the client, so the safe
    // failure is one shared bucket — throttling everyone rather than nobody.
    expect(deriveClientIp(xff('203.0.113.9, 198.51.100.7'), 0)).toBe(UNKNOWN_CLIENT_IP);
    expect(deriveClientIp(xff(null, '203.0.113.9'), 0)).toBe(UNKNOWN_CLIENT_IP);
  });

  it('treats a negative or non-integer hop count as no proxy', () => {
    expect(deriveClientIp(xff('203.0.113.9'), -1)).toBe(UNKNOWN_CLIENT_IP);
    expect(deriveClientIp(xff('203.0.113.9'), 1.5)).toBe(UNKNOWN_CLIENT_IP);
  });
});

describe('address plausibility', () => {
  it('accepts real addresses and rejects the rest', () => {
    expect(isPlausibleIp('10.0.0.1')).toBe(true);
    expect(isPlausibleIp('::1')).toBe(true);
    expect(isPlausibleIp('[2001:db8::1]:443')).toBe(true);
    expect(isPlausibleIp('localhost')).toBe(false);
    expect(isPlausibleIp('')).toBe(false);
    expect(isPlausibleIp('a'.repeat(60))).toBe(false);
  });
});
