import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const t = await getTranslations();
  const links: [string, string][] = [
    ['/', 'nav.home'],
    ...(profile.role !== 'supervisor' ? ([['/masters/firms', 'nav.masters']] as [string, string][]) : []),
    ...(profile.role === 'owner' ? ([['/users', 'nav.users'], ['/history', 'nav.history']] as [string, string][]) : []),
    ['/settings', 'nav.settings'],
  ];
  return (
    <>
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 p-3">
          <span className="font-semibold">{t('app.name')}</span>
          {links.map(([href, key]) => (
            <Link key={href} href={href} className="underline-offset-4 hover:underline">
              {t(key)}
            </Link>
          ))}
          <form action={signOut} className="ml-auto">
            <button type="submit">{t('nav.signOut')}</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
