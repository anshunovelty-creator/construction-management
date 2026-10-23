import { getLocale, getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { changedFields } from '@/lib/masters/diff';
import { createClient } from '@/lib/supabase/server';

interface Change {
  id: number;
  table_name: string;
  row_key: string;
  action: 'insert' | 'update' | 'delete';
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: string;
}

const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/** Spec rule 11: who changed which master record, from what to what. Latest 200 changes. */
export default async function HistoryPage() {
  await requireProfile('owner');
  const db = await createClient();
  const [{ data: changes }, { data: people }, t, locale] = await Promise.all([
    db.from('master_changes').select('*').order('id', { ascending: false }).limit(200).returns<Change[]>(),
    db.from('profiles').select('user_id, full_name'),
    getTranslations(),
    getLocale(),
  ]);
  const names = new Map((people ?? []).map((p) => [p.user_id as string, p.full_name as string]));
  const when = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <>
      <h1>{t('history.title')}</h1>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>{t('history.when')}</th>
              <th>{t('history.who')}</th>
              <th>{t('history.what')}</th>
              <th>{t('history.changes')}</th>
            </tr>
          </thead>
          <tbody>
            {(changes ?? []).map((change) => {
              const row = change.new_row ?? change.old_row ?? {};
              return (
                <tr key={change.id}>
                  <td className="whitespace-nowrap">{when.format(new Date(change.changed_at))}</td>
                  <td>{change.changed_by ? (names.get(change.changed_by) ?? change.changed_by) : t('history.system')}</td>
                  <td>
                    {change.table_name} {t(`history.action.${change.action}`)}: {show(row.name ?? row.ref ?? row.full_name ?? change.row_key)}
                  </td>
                  <td>
                    <ul>
                      {changedFields(change.old_row, change.new_row).map((c) => (
                        <li key={c.field}>
                          {c.field}: {show(c.before)} → {show(c.after)}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
