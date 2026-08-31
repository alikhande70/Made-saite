/**
 * The production environment contract, checked at startup.
 *
 * The failure this prevents is a deployment that *looks* healthy while being
 * quietly wrong: a live store pointed at a test database, issuing insecure
 * cookies, taking orders through a sandbox gateway, or rate-limiting every
 * visitor into one bucket because nobody declared the reverse proxy.
 *
 * Every check below is a condition that is safe in development and dangerous
 * in production, so all of them are scoped to a real deployment — see
 * `isLiveDeployment`. A production build served on localhost is a verification
 * run (that is how the E2E suite exercises it) and is deliberately exempt.
 */

export type Severity = 'error' | 'warning';

export interface ConfigFinding {
  variable: string;
  severity: Severity;
  message: string;
}

/**
 * True when this process is serving a real site, as opposed to a developer
 * machine or a production build under test on localhost.
 */
export function isLiveDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return false;
  const siteUrl = env.SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? '';
  try {
    const host = new URL(siteUrl).hostname;
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1');
  } catch {
    // An unparseable or missing SITE_URL in production is itself a problem, and
    // is reported below. It is not a reason to assume a test environment.
    return true;
  }
}

const PLACEHOLDER_HINTS = [
  'change-me', 'changeme', 'replace', 'example', 'your-', 'placeholder',
  'secret_here', 'xxx', 'todo', 'e2e_only', 'ci_only', 'dev_only',
];

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Collects everything wrong with the configuration.
 *
 * Returns findings rather than throwing so the caller can report *all* of them
 * at once — an operator fixing one variable per restart is how a ten-minute
 * deployment becomes an hour.
 */
export function inspectProductionConfig(env: NodeJS.ProcessEnv = process.env): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  const error = (variable: string, message: string) =>
    findings.push({ variable, severity: 'error', message });
  const warn = (variable: string, message: string) =>
    findings.push({ variable, severity: 'warning', message });

  if (!isLiveDeployment(env)) return findings;

  /* ── database ─────────────────────────────────────────────────────── */
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    error('DATABASE_URL', 'is required; the application cannot serve any page without it.');
  } else {
    let parsed: URL | null = null;
    try { parsed = new URL(databaseUrl); } catch { /* reported below */ }
    if (!parsed) {
      error('DATABASE_URL', 'is not a valid connection URL.');
    } else {
      const name = parsed.pathname.replace(/^\//, '');
      // Pointing production at a scratch database is silent and catastrophic:
      // it works, and it is wiped by the next test run.
      if (/(^|[_-])(test|e2e|dev|development|scratch|tmp)$/.test(name)) {
        error('DATABASE_URL', `points at "${name}", which is a test or development database.`);
      }
      if (parsed.password && looksLikePlaceholder(parsed.password)) {
        error('DATABASE_URL', 'contains a placeholder password.');
      }
      if (!parsed.password && parsed.username) {
        warn('DATABASE_URL', 'has no password; ensure access is restricted at the network level.');
      }
    }
  }

  /* ── site URL ─────────────────────────────────────────────────────── */
  const siteUrl = env.SITE_URL ?? env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    error('SITE_URL', 'is required: canonical URLs, payment callbacks and cookie security all derive from it.');
  } else {
    try {
      const url = new URL(siteUrl);
      if (url.protocol !== 'https:') {
        // Session cookies are marked Secure from this scheme, so plain HTTP
        // here silently downgrades every cookie in the application.
        error('SITE_URL', 'must be https:// in production; Secure cookies are derived from this scheme.');
      }
      if (url.pathname !== '/' && url.pathname !== '') {
        warn('SITE_URL', 'should be an origin without a path.');
      }
    } catch {
      error('SITE_URL', 'is not a valid URL.');
    }
  }

  /* ── payments ─────────────────────────────────────────────────────── */
  const provider = env.PAYMENT_PROVIDER;
  if (!provider) {
    error('PAYMENT_PROVIDER', 'is required in production; there is no safe default.');
  } else if (provider === 'mock' && env.ALLOW_SANDBOX_PAYMENTS !== 'true') {
    error('PAYMENT_PROVIDER', 'is "mock" on a live deployment; the sandbox records orders as paid with no money taken.');
  }
  if (env.ALLOW_SANDBOX_PAYMENTS === 'true') {
    warn('ALLOW_SANDBOX_PAYMENTS', 'is enabled: sandbox payments are accepted. Correct for staging, never for a real store.');
  }
  if (provider === 'zarinpal' && !env.ZARINPAL_MERCHANT_ID) {
    error('ZARINPAL_MERCHANT_ID', 'is required when PAYMENT_PROVIDER=zarinpal.');
  }
  if (provider === 'idpay' && !env.IDPAY_API_KEY) {
    error('IDPAY_API_KEY', 'is required when PAYMENT_PROVIDER=idpay.');
  }

  /* ── reverse proxy ────────────────────────────────────────────────── */
  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops === undefined || hops.trim() === '' || Number(hops) < 1) {
    // Without a declared hop count the forwarding header is ignored, so every
    // visitor shares one rate-limit bucket. Safe, but it throttles the site.
    warn(
      'TRUSTED_PROXY_HOPS',
      'is not set: X-Forwarded-For is ignored and all visitors share one rate-limit bucket. ' +
      'Set it to the number of reverse proxies in front of this process (usually 1).',
    );
  } else if (!Number.isInteger(Number(hops))) {
    error('TRUSTED_PROXY_HOPS', 'must be a whole number of proxy hops.');
  }

  /* ── secrets ──────────────────────────────────────────────────────── */
  for (const name of ['MOCK_GATEWAY_SECRET', 'ZARINPAL_MERCHANT_ID', 'IDPAY_API_KEY'] as const) {
    const value = env[name];
    if (value && looksLikePlaceholder(value)) {
      error(name, 'still holds a placeholder or test value.');
    }
  }

  return findings;
}

/** Human-readable report, safe to print: it names variables, never values. */
export function formatConfigFindings(findings: ConfigFinding[]): string {
  if (findings.length === 0) return 'Production configuration OK.';
  return findings
    .map((f) => `  ${f.severity === 'error' ? '✖' : '⚠'} ${f.variable} ${f.message}`)
    .join('\n');
}

/**
 * Fails the process on a dangerous configuration.
 *
 * Refusing to start is the point. A misconfigured store that boots takes real
 * orders it cannot honour; one that refuses to boot is a five-minute fix caught
 * by the deployment's own readiness gate.
 */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const findings = inspectProductionConfig(env);
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  if (warnings.length > 0) {
    console.warn(`[config] production configuration warnings:\n${formatConfigFindings(warnings)}`);
  }
  if (errors.length > 0) {
    throw new Error(
      `Refusing to start: unsafe production configuration.\n${formatConfigFindings(errors)}\n` +
      'See docs/OPERATIONS.md for the production environment contract.',
    );
  }
}
