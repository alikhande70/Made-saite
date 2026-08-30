import type { NextRequest } from 'next/server';
import { revokeSession } from '@/application/auth-service';
import { assertSameOrigin, jsonError, jsonOk } from '@/lib/http';
import { clearSessionCookie, getSessionToken } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await revokeSession(await getSessionToken());
    await clearSessionCookie();
    return jsonOk({ signedOut: true });
  } catch (e) {
    return jsonError(e);
  }
}
