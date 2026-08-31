import type { NextConfig } from 'next';

/**
 * Security headers are applied globally. `Content-Security-Policy` intentionally
 * omits `unsafe-eval` in production; Next's dev overlay needs it in development.
 */
const isDev = process.env.NODE_ENV === 'development';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  /*
   * `standalone` emits a self-contained server with only the modules actually
   * imported, so the runtime image carries no node_modules tree and no build
   * tooling. It is what makes the production image small and its contents
   * auditable.
   */
  output: 'standalone',
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  typedRoutes: false,
  /*
   * IndexNow requires its key file at the domain root as `/<key>.txt`. A root
   * dynamic route would swallow every unmatched root path, and middleware would
   * force an Edge bundle that cannot load `pg`. A rewrite avoids both.
   *
   * The 8–128 character bound is the protocol's own key length rule, and it is
   * what keeps `/robots.txt` (six characters) from matching and being rewritten.
   * The handler still checks the name against the configured key, so rotating
   * the key needs no rebuild.
   */
  async rewrites() {
    return [
      { source: '/:key([A-Za-z0-9-]{8,128}).txt', destination: '/api/indexnow-key/:key' },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
