/**
 * Wrapper for admin route handlers: enforces same-origin, admin role and a
 * uniform error envelope in one place, so no handler can forget the check.
 */
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { assertSameOrigin, jsonError } from './http';
import { requireAdmin } from './session';
import type { AuthUser } from '@/application/auth-service';

export function adminRoute<C = unknown>(
  handler: (request: NextRequest, admin: AuthUser, ctx: C) => Promise<NextResponse>,
) {
  return async (request: NextRequest, ctx: C): Promise<NextResponse> => {
    try {
      assertSameOrigin(request);
      const admin = await requireAdmin();
      return await handler(request, admin, ctx);
    } catch (e) {
      return jsonError(e);
    }
  };
}
