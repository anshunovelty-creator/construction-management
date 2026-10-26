import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { FirmSwitch } from '@/components/firm-switch';
import { NavLink } from '@/components/nav-link';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
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
            {office ? (
              <>
                <NavLink href="/" exact>{t('nav.parties')}</NavLink>
                <NavLink href="/clients" section="/client">{t('nav.clients')}</NavLink>
                <NavLink href="/dashboard">{t('nav.dashboard')}</NavLink>
              </>
            ) : (
              <>
                <NavLink href="/overview">{t('nav.home')}</NavLink>
                <NavLink href="/entries/new">{t('nav.add')}</NavLink>
              </>
            )}
            <NavLink href="/entries" exact>{t('nav.daybook')}</NavLink>
            {office && <NavLink href="/masters/firms" section="/masters">{t('nav.masters')}</NavLink>}
          </nav>
          {/* Screens used less often, out of the way so the bar stays simple. */}
          <details className="more">
            <summary className="nav-link">{t('nav.more')} ▾</summary>
            <div className="more-menu card">
              {office && <NavLink href="/entries/new">{t('nav.add')}</NavLink>}
              {office && <NavLink href="/entries/sheet">{t('nav.sheet')}</NavLink>}
              {office && <NavLink href="/overview">{t('nav.overview')}</NavLink>}
              {owner && <NavLink href="/users">{t('nav.users')}</NavLink>}
              {owner && <NavLink href="/history">{t('nav.history')}</NavLink>}
              <NavLink href="/settings">{t('nav.settings')}</NavLink>
            </div>
          </details>
          {working && <FirmSwitch firms={working.firms} firm={working.firm} />}
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
