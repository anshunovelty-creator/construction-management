import { getTranslations } from 'next-intl/server';
import type { Choices } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { changedFields } from '@/lib/masters/diff';
import { EDIT_USER_FIELDS, MASTERS, NEW_USER_FIELDS, type Field } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadNames } from '../entries/data';
import { displayValue } from '../masters/options';

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

/** The fields worth showing per table; anything else (ids, timestamps) stays hidden. */
const FIELDS: Record<string, Field[]> = {
  ...Object.fromEntries(Object.values(MASTERS).map((m) => [m.table, m.fields])),
  profiles: [...NEW_USER_FIELDS, ...EDIT_USER_FIELDS].filter((f) => f.kind !== 'password' && f.kind !== 'multi'),
};

/** Spec rule 11: who changed which master record, from what to what. Latest 200 changes. */
export default async function HistoryPage() {
  await requireProfile('owner');
  const db = await createClient();
  const [{ data: changes }, names, t] = await Promise.all([
    db.from('master_changes').select('*').order('id', { ascending: false }).limit(200).returns<Change[]>(),
    loadNames(db),
    getTranslations(),
  ]);
  const when = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
  const choices: Choices = Object.fromEntries(
    (
      [
        ['firms', names.firms],
        ['sites', names.sites],
        ['clients', names.parties],
        ['supervisors', names.people],
      ] as const
    ).map(([source, map]) => [source, [...map].map(([value, label]) => ({ value, label }))]),
  );
  const nameOf = (map: Map<string, string>, id: unknown) => map.get(String(id)) ?? t('common.none');

  const sentence = (change: Change, row: Record<string, unknown>) => {
    if (change.table_name === 'user_firms' || change.table_name === 'user_sites') {
      return t(`history.access.${change.table_name}.${change.action === 'delete' ? 'delete' : 'insert'}`, {
        person: nameOf(names.people, row.user_id),
        firm: nameOf(names.firms, row.firm_id),
        site: nameOf(names.sites, row.site_id),
      });
    }
    const thing = change.table_name === 'parties' ? String(row.kind) : change.table_name;
    return t('history.sentence', {
      action: t(`history.action.${change.action}`),
      thing: t.has(`history.thing.${thing}`) ? t(`history.thing.${thing}`) : change.table_name,
      name: String(row.name ?? row.ref ?? row.full_name ?? ''),
    });
  };

  const details = (change: Change) => {
    if (change.action === 'delete') return [];
    const fields = FIELDS[change.table_name] ?? [];
    return changedFields(change.old_row, change.new_row).flatMap((c) => {
      const field = fields.find((f) => f.name === c.field);
      // A new record's name (and a party's kind) is already in the sentence, it starts switched on, and 0% says nothing.
      const said = ['name', 'ref', 'full_name', 'is_active', ...(change.table_name === 'parties' ? ['kind'] : [])];
      if (!field || (change.action === 'insert' && (c.after === null || c.after === 0 || said.includes(c.field)))) return [];
      const show = (value: unknown) => displayValue(field, value, choices, t);
      // Drop form hints such as "(2–4 capital letters)" from the label.
      const label = t(`fields.${field.name}`).replace(/\s*\(.*\)$/, '');
      return [{ label, before: change.action === 'update' ? show(c.before) : null, after: show(c.after) }];
    });
  };

  return (
    <>
      <h1>{t('history.title')}</h1>
      <p className="lede">{t('history.lede')}</p>
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
            {(changes ?? []).map((change) => (
              <tr key={change.id}>
                <td className="whitespace-nowrap">{when.format(new Date(change.changed_at))}</td>
                <td>{change.changed_by ? nameOf(names.people, change.changed_by) : t(change.action === 'delete' ? 'history.testDelete' : 'history.system')}</td>
                <td>{sentence(change, change.new_row ?? change.old_row ?? {})}</td>
                <td>
                  <ul>
                    {details(change).map((d) => (
                      <li key={d.label}>
                        {d.label}: {d.before === null ? d.after : `${d.before} → ${d.after}`}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
