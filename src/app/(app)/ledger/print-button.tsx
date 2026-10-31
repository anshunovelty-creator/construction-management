'use client';

import { Icon } from '@/components/icons';

/** Opens the browser's print window; "Save as PDF" is one of its printers. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn ghost no-print" onClick={() => window.print()}>
      <Icon name="invoice" /> {label}
    </button>
  );
}
