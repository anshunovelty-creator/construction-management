'use client';

import { Icon } from '@/components/icons';

/**
 * Prints the page (or saves it as a PDF from the print window); the menus are left off the paper. `title` names the
 * saved PDF file, since browsers use the page title for it.
 */
export function PrintButton({ label, title }: { label: string; title?: string }) {
  const print = () => {
    const was = document.title;
    if (title) {
      document.title = title;
      window.addEventListener('afterprint', () => { document.title = was; }, { once: true });
    }
    window.print();
  };
  return (
    <button type="button" className="btn ghost small no-print" onClick={print}>
      <Icon name="invoice" size={16} /> {label}
    </button>
  );
}
