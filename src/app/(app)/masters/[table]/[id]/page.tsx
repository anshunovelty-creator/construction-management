import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { toFormValue } from '@/lib/masters/parse';
import { getMaster, mayEdit } from '@/lib/masters/registry';
import { DeleteBox } from '@/components/delete-box';
import { createClient } from '@/lib/supabase/server';
import { TYPE_TO_DELETE } from '@/lib/delete';
import { deleteMaster, saveMaster } from '../../actions';
import { loadChoices } from '../../options';
import { Icon } from '@/components/icons';

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
  const profile = await requireProfile();
  if (!mayEdit(def, profile.role)) redirect(`/masters/${slug}`);
  const db = await createClient();
  const { data: row } = await db.from(def.table).select('*').eq('id', id).maybeSingle();
  if (!row) notFound();
  const [choices, t] = await Promise.all([loadChoices(db, def.fields), getTranslations()]);
  const defaults = Object.fromEntries(def.fields.map((f) => [f.name, toFormValue(f, row[f.name])]));
  const name = String(row.name ?? row.ref ?? row.code);
  const usedBy = used && t.has(`masters.delete.usedBy.${used}`) ? t(`masters.delete.usedBy.${used}`) : used;

  return (
    <>
      <p className="mb-2">
        <Link href={`/masters/${slug}`} className="back">
          <Icon name="chevronLeft" size={16} /> {t(`masters.${slug}`)}
        </Link>
      </p>
      <h2 className="card-title">
        {t('masters.edit')}: {name}
      </h2>
      <Form fields={def.fields} defaults={defaults} choices={choices} action={saveMaster.bind(null, slug, id)} submitLabel={t('masters.save')} />

      {/* A firm is never deleted: every entry, site and account hangs off it. It can only be renamed. */}
      {/* A PF rate is changed, not deleted: months already paid were worked out with it. */}
      {profile.role === 'owner' && slug !== 'pf-rates' && (slug === 'firms' ? <p className="hint mt-6">{t('masters.delete.noFirm')}</p> : (
        <DeleteBox action={deleteMaster.bind(null, slug, id)} name={name}
          title={t('masters.delete.title')} warning={t('masters.delete.warning')}
          typeLabel={TYPE_TO_DELETE.has(slug) ? t('masters.delete.typeName', { name }) : undefined}
          confirmLabel={t('masters.delete.confirm', { name })}
          error={!error ? undefined : error === 'in_use' ? t('masters.delete.inUse', { what: usedBy ?? '' })
            : error === 'name' ? t('masters.delete.wrongName') : t(`errors.${error === 'not_allowed' ? 'not_allowed' : 'save_failed'}`)} />
      ))}
    </>
  );
}
