import { getTranslations } from 'next-intl/server';
import { PayPeople } from '@/components/pay-people';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { payPeople } from '../../pay/actions';
import { labourFirm, payAccounts } from '../../pay/data';
import { loadFamilies } from '../data';

/** Pays the heads of families, many at once, as one line in one account's bankbook. */
export default async function PayLabourPage() {
  const profile = await requireProfile('owner', 'office');
  const t = await getTranslations();
  const db = await createClient();
  const firm = await labourFirm(db);
  const [families, accounts] = await Promise.all([loadFamilies(db), payAccounts(db, profile.role, firm?.id)]);
  const rows = families.filter((f) => f.head.is_active || f.balance !== 0)
    .map((f) => ({ id: f.head.id, name: f.head.name, note: f.members.length > 1 ? t('labour.familyOfCount', { count: f.members.length }) : f.head.skill, left: f.balance }));
  return (
    <>
      <h1>{t('pay.labourTitle')}</h1>
      <p className="lede">{t('pay.lede')}</p>
      {rows.length > 0 && <div className="toolbar"><RowFilter table="pay-people" label={t('labour.search')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} /></div>}
      <PayPeople rows={rows} accounts={accounts} today={todayInIndia()} save={payPeople.bind(null, 'labour')} />
    </>
  );
}
