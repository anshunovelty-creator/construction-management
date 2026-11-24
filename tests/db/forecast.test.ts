import { expect, it } from 'vitest';
import { openingMoneyBalance } from '@/lib/ledger/posting/opening';
import { postEntry } from '@/lib/ledger/repo';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { asUser, createMigratedDb, createUser, OWNER, seedBasics } from './harness';

it('keeps plans and forecasts to the firm’s own people, and says what was held on a day', async () => {
  const db = await createMigratedDb();
  const seed = await seedBasics(db);
  const owner = await createUser(db, 'owner', 'Owner');
  const jayraj = await createUser(db, 'office', 'Priya', { firms: [seed.jayraj] });
  const ab = await createUser(db, 'office', 'Amit', { firms: [seed.ab] });
  const supervisor = await createUser(db, 'supervisor', 'Ramesh');
  const run = (user: string, sql: string, params: unknown[] = []) => asUser(db, user, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);
  const plan = `insert into planned_money (firm_id, name, direction, amount_paise, repeats, next_on) values ($1, 'Office rent', 'out', 100, 'month', '2026-12-01')`;
  await run(jayraj, plan, [seed.jayraj]);
  for (const user of [ab, supervisor]) {
    await expect(run(user, plan, [seed.jayraj])).rejects.toThrow('row-level security');
    expect(await run(user, 'select * from planned_money')).toEqual([]);
  }
  const keep = `insert into kept_forecasts (firm_id, made_on, weeks) values ($1, '2026-11-24', '[]')`;
  await run(owner, keep, [null]);
  await expect(run(jayraj, `insert into kept_forecasts (firm_id, made_on, weeks) values (null, '2026-11-25', '[]')`)).rejects.toThrow('row-level security');
  await expect(run(owner, keep, [null])).rejects.toThrow('kept_forecasts_once');
  await postEntry(db, openingMoneyBalance({ account: seed.jayrajBank, amountPaise: 500, asOf: '2026-11-01' }), OWNER);
  const wrong = await postEntry(db, openingMoneyBalance({ account: seed.abBank, amountPaise: 70, asOf: '2026-11-05' }), OWNER);
  await reverseEntry(db, wrong.id, OWNER, 'wrong');
  const at = (user: string, firm: string | null, date: string) => run(user, 'select money_at($1, $2)::int as n', [firm, date]).then((r) => r[0]!.n);
  expect(await at(owner, null, '2026-11-01')).toBe(500);
  expect(await at(owner, seed.jayraj, '2026-10-31')).toBe(0);
  expect(await at(owner, null, '2026-11-30')).toBe(500);
  expect(await at(ab, seed.jayraj, '2026-11-30')).toBe(0);
});
