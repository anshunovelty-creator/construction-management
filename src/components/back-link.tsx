'use client';

import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';

/**
 * "Back" to the page this one was opened from (a party, client, ledger, the day book), like the browser's back button.
 * Opened on its own (a new tab, a shared link) there is nothing to go back to, so it goes to `fallback` instead.
 */
export function BackLink({ fallback, label }: { fallback: string; label: string }) {
  const router = useRouter();
  return (
    <a
      href={fallback}
      className="back"
      onClick={(e) => {
        if (window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      <Icon name="chevronLeft" size={16} /> {label}
    </a>
  );
}
