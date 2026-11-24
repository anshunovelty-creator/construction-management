import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { rateFor } from '@/lib/labour';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../../entries/data';
import { DeleteBox } from '@/components/delete-box';
import { deleteWorker, saveWorker } from '../../actions';
import { loadLabour } from '../../data';
import { WorkerForm } from '../../worker-form';
import { Icon } from '@/components/icons';

export default async function EditLabourWorkerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const profile = await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await createClient();
  const [[person], { data: inFamilies }, { count: moneyLines }, { data: charges }] = await Promise.all([
    loadLabour(db, id),
    db.from('labour_workers').select('id, name, head_id').order('name'),
    db.from('labour_money').select('id', { count: 'exact', head: true }).eq('worker_id', id),
    db.from('labour_charge_rates').select('from_month, rate_paise').eq('worker_id', id).lte('from_month', todayInIndia()).order('from_month', { ascending: false }).limit(1),
  ]);
  if (!person) notFound();
  const families = (inFamilies ?? []).filter((w) => w.head_id === w.id) as { id: string; name: string }[];
  const isHead = person.head_id === person.id;
  const familyLocked = isHead && ((inFamilies ?? []).some((w) => w.head_id === id && w.id !== id) || (moneyLines ?? 0) > 0);
  const today = todayInIndia();
  return (
    <>
      <Link href={`/labour/family/${person.head_id}`} className="back"><Icon name="chevronLeft" size={16} /> {t('labour.tabs.workers')}</Link>
      <h1>{t('labour.changeOf', { name: person.name })}</h1>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}
      <WorkerForm action={saveWorker.bind(null, id)} worker={person} rate={rateFor(person.rates, today.slice(0, 7))} today={today}
        charge={profile.role === 'labour' ? undefined : charges?.[0]?.rate_paise ? Number(charges[0].rate_paise) : null}
        families={families} familyLocked={familyLocked} t={t} />
      <DeleteBox action={deleteWorker.bind(null, id)} name={person.name} title={t('labour.delete.title')} warning={t('labour.delete.warning')}
        typeLabel={t('masters.delete.typeName', { name: person.name })} confirmLabel={t('masters.delete.confirm', { name: person.name })} />
    </>
  );
}
