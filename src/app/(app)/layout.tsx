import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { FirmSwitch } from '@/components/firm-switch';
import { Icon } from '@/components/icons';
import { NavLink } from '@/components/nav-link';
import { NavMenu } from '@/components/nav-menu';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, working, t] = await Promise.all([requireProfile(), getWorkingFirm(), getTranslations()]);
  const office = profile.role !== 'supervisor';
  const owner = profile.role === 'owner';
  const initials = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  const brand = (
    <Link href="/" className="brand">
      <span className="brand-mark" aria-hidden="true">₹</span>
      <span className="brand-name">{t('app.name')}</span>
    </Link>
  );
  // The phone's bottom bar: the screens used every day. Everything else is under More.
  const tabs = office ? (
    <>
      <NavLink href="/" section="/party" className="tab-item"><Icon name="parties" size={22} /><span>{t('nav.parties')}</span></NavLink>
      <NavLink href="/clients" section="/client" className="tab-item"><Icon name="clients" size={22} /><span>{t('nav.clients')}</span></NavLink>
      <NavLink href="/report" section="/report" className="tab-item"><Icon name="report" size={22} /><span>{t('nav.report')}</span></NavLink>
      <NavLink href="/entries" exact className="tab-item"><Icon name="daybook" size={22} /><span>{t('nav.daybook')}</span></NavLink>
    </>
  ) : (
    <>
      <NavLink href="/overview" className="tab-item"><Icon name="home" size={22} /><span>{t('nav.home')}</span></NavLink>
      <NavLink href="/entries/new" className="tab-item"><Icon name="add" size={22} /><span>{t('nav.add')}</span></NavLink>
      <NavLink href="/report" section="/report" className="tab-item"><Icon name="report" size={22} /><span>{t('nav.report')}</span></NavLink>
      <NavLink href="/entries" exact className="tab-item"><Icon name="daybook" size={22} /><span>{t('nav.daybook')}</span></NavLink>
    </>
  );
  return (
    <div className="shell">
      <NavMenu label={t('nav.more')} brand={brand} tabs={tabs}>
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
          <NavLink href="/report" section="/report"><Icon name="report" /><span>{t('nav.report')}</span></NavLink>
          <NavLink href="/entries" exact><Icon name="daybook" /><span>{t('nav.daybook')}</span></NavLink>
          {office && <NavLink href="/ledger" section="/ledger"><Icon name="invoice" /><span>{t('nav.ledger')}</span></NavLink>}
          {office && <NavLink href="/stock" section="/stock"><Icon name="stock" /><span>{t('nav.stock')}</span></NavLink>}
          {office && <NavLink href="/salary" section="/salary"><Icon name="payOut" /><span>{t('nav.salary')}</span></NavLink>}
          {office && <NavLink href="/tds" section="/tds"><Icon name="tds" /><span>{t('nav.tds')}</span></NavLink>}
        </nav>
        {office && (
          <nav aria-label={t('nav.tools')} className="nav nav-group">
            <p className="nav-heading">{t('nav.tools')}</p>
            <NavLink href="/entries/new"><Icon name="add" /><span>{t('nav.add')}</span></NavLink>
            <NavLink href="/entries/sheet"><Icon name="sheet" /><span>{t('nav.sheet')}</span></NavLink>
            <NavLink href="/overview"><Icon name="overview" /><span>{t('nav.overview')}</span></NavLink>
            {owner && <NavLink href="/users"><Icon name="people" /><span>{t('nav.users')}</span></NavLink>}
            {owner && <NavLink href="/history"><Icon name="history" /><span>{t('nav.history')}</span></NavLink>}
          </nav>
        )}
        {office && (
          <nav aria-label={t('nav.masters')} className="nav nav-foot">
            <NavLink href="/masters/firms" section="/masters"><Icon name="setup" /><span>{t('nav.masters')}</span></NavLink>
          </nav>
        )}
      </NavMenu>
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-brand">{brand}</div>
          <div className="topbar-right">
            {working && <FirmSwitch firms={working.firms} firm={working.firm} />}
            {/* The person signed in: initials that open their name, role and sign out. */}
            <details className="more account">
              <summary className="avatar" aria-label={t('nav.account', { name: profile.full_name })}>{initials}</summary>
              <div className="more-menu card">
                <p className="account-who">
                  <b>{profile.full_name}</b>
                  <span>{t(`options.role.${profile.role}`)}</span>
                </p>
                <form action={signOut}>
                  <button type="submit" className="nav-link signout"><Icon name="signOut" /><span>{t('nav.signOut')}</span></button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </div>
    </div>
  );
}
