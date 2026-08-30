import { z } from 'zod';
import { orderStatusSchema, uuidSchema } from '@/lib/validation';
import { setShipmentTracking, settleCashPayment, transitionOrder } from '@/application/order-service';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('transition'),
    status: orderStatusSchema,
    message: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('tracking'),
    carrier: z.string().trim().max(120).optional(),
    trackingCode: z.string().trim().max(80).optional(),
    generate: z.boolean().optional(),
  }),
  z.object({ action: z.literal('settle-cash') }),
]);

export const POST = adminRoute<Ctx>(async (request, admin, ctx) => {
  const { id } = await ctx.params;
  const orderId = uuidSchema.parse(id);
  const body = actionSchema.parse(await readJson(request));

  switch (body.action) {
    case 'transition': {
      // The domain state machine decides whether this move is legal.
      const result = await transitionOrder(orderId, body.status, {
        actorType: 'admin',
        actorUserId: admin.id,
        message: body.message,
      });
      return jsonOk(result);
    }
    case 'tracking': {
      const code = await setShipmentTracking(
        orderId,
        { carrier: body.carrier ?? null, trackingCode: body.trackingCode ?? null, generate: body.generate ?? false },
        admin.id,
      );
      return jsonOk({ trackingCode: code });
    }
    case 'settle-cash': {
      await settleCashPayment(orderId, admin.id);
      return jsonOk({ settled: true });
    }
  }
});
