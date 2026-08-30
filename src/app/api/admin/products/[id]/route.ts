import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { setProductActive, updateProduct } from '@/application/admin-service';
import { adminRoute } from '@/lib/admin-http';
import { recordAudit } from '@/application/audit-service';
import { jsonOk, readJson } from '@/lib/http';
import { productBodySchema } from '../route';

type Ctx = { params: Promise<{ id: string }> };

export const PUT = adminRoute<Ctx>(async (request, admin, ctx, audit) => {
  const { id } = await ctx.params;
  const productId = uuidSchema.parse(id);
  const input = productBodySchema.parse(await readJson(request));
  const updated = await updateProduct(productId, input);
  await recordAudit({
    actorUserId: admin.id,
    action: 'product.update',
    entityType: 'product',
    entityId: productId,
    summary: `کالای «${input.titleFa}» ویرایش شد.`,
    metadata: {
      sku: input.sku, price: input.price, salePrice: input.salePrice,
      fitments: input.fitments.length, references: input.references.length,
    },
    ipHash: audit.ipHash,
  });
  return jsonOk(updated);
});

export const PATCH = adminRoute<Ctx>(async (request, admin, ctx, audit) => {
  const { id } = await ctx.params;
  const productId = uuidSchema.parse(id);
  const body = z.object({ isActive: z.boolean() }).parse(await readJson(request));
  await setProductActive(productId, body.isActive);
  await recordAudit({
    actorUserId: admin.id,
    action: body.isActive ? 'product.publish' : 'product.unpublish',
    entityType: 'product',
    entityId: productId,
    summary: body.isActive ? 'کالا در فروشگاه منتشر شد.' : 'کالا از حالت انتشار خارج شد.',
    ipHash: audit.ipHash,
  });
  return jsonOk({ isActive: body.isActive });
});
