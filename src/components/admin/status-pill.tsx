import { ORDER_STATUS_LABEL_FA, type OrderStatus } from '@/domain/order-status';

const TONE: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'bg-amber-50 text-amber-800',
  PAID: 'bg-emerald-50 text-emerald-800',
  PROCESSING: 'bg-steel-100 text-steel-800',
  PACKED: 'bg-steel-100 text-steel-800',
  SHIPPED: 'bg-sky-50 text-sky-800',
  DELIVERED: 'bg-emerald-50 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
  REFUNDED: 'bg-slate-100 text-slate-600',
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold ${TONE[status]}`}>
      {ORDER_STATUS_LABEL_FA[status]}
    </span>
  );
}
