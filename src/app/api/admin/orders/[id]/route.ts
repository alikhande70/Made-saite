import { z } from 'zod';
import { orderStatusSchema, uuidSchema } from '@/lib/validation';
import { setShipmentTracking, settleCashPayment, transitionOrder } from '@/application/order-service';
import { adminRoute } from '@/lib/admin-http';
import { recordAudit } from '@/application/audit-service';
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

export const POST = adminRoute<Ctx>(async (request, admin, ctx, audit) => {
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
      await recordAudit({
        actorUserId: admin.id,
        action: 'order.transition',
        entityType: 'order',
        entityId: orderId,
        summary: `وضعیت سفارش از «${result.from}» به «${result.to}» تغییر کرد.`,
        metadata: { from: result.from, to: result.to },
        ipHash: audit.ipHash,
      });
      return jsonOk(result);
    }
    case 'tracking': {
      const code = await setShipmentTracking(
        orderId,
        { carrier: body.carrier ?? null, trackingCode: body.trackingCode ?? null, generate: body.generate ?? false },
        admin.id,
      );
      await recordAudit({
        actorUserId: admin.id,
        action: 'order.tracking',
        entityType: 'order',
        entityId: orderId,
        summary: code ? 'کد رهگیری مرسوله ثبت شد.' : 'کد رهگیری مرسوله حذف شد.',
        metadata: { carrier: body.carrier ?? null },
        ipHash: audit.ipHash,
      });
      return jsonOk({ trackingCode: code });
    }
    case 'settle-cash': {
      await settleCashPayment(orderId, admin.id);
      await recordAudit({
        actorUserId: admin.id,
        action: 'order.settle_cash',
        entityType: 'order',
        entityId: orderId,
        summary: 'دریافت وجه سفارش «پرداخت در محل» ثبت شد.',
        ipHash: audit.ipHash,
      });
      return jsonOk({ settled: true });
    }
  }
});
