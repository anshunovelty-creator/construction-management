import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { saveMachine } from '../actions';
import { MachineForm } from '../machine-form';

export default async function NewMachinePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireProfile('owner', 'office');
  const t = await getTranslations();
  const { error } = await searchParams;
  return (
    <>
      <Link href="/machines" className="back">◄ {t('machines.title')}</Link>
      <h1>{t('machines.add')}</h1>
      {error && <p className="banner bad">{t(`machines.errors.${error}`)}</p>}
      <MachineForm action={saveMachine.bind(null, null)} t={t} />
    </>
  );
}
