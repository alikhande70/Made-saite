'use client';

/**
 * Transient status messages.
 *
 * Exists because several actions previously changed something the customer
 * could not see — adding to the cart from a listing, applying a vehicle,
 * saving a garage entry — and answered "what happened?" only with a button
 * label that reverted a second later.
 *
 * Accessibility is the substance here, not the animation:
 *  - the region is a live region, so the message is announced without moving
 *    focus (WCAG 4.1.3 Status Messages);
 *  - `alert`/`assertive` for failures, `status`/`polite` for successes, so an
 *    error interrupts and a confirmation waits its turn;
 *  - the message is real text with an icon, never colour alone (WCAG 1.4.1);
 *  - it is *never* the only carrier of a fact. Stock, compatibility, payment
 *    and order state are all rendered in the page as well. A toast that
 *    disappears cannot be the record of anything.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, CloseIcon } from './index';

export type ToastTone = 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Errors persist until dismissed; confirmations clear themselves. */
const DISMISS_AFTER: Record<ToastTone, number | null> = {
  success: 4_000,
  warning: 6_000,
  error: null,
};

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-red-300 bg-red-50 text-red-900',
};

const TONE_LABEL: Record<ToastTone, string> = {
  success: 'موفق',
  warning: 'هشدار',
  error: 'خطا',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++;
    // Cap the stack: a burst of messages must not bury the page.
    setToasts((current) => [...current.slice(-2), { id, tone, message }]);

    const after = DISMISS_AFTER[tone];
    if (after !== null) {
      timers.current.set(id, setTimeout(() => dismiss(id), after));
    }
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => { for (const timer of pending.values()) clearTimeout(timer); };
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/*
        * Fixed to the viewport bottom so it never displaces page content —
        * a status message that pushes the layout would trade one answer for a
        * layout shift. `pointer-events-none` on the stack keeps it from
        * swallowing clicks meant for the page beneath.
        */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`motion-rise pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-4 py-3 text-sm font-semibold shadow-pop ${TONE_CLASS[toast.tone]}`}
          >
            <span aria-hidden className="mt-0.5 shrink-0">
              {toast.tone === 'success' ? <CheckIcon className="size-4" /> : <WarnGlyph />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{TONE_LABEL[toast.tone]}: </span>
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="بستن پیام"
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function WarnGlyph() {
  return <span className="text-base font-black leading-none">!</span>;
}

/**
 * Returns a no-op when no provider is mounted, so a component can report
 * status without every one of its call sites needing the provider — and so a
 * missing provider degrades to silence rather than a crash.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { show: () => undefined };
}
