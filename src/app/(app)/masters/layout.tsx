import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MASTERS } from '@/lib/masters/registry';

export default async function MastersLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  return (
    <>
      <nav aria-label={t('nav.masters')} className="mb-6 flex flex-wrap gap-x-4 gap-y-2 border-b border-gray-200 pb-3">
        {Object.keys(MASTERS).map((slug) => (
          <Link key={slug} href={`/masters/${slug}`} className="underline-offset-4 hover:underline">
            {t(`masters.${slug}`)}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
