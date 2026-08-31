/**
 * Route-handler helpers: uniform JSON envelopes, error mapping and CSRF checks.
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { errors, isDomainError } from '@/domain/errors';
import { fieldErrors } from './validation';

export interface ApiErrorBody {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly fields?: Record<string, string>;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

/**
 * Maps any thrown value to a safe response. Unknown errors are logged
 * server-side and reported to the client as a generic Persian message — stack
 * traces and driver details never cross the wire.
 */
export function jsonError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false as const,
        code: 'VALIDATION_FAILED',
        message: 'اطلاعات ارسال‌شده معتبر نیست.',
        fields: fieldErrors(error),
      },
      { status: 422 },
    );
  }
  if (isDomainError(error)) {
    return NextResponse.json(
      { ok: false as const, code: error.code, message: error.message },
      { status: error.status },
    );
  }
  console.error('[api] unhandled error:', error);
  return NextResponse.json(
    { ok: false as const, code: 'INTERNAL_ERROR', message: 'خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.' },
    { status: 500 },
  );
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence for route handlers. Session cookies are SameSite=Lax, which
 * already blocks cross-site POSTs from forms; this adds an explicit Origin/Host
 * match so the protection does not rest on browser behaviour alone.
 */
export function assertSameOrigin(request: Request): void {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return;

  const origin = request.headers.get('origin');
  if (!origin) return; // same-origin fetch/curl; cookies are SameSite-protected

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw errors.forbidden('مبدأ درخواست معتبر نیست.');
  }
  if (!host || originHost !== host) {
    throw errors.forbidden('درخواست از مبدأ نامعتبر رد شد.');
  }
}

/** Parses a JSON body defensively; a malformed body is a 422, not a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw errors.validation('بدنهٔ درخواست باید JSON معتبر باشد.');
  }
}
