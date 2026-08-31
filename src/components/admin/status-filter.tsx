'use client';

import { useId } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** URL-driven status filter, so a filtered admin view is shareable. */
export function StatusFilter({
  label, options, selected,
}: { label: string; options: [string, string][]; selected: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = useId();

  return (
    <div className="mb-4 max-w-xs">
      <label className="label" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="field text-sm"
        value={selected}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          if (e.target.value) params.set('status', e.target.value);
          else params.delete('status');
          params.delete('page');
          router.push(params.toString() ? `?${params.toString()}` : '?');
        }}
      >
        <option value="">همهٔ وضعیت‌ها</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>{text}</option>
        ))}
      </select>
    </div>
  );
}
