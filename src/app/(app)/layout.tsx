import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { FirmSwitch } from '@/components/firm-switch';
import { Icon } from '@/components/icons';
import { NavLink } from '@/components/nav-link';
import { NavMenu } from '@/components/nav-menu';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  const office = profile.role !== 'supervisor';
  const owner = profile.role === 'owner';
  const initials = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  // Screens used less often: under More on wide screens, listed below the main links in the phone menu.
  const moreLinks = office && (
    <>
      <NavLink href="/entries/new"><Icon name="add" /><span>{t('nav.add')}</span></NavLink>
      <NavLink href="/entries/sheet"><Icon name="sheet" /><span>{t('nav.sheet')}</span></NavLink>
      <NavLink href="/overview"><Icon name="overview" /><span>{t('nav.overview')}</span></NavLink>
      {owner && <NavLink href="/users"><Icon name="people" /><span>{t('nav.users')}</span></NavLink>}
      {owner && <NavLink href="/history"><Icon name="history" /><span>{t('nav.history')}</span></NavLink>}
    </>
  );
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">₹</span>
            {t('app.name')}
          </Link>
          <NavMenu label={t('nav.menu')}>
            <nav aria-label={t('nav.label')} className="nav">
              {office ? (
                <>
                  <NavLink href="/" section="/party"><Icon name="parties" /><span>{t('nav.parties')}</span></NavLink>
                  <NavLink href="/clients" section="/client"><Icon name="clients" /><span>{t('nav.clients')}</span></NavLink>
                  <NavLink href="/dashboard"><Icon name="dashboard" /><span>{t('nav.dashboard')}</span></NavLink>
                </>
              ) : (
                <>
                  <NavLink href="/overview"><Icon name="home" /><span>{t('nav.home')}</span></NavLink>
                  <NavLink href="/entries/new"><Icon name="add" /><span>{t('nav.add')}</span></NavLink>
                </>
              )}
              <NavLink href="/entries" exact><Icon name="daybook" /><span>{t('nav.daybook')}</span></NavLink>
              {office && <NavLink href="/masters/firms" section="/masters"><Icon name="setup" /><span>{t('nav.masters')}</span></NavLink>}
            </nav>
            {moreLinks && (
              <>
                <details className="more more-desk">
                  <summary className="nav-link"><Icon name="more" /><span>{t('nav.more')}</span><Icon name="chevron" size={14} /></summary>
                  <div className="more-menu card">{moreLinks}</div>
                </details>
                <div className="nav-extra">
                  <p className="eyebrow">{t('nav.more')}</p>
                  {moreLinks}
                </div>
              </>
            )}
          </NavMenu>
          <div className="topbar-right">
            {working && <FirmSwitch firms={working.firms} firm={working.firm} />}
            {/* The person signed in: initials that open their name, settings and sign out. */}
            <details className="more account">
              <summary className="avatar" aria-label={t('nav.account', { name: profile.full_name })}>{initials}</summary>
              <div className="more-menu card">
                <p className="account-who">
                  <b>{profile.full_name}</b>
                  <span>{t(`options.role.${profile.role}`)}</span>
                </p>
                <NavLink href="/settings"><Icon name="settings" /><span>{t('nav.settings')}</span></NavLink>
                <form action={signOut}>
                  <button type="submit" className="nav-link signout"><Icon name="signOut" /><span>{t('nav.signOut')}</span></button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
