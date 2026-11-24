import { getTranslations } from 'next-intl/server';
import { NavLink } from '@/components/nav-link';
import { requireProfile } from '@/lib/auth';

/** The labour payment business, one of our firms: its workers (a family to a line), each month's entry, and the labour supplied. */
export default async function LabourLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  return (
    <>
      <nav className="subnav no-print" aria-label={t('nav.labour')}>
        <NavLink href="/labour" exact>{t('labour.tabs.workers')}</NavLink>
        <NavLink href="/labour/month">{t('labour.tabs.month')}</NavLink>
        {/* Workers are paid from the firm's bank or cash, which a Labour login does not see. */}
        {profile.role !== 'labour' && <NavLink href="/labour/pay">{t('labour.tabs.pay')}</NavLink>}
        <NavLink href="/labour/supplied">{t('labour.tabs.supplied')}</NavLink>
      </nav>
      {children}
    </>
  );
}
