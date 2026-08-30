import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { setProductActive, updateProduct } from '@/application/admin-service';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';
import { productBodySchema } from '../route';

type Ctx = { params: Promise<{ id: string }> };

export const PUT = adminRoute<Ctx>(async (request, _admin, ctx) => {
  const { id } = await ctx.params;
  const input = productBodySchema.parse(await readJson(request));
  return jsonOk(await updateProduct(uuidSchema.parse(id), input));
});

export const PATCH = adminRoute<Ctx>(async (request, _admin, ctx) => {
  const { id } = await ctx.params;
  const body = z.object({ isActive: z.boolean() }).parse(await readJson(request));
  await setProductActive(uuidSchema.parse(id), body.isActive);
  return jsonOk({ isActive: body.isActive });
});
