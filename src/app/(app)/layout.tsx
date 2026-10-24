import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { NavLink } from '@/components/nav-link';
import { requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const t = await getTranslations();
  const office = profile.role !== 'supervisor';
  const owner = profile.role === 'owner';
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">₹</span>
            {t('app.name')}
          </Link>
          <nav aria-label={t('nav.label')} className="nav">
            <NavLink href="/" exact>{t('nav.home')}</NavLink>
            <NavLink href="/entries/new">{t('nav.add')}</NavLink>
            {office && <NavLink href="/entries/sheet">{t('nav.sheet')}</NavLink>}
            <NavLink href="/entries" exact>{t('nav.daybook')}</NavLink>
            {office && <NavLink href="/masters/firms" section="/masters">{t('nav.masters')}</NavLink>}
            {owner && <NavLink href="/users">{t('nav.users')}</NavLink>}
            {owner && <NavLink href="/history">{t('nav.history')}</NavLink>}
            <NavLink href="/settings">{t('nav.settings')}</NavLink>
          </nav>
          <form action={signOut} className="signout">
            <span className="who">
              {profile.full_name} · {t(`options.role.${profile.role}`)}
            </span>
            <button type="submit" className="btn ghost small">{t('nav.signOut')}</button>
          </form>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
