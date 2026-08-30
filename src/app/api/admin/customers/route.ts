import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { listCustomers, setCustomerActive } from '@/application/admin-service';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';

export const GET = adminRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  return jsonOk(await listCustomers({ q: params.get('q') ?? undefined, page: Number(params.get('page') ?? 1) }));
});

export const PATCH = adminRoute(async (request) => {
  const body = z.object({ userId: uuidSchema, isActive: z.boolean() }).parse(await readJson(request));
  await setCustomerActive(body.userId, body.isActive);
  return jsonOk({ isActive: body.isActive });
});
