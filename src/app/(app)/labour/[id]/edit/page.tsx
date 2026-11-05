import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../../entries/data';
import { saveWorker } from '../../actions';
import { loadLabour } from '../../data';
import { WorkerForm } from '../../worker-form';

export default async function EditLabourWorkerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const today = todayInIndia();
  const { people } = await loadLabour(await createClient(), today, id);
  const person = people[0];
  if (!person) notFound();
  const rate = person.rates.at(-1);
  return (
    <>
      <Link href={`/labour/${id}`} className="back">◄ {person.name}</Link>
      <h1>{t('labour.changeOf', { name: person.name })}</h1>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}
      <WorkerForm action={saveWorker.bind(null, id)} worker={person} rate={rate ? Number(rate.rate_paise) : undefined} today={today} t={t} />
    </>
  );
}
