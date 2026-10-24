'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A top-bar link that marks itself as the current page. Unless `exact`, `section`'s sub-pages count too. */
export function NavLink({
  href,
  section = href,
  exact = false,
  children,
}: {
  href: string;
  section?: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const current = path === section || (!exact && path.startsWith(`${section}/`));
  return (
    <Link href={href} className="nav-link" aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
