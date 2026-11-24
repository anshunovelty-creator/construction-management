import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { saveWorker } from '../actions';
import { WorkerForm } from '../worker-form';
import { Icon } from '@/components/icons';

export default async function NewLabourWorkerPage({ searchParams }: { searchParams: Promise<{ error?: string; head?: string }> }) {
  const profile = await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const { error, head: asked } = await searchParams;
  // A new worker heads a family of their own; with a head named, they join that family.
  const head = /^[0-9a-f-]{36}$/i.test(asked ?? '') ? asked : undefined;
  const family = head
    ? (await (await createClient()).from('labour_workers').select('name').eq('id', head).eq('head_id', head).maybeSingle()).data
    : null;
  if (head && !family) notFound();
  return (
    <>
      {family
        ? <Link href={`/labour/family/${head}`} className="back"><Icon name="chevronLeft" size={16} /> {t('labour.familyOf', { name: family.name })}</Link>
        : <Link href="/labour" className="back"><Icon name="chevronLeft" size={16} /> {t('labour.tabs.workers')}</Link>}
      <h1>{family ? t('labour.addMember', { name: family.name }) : t('labour.addWorker')}</h1>
      {!family && <p className="lede">{t('labour.newWorkerLede')}</p>}
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}
      <WorkerForm action={saveWorker.bind(null, null)} today={todayInIndia()} head={head} charge={profile.role === 'labour' ? undefined : null} t={t} />
    </>
  );
}
