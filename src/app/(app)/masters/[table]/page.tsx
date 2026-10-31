import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { ListLink } from '@/components/list-link';
import { requireProfile } from '@/lib/auth';
import { getMaster } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { saveMaster } from '../actions';
import { displayValue, loadChoices } from '../options';

export default async function MasterListPage({ params }: { params: Promise<{ table: string }> }) {
  const { table: slug } = await params;
  const def = getMaster(slug);
  if (!def) notFound();
  const profile = await requireProfile('owner', 'office');
  const canEdit = !def.ownerOnly || profile.role === 'owner';
  const db = await createClient();
  const query = db.from(def.table).select('*');
  const [{ data: rows }, choices, t] = await Promise.all([
    (def.kinds ? query.in('kind', def.kinds) : query).order(def.list[0]!),
    loadChoices(db, def.fields),
    getTranslations(),
  ]);
  const fieldByName = new Map(def.fields.map((f) => [f.name, f]));

  return (
    <>
      <h2 className="card-title">{t(`masters.${slug}`)}</h2>
      {!canEdit && <p className="mb-4 text-gray-600">{t('masters.readOnly')}</p>}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {def.list.map((column) => (
                  <th key={column}>{t(`fields.${column}`)}</th>
                ))}
                {canEdit && <th aria-label={t('masters.edit')} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {def.list.map((column) => (
                    <td key={column}>{displayValue(fieldByName.get(column)!, row[column], choices, t)}</td>
                  ))}
                  {canEdit && (
                    <td>
                      <ListLink href={`/masters/${slug}/${row.id}`} className="underline">
                        {t('masters.edit')}
                      </ListLink>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t('masters.empty')}</p>
      )}
      {canEdit && (
        <>
          <h2>{t('masters.add')}</h2>
          <Form fields={def.fields} choices={choices} action={saveMaster.bind(null, slug, null)} submitLabel={t('masters.save')} />
        </>
      )}
    </>
  );
}
