import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { ListLink } from '@/components/list-link';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { getMaster, mayEdit, mayView, OPENING_FIELDS, type Field } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { saveMaster } from '../actions';
import { displayValue, loadChoices } from '../options';

export default async function MasterListPage({ params, searchParams }: { params: Promise<{ table: string }>; searchParams: Promise<{ binned?: string }> }) {
  const { binned } = await searchParams;
  const { table: slug } = await params;
  const profile = await requireProfile();
  const def = getMaster(slug, profile.role);
  if (!def) notFound();
  if (!mayView(def, profile.role)) redirect('/masters/workers');
  const canEdit = mayEdit(def, profile.role);
  const db = await createClient();
  const query = db.from(def.table).select('*');
  const [{ data: rows }, choices, t] = await Promise.all([
    // Banks and cash go firm by firm, the ones in use first.
    slug === 'money-accounts' ? query.order('is_active', { ascending: false }).order('firm_id').order('kind').order('name')
      : (def.kinds ? query.in('kind', def.kinds) : query).order(def.list[0]!),
    loadChoices(db, def.fields),
    getTranslations(),
  ]);
  // A new bank or cash account can say what it holds already, and starts in the firm being worked in.
  const account = slug === 'money-accounts' && canEdit;
  const working = account ? await getWorkingFirm() : null;
  const fieldByName = new Map(def.fields.map((f) => [f.name, f]));

  return (
    <>
      <h2 className="card-title">{t(`masters.${slug}`)}</h2>
      {binned && <p className="banner" role="status">{t('masters.delete.binned')}</p>}
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
          <h2 id="add">{t('masters.add')}</h2>
          <Form fields={account ? [...def.fields.slice(0, -1).map((f) => (f.name === 'firm_id' ? { ...f, required: true } as Field : f)), ...OPENING_FIELDS, ...def.fields.slice(-1)] : def.fields} choices={choices}
            defaults={account ? { firm_id: working?.firm.id ?? '', opening_date: todayInIndia() } : undefined} hintPrefix={account ? 'accountForm.hints' : 'masterForm.hints'}
            action={saveMaster.bind(null, slug, null)} submitLabel={t('masters.save')} />
        </>
      )}
    </>
  );
}
