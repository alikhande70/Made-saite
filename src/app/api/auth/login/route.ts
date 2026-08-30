import type { NextRequest } from 'next/server';
import { loginSchema } from '@/lib/validation';
import { login, mergeGuestCart } from '@/application/auth-service';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { clearAnonCartCookie, getAnonCartToken, getClientIp, getClientIpHash, setSessionCookie } from '@/lib/session';
import { consumeRateLimit } from '@/lib/rate-limit';
import { errors } from '@/domain/errors';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = loginSchema.parse(await readJson(request));

    // Rate limited by IP *and* by the account being targeted, so neither a
    // single host nor a single victim account can be hammered.
    for (const key of [`ip:${await getClientIp()}`, `phone:${input.phone}`]) {
      const limit = await consumeRateLimit('login', key);
      if (!limit.allowed) throw errors.rateLimited();
    }

    const result = await login(input.phone, input.password, {
      userAgent: request.headers.get('user-agent'),
      ipHash: await getClientIpHash(),
    });

    await setSessionCookie(result.token, result.expiresAt);

    // Anything the customer put in the cart as a guest follows them in.
    const anonToken = await getAnonCartToken();
    if (anonToken) {
      await mergeGuestCart(result.user.id, anonToken);
      await clearAnonCartCookie();
    }

    return jsonOk({ user: result.user });
  } catch (e) {
    return jsonError(e);
  }
}
