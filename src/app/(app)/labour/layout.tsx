import { getTranslations } from 'next-intl/server';
import { NavLink } from '@/components/nav-link';
import { requireProfile } from '@/lib/auth';

/** The labour supply business, apart from the firms: its workers and each month's entry. */
export default async function LabourLayout({ children }: { children: React.ReactNode }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  return (
    <>
      <nav className="subnav no-print" aria-label={t('nav.labour')}>
        <NavLink href="/labour" exact>{t('labour.tabs.workers')}</NavLink>
        <NavLink href="/labour/month">{t('labour.tabs.month')}</NavLink>
      </nav>
      {children}
    </>
  );
}
