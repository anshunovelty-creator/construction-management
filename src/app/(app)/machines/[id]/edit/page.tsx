import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { DeleteBox } from '@/components/delete-box';
import { deleteMachine, saveMachine } from '../../actions';
import { loadMachines } from '../../data';
import { MachineForm } from '../../machine-form';
import { Icon } from '@/components/icons';

export default async function EditMachinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [machine] = await loadMachines(await createClient(), id);
  if (!machine) notFound();
  return (
    <>
      <Link href={`/machines/${id}`} className="back"><Icon name="chevronLeft" size={16} /> {machine.name}</Link>
      <h1>{t('machines.changeOf', { name: machine.name })}</h1>
      {error && <p className="banner bad">{t(`machines.errors.${error}`)}</p>}
      <MachineForm action={saveMachine.bind(null, id)} machine={machine} t={t} />
      {profile.role === 'owner' && (
        <DeleteBox action={deleteMachine.bind(null, id)} name={machine.name} title={t('machines.delete.title')} warning={t('machines.delete.warning')}
          typeLabel={t('masters.delete.typeName', { name: machine.name })} confirmLabel={t('masters.delete.confirm', { name: machine.name })} />
      )}
    </>
  );
}
