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
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const { error, head: asked } = await searchParams;
  // A new family's head, or a member of the family whose head is named.
  const head = asked === 'new' || /^[0-9a-f-]{36}$/i.test(asked ?? '') ? asked : undefined;
  const family = head && head !== 'new'
    ? (await (await createClient()).from('labour_workers').select('name').eq('id', head).eq('head_id', head).maybeSingle()).data
    : null;
  if (head && head !== 'new' && !family) notFound();
  return (
    <>
      {family
        ? <Link href={`/labour/family/${head}`} className="back"><Icon name="chevronLeft" size={16} /> {t('labour.familyOf', { name: family.name })}</Link>
        : <Link href={head ? '/labour/family' : '/labour'} className="back"><Icon name="chevronLeft" size={16} /> {t(head ? 'labour.tabs.families' : 'labour.tabs.workers')}</Link>}
      <h1>{family ? t('labour.addMember', { name: family.name }) : t(head ? 'labour.newFamily' : 'labour.addWorker')}</h1>
      {head === 'new' && <p className="lede">{t('labour.newFamilyLede')}</p>}
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}
      <WorkerForm action={saveWorker.bind(null, null)} today={todayInIndia()} head={head} t={t} />
    </>
  );
}
