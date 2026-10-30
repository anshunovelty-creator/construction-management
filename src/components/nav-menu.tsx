'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';

/**
 * The app's navigation. Wide screens: every link in a sidebar on the left. Phones: the main few in a tab bar
 * at the bottom, within thumb reach, and More slides the full sidebar up as a sheet. Going to another page,
 * Escape or a tap outside closes the sheet.
 */
export function NavMenu({ label, brand, tabs, children }: {
  label: string;
  brand: React.ReactNode;
  tabs: React.ReactNode;
  children: React.ReactNode;
}) {
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
      <aside id="site-nav" className="sidebar" data-open={open || undefined}>
        <div className="sidebar-brand">{brand}</div>
        <button type="button" className="sheet-close" aria-label={label} onClick={() => setOpenAt(null)}>
          <Icon name="close" size={20} />
        </button>
        {children}
      </aside>
      <nav className="tabbar" aria-label={label}>
        {tabs}
        <button
          type="button"
          className="tab-item"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpenAt(open ? null : path)}
        >
          <Icon name="grid" size={22} />
          <span>{label}</span>
        </button>
      </nav>
      {open && <div className="nav-scrim" aria-hidden="true" onClick={() => setOpenAt(null)} />}
    </>
  );
}
