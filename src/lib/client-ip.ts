/**
 * Deriving the client IP behind a reverse proxy.
 *
 * This matters more than it looks: the IP is the rate-limit key for login,
 * registration, checkout and payment callbacks, and it is the identity hashed
 * into the admin audit log. If a client can choose it, it can rotate it per
 * request and every one of those limits becomes decorative — a login
 * brute-force runs unthrottled by appending one header.
 *
 * `X-Forwarded-For` is a *client-supplied* header that proxies append to. Given
 * one nginx in front, a request arriving as
 *
 *     X-Forwarded-For: 203.0.113.9          (sent by the attacker)
 *
 * reaches the app as
 *
 *     X-Forwarded-For: 203.0.113.9, 198.51.100.7
 *                      ^ forged        ^ appended by nginx: the real peer
 *
 * The trustworthy entries are the ones **your own infrastructure appended**,
 * counted from the right. Reading the leftmost entry — the common shortcut —
 * reads exactly the part the attacker controls.
 *
 * So the number of proxies must be configured, not guessed. `TRUSTED_PROXY_HOPS`
 * is that number, and it defaults to 0: with no declared proxy the header is
 * ignored entirely, because an unproxied deployment has no trustworthy entry in
 * it at all.
 */

/** Sentinel used when no trustworthy address can be derived. */
export const UNKNOWN_CLIENT_IP = 'unknown';

export interface ProxyHeaders {
  forwardedFor: string | null;
  realIp: string | null;
}

/**
 * @param hops number of reverse proxies between the internet and this process.
 *             0 = directly exposed; 1 = one nginx/Caddy; 2 = CDN + nginx.
 */
export function deriveClientIp(headers: ProxyHeaders, hops: number): string {
  if (!Number.isInteger(hops) || hops < 1) {
    /*
     * Nothing in the request can be trusted to name the client. Returning a
     * constant is deliberate and is the safe failure: every unproxied caller
     * shares one rate-limit bucket, which throttles the whole deployment rather
     * than throttling nobody. `assertProxyConfiguration` warns about it at
     * startup so it is never silently the case in production.
     */
    return UNKNOWN_CLIENT_IP;
  }

  const chain = (headers.forwardedFor ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (chain.length > 0) {
    // Count from the right: those entries were appended by our own hops.
    const index = chain.length - hops;
    const candidate = chain[index];
    if (candidate && isPlausibleIp(candidate)) return candidate;

    /*
     * Fewer entries than declared hops means the request did not traverse the
     * expected chain — a direct hit on the origin, or a misconfigured proxy.
     * Trusting the leftmost entry here is precisely the bypass, so refuse.
     */
    return UNKNOWN_CLIENT_IP;
  }

  // `X-Real-IP` is single-valued and equally forgeable, so it is honoured only
  // when a proxy is declared and set no forwarding chain.
  const realIp = headers.realIp?.trim();
  return realIp && isPlausibleIp(realIp) ? realIp : UNKNOWN_CLIENT_IP;
}

/**
 * Rejects values that are not addresses. A garbage entry would otherwise become
 * its own rate-limit bucket, which is the same bypass by another route.
 */
export function isPlausibleIp(value: string): boolean {
  if (value.length > 45) return false;
  // IPv4, optionally with a port.
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/.test(value)) {
    const octets = value.split(':')[0]!.split('.');
    return octets.every((o) => Number(o) <= 255);
  }
  // IPv6, optionally bracketed and with a port.
  const bare = value.replace(/^\[/, '').replace(/](:\d{1,5})?$/, '');
  return /^[0-9a-fA-F:]+$/.test(bare) && bare.includes(':');
}

export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
