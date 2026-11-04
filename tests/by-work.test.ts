import { expect, it } from 'vitest';
import { byWork, usedNote } from '@/lib/stock';

it('groups used lines under their work, in the order first used, with other lines last', () => {
  const rows = [
    { id: 1, mix_name: '' }, { id: 2, mix_name: 'PCC' }, { id: 3, mix_name: 'RCC' }, { id: 4, mix_name: 'PCC' }, { id: 5, mix_name: '' },
  ];
  expect(byWork(rows).map((g) => [g.name, g.rows.map((r) => r.id)])).toEqual([
    ['PCC', [2, 4]], ['RCC', [3]], ['', [1, 5]],
  ]);
});

it('notes a used line with its work and remark', () => {
  expect(usedNote({ mix_name: 'PCC', remark: 'Slab' })).toBe('PCC · Slab');
  expect(usedNote({ mix_name: '', remark: 'Slab' })).toBe('Slab');
  expect(usedNote({ mix_name: 'PCC', remark: '' })).toBe('PCC');
});
