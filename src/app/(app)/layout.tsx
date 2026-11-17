import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { FirmSwitch } from '@/components/firm-switch';
import { Icon } from '@/components/icons';
import { NavLink } from '@/components/nav-link';
import { NavMenu } from '@/components/nav-menu';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, working, t] = await Promise.all([requireProfile('owner', 'office', 'supervisor', 'labour'), getWorkingFirm(), getTranslations()]);
  const office = profile.role === 'owner' || profile.role === 'office';
  const labourOnly = profile.role === 'labour';
  const owner = profile.role === 'owner';
  const initials = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  const brand = (
    <Link href={labourOnly ? '/labour' : '/overview'} className="brand">
      <span className="brand-mark" aria-hidden="true">₹</span>
      <span className="brand-name">{t('app.name')}</span>
    </Link>
  );
  // The phone's bottom bar: the screens used every day. Everything else is under More.
  const tabs = labourOnly ? (
    <>
      <NavLink href="/labour" exact className="tab-item"><Icon name="people" size={22} /><span>{t('labour.tabs.workers')}</span></NavLink>
      <NavLink href="/labour/month" className="tab-item"><Icon name="report" size={22} /><span>{t('labour.tabs.month')}</span></NavLink>
    </>
  ) : office ? (
    <>
      <NavLink href="/overview" className="tab-item"><Icon name="home" size={22} /><span>{t('nav.home')}</span></NavLink>
      <NavLink href="/" section="/party" className="tab-item"><Icon name="parties" size={22} /><span>{t('nav.parties')}</span></NavLink>
      <NavLink href="/clients" section="/client" className="tab-item"><Icon name="clients" size={22} /><span>{t('nav.clients')}</span></NavLink>
      <NavLink href="/report" section="/report" className="tab-item"><Icon name="report" size={22} /><span>{t('nav.report')}</span></NavLink>
    </>
  ) : (
    <>
      <NavLink href="/overview" className="tab-item"><Icon name="home" size={22} /><span>{t('nav.home')}</span></NavLink>
      <NavLink href="/report" section="/report" className="tab-item"><Icon name="report" size={22} /><span>{t('nav.report')}</span></NavLink>
      <NavLink href="/stock" section="/stock" className="tab-item"><Icon name="stock" size={22} /><span>{t('nav.stock')}</span></NavLink>
      <NavLink href="/entries" exact className="tab-item"><Icon name="daybook" size={22} /><span>{t('nav.daybook')}</span></NavLink>
    </>
  );
  return (
    <div className="shell">
      <NavMenu label={t('nav.more')} brand={brand} tabs={tabs}>
        {labourOnly ? (
          <nav aria-label={t('nav.label')} className="nav">
            <NavLink href="/labour" exact><Icon name="people" /><span>{t('labour.tabs.workers')}</span></NavLink>
            <NavLink href="/labour/month"><Icon name="report" /><span>{t('labour.tabs.month')}</span></NavLink>
          </nav>
        ) : office ? (
          <>
            {/* Grouped by what the work is about, so the list reads in four short parts instead of one long one.
                The parties Dashboard opens from Parties. Add an entry (/entries/new) and its Sheet are left out of
                the menu for now (owner decision 2026-11-17); bills and payments are added from a party's or client's page. */}
            <nav aria-label={t('nav.label')} className="nav">
              <NavLink href="/overview"><Icon name="home" /><span>{t('nav.home')}</span></NavLink>
            </nav>
            <nav aria-label={t('nav.groupMoney')} className="nav nav-group">
              <p className="nav-heading">{t('nav.groupMoney')}</p>
              <NavLink href="/" section="/party"><Icon name="parties" /><span>{t('nav.parties')}</span></NavLink>
              <NavLink href="/clients" section="/client"><Icon name="clients" /><span>{t('nav.clients')}</span></NavLink>
              <NavLink href="/entries" exact><Icon name="daybook" /><span>{t('nav.daybook')}</span></NavLink>
              <NavLink href="/ledger" section="/ledger"><Icon name="invoice" /><span>{t('nav.ledger')}</span></NavLink>
              <NavLink href="/tds" section="/tds"><Icon name="tds" /><span>{t('nav.tds')}</span></NavLink>
            </nav>
            <nav aria-label={t('nav.groupSites')} className="nav nav-group">
              <p className="nav-heading">{t('nav.groupSites')}</p>
              <NavLink href="/report" section="/report"><Icon name="report" /><span>{t('nav.report')}</span></NavLink>
              <NavLink href="/stock" section="/stock"><Icon name="stock" /><span>{t('nav.stock')}</span></NavLink>
              <NavLink href="/assets" section="/assets"><Icon name="tool" /><span>{t('nav.assets')}</span></NavLink>
              <NavLink href="/rentals" section="/rentals"><Icon name="rent" /><span>{t('nav.rentals')}</span></NavLink>
              <NavLink href="/salary" section="/salary"><Icon name="payOut" /><span>{t('nav.salary')}</span></NavLink>
            </nav>
            <nav aria-label={t('nav.groupOther')} className="nav nav-group">
              <p className="nav-heading">{t('nav.groupOther')}</p>
              <NavLink href="/labour" section="/labour"><Icon name="people" /><span>{t('nav.labour')}</span></NavLink>
              <NavLink href="/machines" section="/machines"><Icon name="tool" /><span>{t('nav.machines')}</span></NavLink>
            </nav>
            {owner && (
              <nav aria-label={t('nav.groupAdmin')} className="nav nav-group">
                <p className="nav-heading">{t('nav.groupAdmin')}</p>
                <NavLink href="/users"><Icon name="people" /><span>{t('nav.users')}</span></NavLink>
                <NavLink href="/history"><Icon name="history" /><span>{t('nav.history')}</span></NavLink>
                <NavLink href="/bin" section="/bin"><Icon name="trash" /><span>{t('nav.bin')}</span></NavLink>
              </nav>
            )}
          </>
        ) : (
          <nav aria-label={t('nav.label')} className="nav">
            {/* Supervisors put what is spent on the daily report, so they add no money entries (owner decision 2026-11-03). */}
            <NavLink href="/overview"><Icon name="home" /><span>{t('nav.home')}</span></NavLink>
            <NavLink href="/report" section="/report"><Icon name="report" /><span>{t('nav.report')}</span></NavLink>
            <NavLink href="/entries" exact><Icon name="daybook" /><span>{t('nav.daybook')}</span></NavLink>
            <NavLink href="/stock" section="/stock"><Icon name="stock" /><span>{t('nav.stock')}</span></NavLink>
            <NavLink href="/assets" section="/assets"><Icon name="tool" /><span>{t('nav.assets')}</span></NavLink>
            <NavLink href="/rentals" section="/rentals"><Icon name="rent" /><span>{t('nav.rentals')}</span></NavLink>
          </nav>
        )}
        {/* Supervisors keep their own lists (workers, materials, units); the office the rest too. */}
        {!labourOnly && <nav aria-label={t('nav.masters')} className="nav nav-foot">
          <NavLink href={office ? '/masters/firms' : '/masters/workers'} section="/masters"><Icon name="setup" /><span>{t('nav.masters')}</span></NavLink>
        </nav>}
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
