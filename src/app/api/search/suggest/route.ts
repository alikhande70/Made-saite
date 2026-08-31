import type { NextRequest } from 'next/server';
import { suggest } from '@/application/catalog-service';
import { jsonError, jsonOk } from '@/lib/http';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getCurrentUser, rateLimitIdentity } from '@/lib/session';
import { errors } from '@/domain/errors';

export async function GET(request: NextRequest) {
  try {
    const limit = await consumeRateLimit('search', await rateLimitIdentity(await getCurrentUser()));
    if (!limit.allowed) throw errors.rateLimited();

    const term = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 120);
    return jsonOk(await suggest(term));
  } catch (e) {
    return jsonError(e);
  }
}
