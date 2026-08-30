import { ORDER_PROGRESS_STEPS, ORDER_STATUS_HINT_FA, ORDER_STATUS_LABEL_FA, type OrderStatus } from '@/domain/order-status';
import { formatDateTime } from '@/lib/fa';
import { CheckIcon } from './ui';

/** Customer-facing progress bar plus the public event log. */
export function OrderTimeline({
  status,
  events,
}: {
  status: OrderStatus;
  events: { eventType: string; message: string | null; toStatus: OrderStatus | null; createdAt: Date }[];
}) {
  const isCancelled = status === 'CANCELLED' || status === 'REFUNDED';
  const currentIndex = ORDER_PROGRESS_STEPS.indexOf(status);

  return (
    <div className="space-y-6">
      {isCancelled ? (
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          {ORDER_STATUS_LABEL_FA[status]} — {ORDER_STATUS_HINT_FA[status]}
        </div>
      ) : (
        <ol className="scroll-x no-scrollbar -mx-1 flex gap-1 px-1 sm:gap-0">
          {ORDER_PROGRESS_STEPS.map((step, i) => {
            const done = currentIndex >= i;
            const active = currentIndex === i;
            return (
              <li key={step} className="flex min-w-24 flex-1 flex-col items-center gap-1.5 text-center">
                <div className="flex w-full items-center">
                  {/* Connector lines use logical order, so they read right-to-left. */}
                  <span className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : done ? 'bg-emerald-500' : 'bg-line'}`} />
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      done ? 'bg-emerald-600 text-white' : 'bg-white text-steel-400 ring-1 ring-line'
                    }`}
                    aria-current={active ? 'step' : undefined}
                  >
                    {done ? <CheckIcon className="size-4" /> : i + 1}
                  </span>
                  <span
                    className={`h-0.5 flex-1 ${
                      i === ORDER_PROGRESS_STEPS.length - 1 ? 'bg-transparent' : currentIndex > i ? 'bg-emerald-500' : 'bg-line'
                    }`}
                  />
                </div>
                <span className={`text-[0.6875rem] leading-tight sm:text-xs ${active ? 'font-bold text-steel-900' : 'text-muted'}`}>
                  {ORDER_STATUS_LABEL_FA[step]}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {events.length > 0 && (
        <ol className="space-y-3 border-t border-line pt-5">
          {[...events].reverse().map((event, i) => (
            <li key={`${event.eventType}-${i}`} className="flex gap-3">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-steel-300" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-steel-900">
                  {event.message ?? (event.toStatus ? ORDER_STATUS_LABEL_FA[event.toStatus] : event.eventType)}
                </p>
                <time className="text-xs text-muted" dateTime={new Date(event.createdAt).toISOString()}>
                  {formatDateTime(event.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
