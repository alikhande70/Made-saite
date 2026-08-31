/**
 * Wrapper for admin route handlers: enforces same-origin, admin role and a
 * uniform error envelope in one place, so no handler can forget the check.
 */
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { assertSameOrigin, jsonError } from './http';
import { getClientIpHash, requireAdmin } from './session';
import type { AuthUser } from '@/application/auth-service';

/** Context handed to admin handlers, carrying everything the audit log needs. */
export interface AdminContext {
  admin: AuthUser;
  ipHash: string;
}

export function adminRoute<C = unknown>(
  handler: (request: NextRequest, admin: AuthUser, ctx: C, audit: AdminContext) => Promise<NextResponse>,
) {
  return async (request: NextRequest, ctx: C): Promise<NextResponse> => {
    try {
      assertSameOrigin(request);
      const admin = await requireAdmin();
      const ipHash = await getClientIpHash();
      return await handler(request, admin, ctx, { admin, ipHash });
    } catch (e) {
      return jsonError(e);
    }
  };
}
