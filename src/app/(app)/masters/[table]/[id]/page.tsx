import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { toFormValue } from '@/lib/masters/parse';
import { getMaster } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { saveMaster } from '../../actions';
import { loadChoices } from '../../options';

export default async function MasterEditPage({ params }: { params: Promise<{ table: string; id: string }> }) {
  const { table: slug, id } = await params;
  const def = getMaster(slug);
  if (!def) notFound();
  const profile = await requireProfile('owner', 'office');
  if (def.ownerOnly && profile.role !== 'owner') redirect(`/masters/${slug}`);
  const db = await createClient();
  const { data: row } = await db.from(def.table).select('*').eq('id', id).maybeSingle();
  if (!row) notFound();
  const [choices, t] = await Promise.all([loadChoices(db, def.fields), getTranslations()]);
  const defaults = Object.fromEntries(def.fields.map((f) => [f.name, toFormValue(f, row[f.name])]));

  return (
    <>
      <p className="mb-2">
        <Link href={`/masters/${slug}`} className="underline">
          ← {t(`masters.${slug}`)}
        </Link>
      </p>
      <h1>
        {t('masters.edit')}: {String(row.name ?? row.ref ?? row.code)}
      </h1>
      <Form fields={def.fields} defaults={defaults} choices={choices} action={saveMaster.bind(null, slug, id)} submitLabel={t('masters.save')} />
    </>
  );
}
