/**
 * «گاراژ من» — the customer's saved vehicles.
 * Every query is scoped to the signed-in user; ownership lives in the WHERE
 * clause, so another customer's vehicle id can never match.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import {
  addVehicle, listGarage, removeVehicle, setDefaultVehicle,
} from '@/application/garage-service';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { requireUser, setSelectedVehicleCookie } from '@/lib/session';

const addSchema = z.object({
  vehicleModelId: uuidSchema,
  vehicleGenerationId: uuidSchema.optional().nullable(),
  vehicleTrimId: uuidSchema.optional().nullable(),
  vehicleEngineId: uuidSchema.optional().nullable(),
  yearFrom: z.coerce.number().int().min(1300).max(1450).optional().nullable(),
  yearTo: z.coerce.number().int().min(1300).max(1450).optional().nullable(),
  nickname: z.string().trim().max(80).optional(),
  makeDefault: z.boolean().optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk(await listGarage(user.id));
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = addSchema.parse(await readJson(request));
    const vehicle = await addVehicle(user.id, input);
    // Browsing immediately follows the vehicle that was just saved.
    if (vehicle.isDefault) await setSelectedVehicleCookie(vehicle.configurationId);
    return jsonOk(vehicle, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = z.object({ vehicleId: uuidSchema }).parse(await readJson(request));
    await setDefaultVehicle(user.id, body.vehicleId);

    const garage = await listGarage(user.id);
    const chosen = garage.find((v) => v.id === body.vehicleId);
    if (chosen) await setSelectedVehicleCookie(chosen.configurationId);
    return jsonOk({ updated: true });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const vehicleId = uuidSchema.parse(new URL(request.url).searchParams.get('id'));
    await removeVehicle(user.id, vehicleId);
    return jsonOk({ deleted: true });
  } catch (e) {
    return jsonError(e);
  }
}
