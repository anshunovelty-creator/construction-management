'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { NewMaterial } from '@/components/new-material';
import { SearchSelect } from '@/components/search-select';

type Choice = { value: string; label: string };

/**
 * The material box of the arrival form. A material not on the list yet can be added from here ("+ Add …"), and is
 * then picked, so the supervisor does not have to go to Setup first.
 */
export function MaterialPicker({ id, materials, units, kind }: {
  id: string;
  materials: Choice[];
  units: Choice[];
  kind: 'consumable' | 'asset';
}) {
  const t = useTranslations();
  const [added, setAdded] = useState<Choice[]>([]);
  const [value, setValue] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  return (
    <>
      {creating !== null && (
        <NewMaterial name={creating} units={units} kind={kind} onClose={() => setCreating(null)} onAdded={(m) => {
          const unit = units.find((u) => u.value === m.unitId)?.label;
          setAdded((all) => [...all, { value: m.id, label: unit ? `${m.name} (${unit})` : m.name }]);
          setValue(m.id);
          setCreating(null);
        }} />
      )}
      <SearchSelect id={id} name="material_id" required placeholder={t('common.choose')} value={value} onChange={setValue}
        options={[...materials, ...added]} onCreate={setCreating} createLabel={(name) => t('newMaterial.addAs', { name })} />
    </>
  );
}
