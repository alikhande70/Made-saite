import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { withTransaction } from '@/infrastructure/db/client';
import { adjustStock, setLowStockThreshold } from '@/application/inventory-service';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';

const schema = z.object({
  productId: uuidSchema,
  delta: z.coerce.number().int().refine((n) => n !== 0, 'مقدار تغییر نمی‌تواند صفر باشد.'),
  reason: z.string().trim().min(3, 'دلیل تغییر موجودی الزامی است.').max(240),
  lowStockThreshold: z.coerce.number().int().min(0).max(1000).optional(),
});

export const POST = adminRoute(async (request, admin) => {
  const input = schema.parse(await readJson(request));

  const result = await withTransaction(async (tx) => {
    const stock = await adjustStock(tx, {
      productId: input.productId,
      delta: input.delta,
      reason: input.reason,
      actorUserId: admin.id,
    });
    if (input.lowStockThreshold !== undefined) {
      await setLowStockThreshold(tx, input.productId, input.lowStockThreshold);
    }
    return stock;
  });

  return jsonOk(result);
});
