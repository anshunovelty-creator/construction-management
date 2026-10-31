'use client';

import { Icon } from '@/components/icons';

/** Prints the page (or saves it as a PDF from the print window); the menus are left off the paper. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn ghost small no-print" onClick={() => window.print()}>
      <Icon name="invoice" size={16} /> {label}
    </button>
  );
}
