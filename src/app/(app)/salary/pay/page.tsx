import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { PayPeople } from '@/components/pay-people';
import { RowFilter } from '@/components/row-filter';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { salaryLedger } from '@/lib/wages';
import { todayInIndia } from '../../entries/data';
import { payPeople } from '../../pay/actions';
import { payAccounts } from '../../pay/data';
import { loadSalaryPeople } from '../data';

/** Pays salaries or advances to many people at once, as one line in one account's bankbook. ?kind=worker for the skill workers. */
export default async function PaySalaryPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const [working, t, asked] = await Promise.all([getWorkingFirm(), getTranslations(), searchParams]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const kind = asked.kind === 'worker' ? 'worker' : 'staff';
  const db = await createClient();
  const today = todayInIndia();
  const [people, accounts] = await Promise.all([loadSalaryPeople(db, today), payAccounts(db, profile.role, working.firm.id)]);
  const rows = people.filter((p) => p.kind === kind).map((p) => ({
    // What is due up to this month; a month not yet over counts in full for staff, as on the Salary page.
    id: p.id, name: p.name, left: salaryLedger(p.person).filter((m) => m.month <= today.slice(0, 7)).at(-1)?.balance ?? 0, active: p.is_active,
  })).filter((r) => r.active || r.left !== 0);

  return (
    <>
      <Link href={kind === 'staff' ? '/salary' : '/salary/labour'} className="back"><Icon name="chevronLeft" size={16} /> {t('salary.title')}</Link>
      <h1>{t('pay.salaryTitle', { firm: working.firm.name })}</h1>
      <p className="lede">{t('pay.lede')}</p>
      <nav className="subnav" aria-label={t('salary.title')}>
        {(['staff', 'worker'] as const).map((k) => <Link key={k} href={`/salary/pay?kind=${k}`} className="nav-link" aria-current={k === kind ? 'page' : undefined}>{t(k === 'staff' ? 'salary.staff' : 'salary.labour')}</Link>)}
      </nav>
      {rows.length > 0 && <div className="toolbar"><RowFilter table="pay-people" label={t('labour.search')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} /></div>}
      <PayPeople key={kind} rows={rows} accounts={accounts} today={today} save={payPeople.bind(null, 'salary')} />
    </>
  );
}
