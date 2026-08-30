import type { NextRequest } from 'next/server';
import { getEnginesForModel } from '@/application/catalog-service';
import { jsonError, jsonOk } from '@/lib/http';

export async function GET(_request: NextRequest, ctx: { params: Promise<{ modelSlug: string }> }) {
  try {
    const { modelSlug } = await ctx.params;
    return jsonOk(await getEnginesForModel(modelSlug));
  } catch (e) {
    return jsonError(e);
  }
}
