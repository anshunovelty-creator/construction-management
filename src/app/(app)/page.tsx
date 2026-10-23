import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { MASTERS } from '@/lib/masters/registry';

export default async function HomePage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <h1>{t('home.welcome', { name: profile.full_name })}</h1>
      <p>{t('home.signedInAs', { role: t(`options.role.${profile.role}`) })}</p>
      {profile.role !== 'supervisor' && (
        <>
          <p className="mt-4">{t('home.comingNext')}</p>
          <ul className="mt-2 list-disc pl-6">
            {Object.keys(MASTERS).map((slug) => (
              <li key={slug}>
                <Link href={`/masters/${slug}`} className="underline">
                  {t(`masters.${slug}`)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
