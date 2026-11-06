import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { saveMachine } from '../../actions';
import { loadMachines } from '../../data';
import { MachineForm } from '../../machine-form';

export default async function EditMachinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireProfile('owner', 'office');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [machine] = await loadMachines(await createClient(), id);
  if (!machine) notFound();
  return (
    <>
      <Link href={`/machines/${id}`} className="back">◄ {machine.name}</Link>
      <h1>{t('machines.changeOf', { name: machine.name })}</h1>
      {error && <p className="banner bad">{t(`machines.errors.${error}`)}</p>}
      <MachineForm action={saveMachine.bind(null, id)} machine={machine} t={t} />
    </>
  );
}
