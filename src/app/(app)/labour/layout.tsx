import { getTranslations } from 'next-intl/server';
import { NavLink } from '@/components/nav-link';
import { requireProfile } from '@/lib/auth';

/** The labour supply business, apart from the firms: its people, their attendance cards, and the deduction rates. */
export default async function LabourLayout({ children }: { children: React.ReactNode }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  return (
    <>
      <nav className="subnav no-print" aria-label={t('nav.labour')}>
        <NavLink href="/labour" exact>{t('labour.tabs.workers')}</NavLink>
        <NavLink href="/labour/attendance">{t('labour.tabs.attendance')}</NavLink>
        <NavLink href="/labour/settings">{t('labour.tabs.settings')}</NavLink>
      </nav>
      {children}
    </>
  );
}
