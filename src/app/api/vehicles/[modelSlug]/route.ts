/**
 * Everything needed to narrow one model: generations, trims, engines.
 *
 * Served as a single document so the vehicle selector makes one request per
 * model change instead of three parallel ones.
 */
import type { NextRequest } from 'next/server';
import {
  getEnginesForModel,
  getGenerationsForModel,
  getTrimsForModel,
  getVehicleModelBySlug,
} from '@/application/catalog-service';
import { jsonError, jsonOk } from '@/lib/http';
import { errors } from '@/domain/errors';

export async function GET(_request: NextRequest, ctx: { params: Promise<{ modelSlug: string }> }) {
  try {
    const { modelSlug } = await ctx.params;
    const slug = decodeURIComponent(modelSlug);
    const model = await getVehicleModelBySlug(slug);
    if (!model) throw errors.notFound('مدل خودرو یافت نشد.');

    const [generations, trims, engines] = await Promise.all([
      getGenerationsForModel(slug),
      getTrimsForModel(slug),
      getEnginesForModel(slug),
    ]);
    return jsonOk({ model, generations, trims, engines });
  } catch (e) {
    return jsonError(e);
  }
}
