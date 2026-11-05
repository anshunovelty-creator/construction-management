import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { todayInIndia } from '../../entries/data';
import { saveWorker } from '../actions';
import { WorkerForm } from '../worker-form';

export default async function NewLabourWorkerPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const { error } = await searchParams;
  return (
    <>
      <Link href="/labour" className="back">◄ {t('labour.tabs.workers')}</Link>
      <h1>{t('labour.addWorker')}</h1>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}
      <WorkerForm action={saveWorker.bind(null, null)} today={todayInIndia()} t={t} />
    </>
  );
}
