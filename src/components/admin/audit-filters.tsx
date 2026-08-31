'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { AUDIT_ACTION_LABEL_FA } from '@/domain/audit';

/** Action filter for the audit log. URL-driven so a filtered view is shareable. */
export function AuditFilters({ actions, selected }: { actions: string[]; selected: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function apply(action: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (action) params.set('action', action);
    else params.delete('action');
    params.delete('page');
    router.push(params.toString() ? `?${params.toString()}` : '?');
  }

  if (actions.length === 0) return null;

  return (
    <div className="mb-4 max-w-xs">
      <label className="label" htmlFor="audit-action">فیلتر بر اساس نوع رویداد</label>
      <select
        id="audit-action"
        className="field text-sm"
        value={selected}
        onChange={(e) => apply(e.target.value)}
      >
        <option value="">همهٔ رویدادها</option>
        {actions.map((action) => (
          <option key={action} value={action}>{AUDIT_ACTION_LABEL_FA[action] ?? action}</option>
        ))}
      </select>
    </div>
  );
}
