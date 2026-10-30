'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A navigation link that marks itself as the current page. Unless `exact`, `section`'s sub-pages count too. */
export function NavLink({
  href,
  section = href,
  exact = false,
  className = 'nav-link',
  children,
}: {
  href: string;
  section?: string;
  exact?: boolean;
  /** `tab-item` for the phone's bottom tab bar. */
  className?: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const current = path === href || path === section || (!exact && path.startsWith(`${section}/`));
  return (
    // The main menu is loaded in full ahead of time, so a click opens the page at once.
    <Link href={href} prefetch className={className} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
