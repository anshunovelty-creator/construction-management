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

export default async function EditLabourWorkerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [person] = await loadLabour(await createClient(), id);
  if (!person) notFound();
  const today = todayInIndia();
  return (
    <>
      <Link href={`/labour/${id}`} className="back">◄ {person.name}</Link>
      <h1>{t('labour.changeOf', { name: person.name })}</h1>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}
      <WorkerForm action={saveWorker.bind(null, id)} worker={person} rate={rateFor(person.rates, today.slice(0, 7))} today={today} t={t} />
      <DeleteBox action={deleteWorker.bind(null, id)} name={person.name} title={t('labour.delete.title')} warning={t('labour.delete.warning')}
        typeLabel={t('masters.delete.typeName', { name: person.name })} confirmLabel={t('masters.delete.confirm', { name: person.name })} />
    </>
  );
}
