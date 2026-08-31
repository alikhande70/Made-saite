/**
 * Harness for calling route handlers directly.
 *
 * Next's `cookies()`/`headers()` read from an async request store, so the tests
 * mock `next/headers` with a per-call context. That keeps these tests fast and
 * hermetic while still exercising the *real* handler code — validation, CSRF
 * checks, authorization and error mapping all run exactly as in production.
 */
import { vi } from 'vitest';

interface CookieJar {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options?: unknown): void;
}

export interface RequestContext {
  cookies: Map<string, string>;
  headers: Map<string, string>;
}

export const ctx: RequestContext = { cookies: new Map(), headers: new Map() };

export function resetContext(): void {
  ctx.cookies.clear();
  ctx.headers.clear();
  ctx.headers.set('x-forwarded-for', '203.0.113.10');
  ctx.headers.set('user-agent', 'vitest');
  ctx.headers.set('host', 'localhost:3000');
}

resetContext();

vi.mock('next/headers', () => ({
  cookies: async (): Promise<CookieJar> => ({
    get: (name: string) => {
      const value = ctx.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      if (value === '') ctx.cookies.delete(name);
      else ctx.cookies.set(name, value);
    },
  }),
  headers: async () => ({
    get: (name: string) => ctx.headers.get(name.toLowerCase()) ?? null,
  }),
}));

// `server-only` throws when imported outside a React Server Component build.
vi.mock('server-only', () => ({}));

export interface ApiResponse<T = unknown> {
  status: number;
  body: { ok: boolean; data?: T; code?: string; message?: string; fields?: Record<string, string> };
}

/** Builds a Request the handlers can consume. */
export function makeRequest(
  url: string,
  init: { method?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json', ...init.headers });
  // Same-origin by default; pass `origin: null` to omit, or a value to forge.
  if (init.origin !== null) headers.set('origin', init.origin ?? 'http://localhost:3000');
  headers.set('host', 'localhost:3000');

  return new Request(new URL(url, 'http://localhost:3000'), {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

export async function readResponse<T = unknown>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text();
  let body: ApiResponse<T>['body'];
  try {
    body = JSON.parse(text) as ApiResponse<T>['body'];
  } catch {
    body = { ok: false, message: text };
  }
  return { status: response.status, body };
}

/** Signs a user in by putting a real session token in the mocked cookie jar. */
export async function signIn(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import('@/application/auth-service');
  const { getDb } = await import('@/infrastructure/db/client');
  const { token } = await createSession(getDb(), userId);
  ctx.cookies.set(SESSION_COOKIE, token);
  return token;
}

export function signOut(): void {
  ctx.cookies.delete('ms_session');
}
