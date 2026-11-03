import { getTranslations } from 'next-intl/server';
import { NavLink } from '@/components/nav-link';
import { requireProfile } from '@/lib/auth';
import { MASTERS, mayView } from '@/lib/masters/registry';

export default async function MastersLayout({ children }: { children: React.ReactNode }) {
  const [t, profile] = await Promise.all([getTranslations(), requireProfile()]);
  return (
    <>
      <h1>{t('nav.masters')}</h1>
      <p className="lede">{t('masters.lede')}</p>
      <nav aria-label={t('nav.masters')} className="filters subnav">
        {Object.entries(MASTERS).filter(([, def]) => mayView(def, profile.role)).map(([slug]) => (
          <NavLink key={slug} href={`/masters/${slug}`}>
            {t(`masters.${slug}`)}
          </NavLink>
        ))}
        <NavLink href="/masters/mixes">{t('masters.mixes')}</NavLink>
      </nav>
      <div className="card">{children}</div>
    </>
  );
}
