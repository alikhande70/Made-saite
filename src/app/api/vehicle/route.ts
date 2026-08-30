/**
 * The vehicle the shopper is browsing as.
 *
 * Works for guests too: the configuration id is resolved (or created) from the
 * chosen make/model/trim/engine/year and stored in a cookie, so vehicle-first
 * shopping does not require an account.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { getConfiguration, getOrCreateConfiguration } from '@/application/fitment-service';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { getSelectedVehicleId, setSelectedVehicleCookie } from '@/lib/session';
import { errors } from '@/domain/errors';

const schema = z.object({
  vehicleModelId: uuidSchema,
  vehicleGenerationId: uuidSchema.optional().nullable(),
  vehicleTrimId: uuidSchema.optional().nullable(),
  vehicleEngineId: uuidSchema.optional().nullable(),
  year: z.coerce.number().int().min(1300).max(1450).optional().nullable(),
});

export async function GET() {
  try {
    const configurationId = await getSelectedVehicleId();
    if (!configurationId) return jsonOk(null);
    return jsonOk(await getConfiguration(configurationId));
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await readJson(request));

    // A saved vehicle is one exact year, so both ends of the window match.
    const configurationId = await getOrCreateConfiguration({
      vehicleModelId: input.vehicleModelId,
      vehicleGenerationId: input.vehicleGenerationId ?? null,
      vehicleTrimId: input.vehicleTrimId ?? null,
      vehicleEngineId: input.vehicleEngineId ?? null,
      yearFrom: input.year ?? null,
      yearTo: input.year ?? null,
    });

    const configuration = await getConfiguration(configurationId);
    if (!configuration) throw errors.conflict('انتخاب خودرو ثبت نشد.');

    await setSelectedVehicleCookie(configurationId);
    return jsonOk(configuration);
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await setSelectedVehicleCookie(null);
    return jsonOk({ cleared: true });
  } catch (e) {
    return jsonError(e);
  }
}
