'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { addMaterial } from '@/app/(app)/masters/actions';
import type { Choice } from '@/lib/masters/registry';
import { SearchSelect } from '@/components/search-select';

/**
 * A small box for adding a material from the form being filled in: its name (as typed in the list) and unit. It sits
 * inside that form, so it has no form of its own and its boxes have no names: nothing of it is sent with the form.
 */
export function NewMaterial({ name, units, kind, onAdded, onClose }: {
  name: string;
  /** What it is kept as: stock (the default) or an asset, for the Assets page. */
  kind?: 'consumable' | 'asset';
  units: Choice[];
  onAdded: (material: { id: string; name: string; unitId: string }) => void;
  onClose: () => void;
}) {
  const t = useTranslations('newMaterial');
  const box = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(name);
  const [unitId, setUnitId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    box.current?.showModal();
  }, []);

  async function add() {
    setSaving(true);
    setError('');
    const result = await addMaterial(text, unitId, kind);
    setSaving(false);
    if ('error' in result) return setError(result.error);
    onAdded({ ...result, unitId });
  }

  return (
    <dialog ref={box} className="new-material" aria-labelledby="new-material-title" onClose={onClose}>
      <h2 id="new-material-title">{t('title')}</h2>
      <label className="field">
        <span>{t('name')}</span>
        <input value={text} onChange={(e) => setText(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      </label>
      <label className="field">
        <span>{t('unit')}</span>
        <SearchSelect value={unitId} onChange={setUnitId} options={units} placeholder={t('pickUnit')} />
      </label>
      {error && <p className="banner bad" role="alert">{t(`errors.${error}`)}</p>}
      <div className="new-material-actions">
        <button type="button" className="btn ghost" onClick={() => box.current?.close()}>{t('cancel')}</button>
        <button type="button" className="btn" disabled={saving || !text.trim() || !unitId} onClick={add}>
          {saving ? t('adding') : t('add')}
        </button>
      </div>
    </dialog>
  );
}
