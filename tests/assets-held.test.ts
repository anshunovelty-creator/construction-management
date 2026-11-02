import { expect, it } from 'vitest';
import { heldAt, holdings } from '@/app/(app)/assets/held';

it('counts what is at each site: bought there + moved in − moved out', () => {
  const bought = [{ material_id: 'axe', site_id: 'A', quantity: '10' }, { material_id: 'axe', site_id: 'B', quantity: 2 }];
  const moves = [
    { material_id: 'axe', from_site_id: 'A', to_site_id: 'B', quantity: '4' },
    { material_id: 'axe', from_site_id: 'B', to_site_id: 'C', quantity: 1 },
  ];
  expect(heldAt(bought, moves, 'axe', 'A')).toBe(6);
  expect(heldAt(bought, moves, 'axe', 'B')).toBe(5); // 2 bought + 4 in − 1 out
  expect(heldAt(bought, moves, 'axe', 'C')).toBe(1);
  expect(heldAt(bought, moves, 'bowl', 'A')).toBe(0);
  expect(holdings(bought, moves).reduce((s, h) => s + h.now, 0)).toBe(12); // moves never make or lose any
});
