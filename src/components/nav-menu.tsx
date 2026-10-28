'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';

/**
 * The main links. On wide screens they sit in the bar as they are; on phones a menu button
 * opens them as a panel under the bar. Going to another page, Escape or a tap outside closes it.
 */
export function NavMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const path = usePathname();
  // Remembering where it was opened closes it by itself once the page changes.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenAt(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="menu-btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls="site-nav"
        onClick={() => setOpenAt(open ? null : path)}
      >
        <Icon name={open ? 'close' : 'menu'} size={22} />
      </button>
      <div id="site-nav" className="nav-panel" data-open={open || undefined}>
        {children}
      </div>
      {open && <div className="nav-scrim" aria-hidden="true" onClick={() => setOpenAt(null)} />}
    </>
  );
}
