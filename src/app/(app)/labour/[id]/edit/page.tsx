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
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await createClient();
  const [[person], { data: inFamilies }, { count: moneyLines }] = await Promise.all([
    loadLabour(db, id),
    db.from('labour_workers').select('id, name, head_id').not('head_id', 'is', null).order('name'),
    db.from('labour_money').select('id', { count: 'exact', head: true }).eq('worker_id', id),
  ]);
  if (!person) notFound();
  const families = (inFamilies ?? []).filter((w) => w.head_id === w.id) as { id: string; name: string }[];
  const isHead = person.head_id === person.id;
  const familyLocked = isHead && ((inFamilies ?? []).some((w) => w.head_id === id && w.id !== id) || (moneyLines ?? 0) > 0);
  const today = todayInIndia();
  return (
    <>
      <Link href={person.head_id ? `/labour/family/${person.head_id}` : `/labour/${id}`} className="back"><Icon name="chevronLeft" size={16} /> {person.head_id ? t('labour.tabs.families') : person.name}</Link>
      <h1>{t('labour.changeOf', { name: person.name })}</h1>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}
      <WorkerForm action={saveWorker.bind(null, id)} worker={person} rate={rateFor(person.rates, today.slice(0, 7))} today={today}
        families={families} familyLocked={familyLocked} t={t} />
      <DeleteBox action={deleteWorker.bind(null, id)} name={person.name} title={t('labour.delete.title')} warning={t('labour.delete.warning')}
        typeLabel={t('masters.delete.typeName', { name: person.name })} confirmLabel={t('masters.delete.confirm', { name: person.name })} />
    </>
  );
}
