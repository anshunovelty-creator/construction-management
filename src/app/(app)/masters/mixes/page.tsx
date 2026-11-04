import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { QTY } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { deleteMix, saveMix } from '../actions';
import { MixForm } from './mix-form';

interface MixRow {
  id: string;
  name: string;
  unit_id: string | null;
  is_active: boolean;
  items: { material_id: string; quantity: number | string; position: number }[];
}

/**
 * Setup → Combination works: PCC, RCC, plaster, tiles… and how much of each material 1 unit of the work takes.
 * Picking one on the daily report adds its materials to the material used list. ?edit=<id> changes one.
 */
export default async function MixesPage({ searchParams }: { searchParams: Promise<{ edit?: string; error?: string }> }) {
  const profile = await requireProfile();
  const { edit, error } = await searchParams;
  const t = await getTranslations();
  const db = await createClient();
  const [{ data: mixes }, { data: units }, { data: materials }] = await Promise.all([
    db.from('mixes').select('id, name, unit_id, is_active, items:mix_items(material_id, quantity, position)').order('name').returns<MixRow[]>(),
    db.from('units').select('id, name, is_active').order('name'),
    db.from('materials').select('id, name, is_active, item_kind, unit:units(name)').order('name')
      .returns<{ id: string; name: string; is_active: boolean; item_kind: string; unit: { name: string } | null }[]>(),
  ]);
  const unitName = new Map((units ?? []).map((u) => [u.id as string, u.name as string]));
  const material = new Map((materials ?? []).map((m) => [m.id, m]));
  const items = (m: MixRow) => [...m.items].sort((a, b) => a.position - b.position);
  const editing = (mixes ?? []).find((m) => m.id === edit);
  const formProps = {
    units: (units ?? []).filter((u) => u.is_active).map((u) => ({ value: u.id as string, label: u.name as string })),
    // Only stock is used up on a site, so a work is made of consumables.
    materials: (materials ?? []).filter((m) => m.is_active && m.item_kind === 'consumable')
      .map((m) => ({ id: m.id, name: m.name, unit: m.unit?.name ?? '' })),
  };

  return (
    <>
      <h2 className="card-title">{t('masters.mixes')}</h2>
      {error === 'delete_failed' && <p className="banner bad" role="alert">{t('mixes.delete.failed')}</p>}
      {mixes && mixes.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('mixes.name')}</th>
                <th>{t('mixes.unit')}</th>
                <th>{t('mixes.takes')}</th>
                <th>{t('fields.is_active')}</th>
                <th aria-label={t('masters.edit')} />
              </tr>
            </thead>
            <tbody>
              {mixes.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong></td>
                  <td>{m.unit_id ? `1 ${unitName.get(m.unit_id) ?? ''}` : ''}</td>
                  <td>
                    {items(m).map((x) => {
                      const mat = material.get(x.material_id);
                      return `${mat?.name ?? ''} ${QTY.format(Number(x.quantity))} ${mat?.unit?.name ?? ''}`.trim();
                    }).join(' · ')}
                  </td>
                  <td>{m.is_active ? t('mixes.yes') : t('mixes.no')}</td>
                  <td><Link href={`/masters/mixes?edit=${m.id}`} className="underline">{t('masters.edit')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t('mixes.none')}</p>
      )}
      <MixForm key={editing?.id ?? 'new'} {...formProps} action={saveMix.bind(null, editing?.id ?? null)}
        initial={editing && {
          name: editing.name, unitId: editing.unit_id ?? '', isActive: editing.is_active,
          lines: items(editing).map((x) => ({ materialId: x.material_id, quantity: String(Number(x.quantity)) })),
        }} />
      {editing && profile.role === 'owner' && (
        <details className="cancel card delete-box mt-6">
          <summary>{t('mixes.delete.title')}</summary>
          <p className="hint">{t('mixes.delete.warning')}</p>
          <form action={deleteMix.bind(null, editing.id)}>
            <button type="submit" className="btn danger">{t('mixes.delete.confirm', { name: editing.name })}</button>
          </form>
        </details>
      )}
    </>
  );
}
