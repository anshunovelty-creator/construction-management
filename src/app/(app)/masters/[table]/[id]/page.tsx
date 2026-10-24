import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { toFormValue } from '@/lib/masters/parse';
import { getMaster } from '@/lib/masters/registry';
import { allowDelete } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { deleteMaster, saveMaster } from '../../actions';
import { loadChoices } from '../../options';

export default async function MasterEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string; id: string }>;
  searchParams: Promise<{ error?: string; used?: string }>;
}) {
  const { table: slug, id } = await params;
  const { error, used } = await searchParams;
  const def = getMaster(slug);
  if (!def) notFound();
  const profile = await requireProfile('owner', 'office');
  if (def.ownerOnly && profile.role !== 'owner') redirect(`/masters/${slug}`);
  const db = await createClient();
  const { data: row } = await db.from(def.table).select('*').eq('id', id).maybeSingle();
  if (!row) notFound();
  const [choices, t] = await Promise.all([loadChoices(db, def.fields), getTranslations()]);
  const defaults = Object.fromEntries(def.fields.map((f) => [f.name, toFormValue(f, row[f.name])]));
  const usedBy = used && t.has(`masters.delete.usedBy.${used}`) ? t(`masters.delete.usedBy.${used}`) : used;

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

      {profile.role === 'owner' && allowDelete() && (
        <details className="cancel card delete-box" open={Boolean(error)}>
          <summary>{t('masters.delete.title')}</summary>
          <p className="hint">{t('masters.delete.warning')}</p>
          {error && (
            <p className="error form-error" role="alert">
              {error === 'in_use' ? t('masters.delete.inUse', { what: usedBy ?? '' }) : t(`errors.${error === 'not_allowed' ? 'not_allowed' : 'save_failed'}`)}
            </p>
          )}
          <form action={deleteMaster.bind(null, slug, id)}>
            <button type="submit" className="btn danger">{t('masters.delete.confirm')}</button>
          </form>
        </details>
      )}
    </>
  );
}
