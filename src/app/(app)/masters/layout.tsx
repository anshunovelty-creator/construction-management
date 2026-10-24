import { getTranslations } from 'next-intl/server';
import { NavLink } from '@/components/nav-link';
import { MASTERS } from '@/lib/masters/registry';

export default async function MastersLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  return (
    <>
      <p className="eyebrow">{t('nav.masters')}</p>
      <p className="lede">{t('masters.lede')}</p>
      <nav aria-label={t('nav.masters')} className="filters subnav">
        {Object.keys(MASTERS).map((slug) => (
          <NavLink key={slug} href={`/masters/${slug}`}>
            {t(`masters.${slug}`)}
          </NavLink>
        ))}
      </nav>
      <div className="card">{children}</div>
    </>
  );
}
