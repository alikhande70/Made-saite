import type { NextRequest } from 'next/server';
import { registerSchema } from '@/lib/validation';
import { login, mergeGuestCart, register } from '@/application/auth-service';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { clearAnonCartCookie, getAnonCartToken, getClientIp, getClientIpHash, setSessionCookie } from '@/lib/session';
import { consumeRateLimit } from '@/lib/rate-limit';
import { errors } from '@/domain/errors';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const limit = await consumeRateLimit('register', `ip:${await getClientIp()}`);
    if (!limit.allowed) throw errors.rateLimited();

    const input = registerSchema.parse(await readJson(request));
    const user = await register(input);

    const session = await login(input.phone, input.password, {
      userAgent: request.headers.get('user-agent'),
      ipHash: await getClientIpHash(),
    });
    await setSessionCookie(session.token, session.expiresAt);

    const anonToken = await getAnonCartToken();
    if (anonToken) {
      await mergeGuestCart(user.id, anonToken);
      await clearAnonCartCookie();
    }

    return jsonOk({ user }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
