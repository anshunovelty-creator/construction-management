'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import type { BetweenKind } from '@/components/firm-popup';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { firmSupply, firmTransfer, openingFirms, paidForFirm } from '@/lib/ledger/posting/firms';
import type { EntryDraft, MoneyAccountRef } from '@/lib/ledger/types';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { loadFirms } from './data';

type Db = Awaited<ReturnType<typeof createClient>>;
type Saved = { id: string; serial: string };
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An account that must belong to `firmId`. */
async function accountOf(db: Db, id: string | undefined, firmId: string): Promise<MoneyAccountRef | null> {
  if (!id || !UUID.test(id)) return null;
  const { data } = await db.from('money_accounts').select('id, kind, firm_id').eq('id', id).eq('firm_id', firmId).maybeSingle();
  return data && { id: data.id, kind: data.kind, firmId: data.firm_id };
}

/** One movement between two of our firms, saved as one entry in both books. The database checks access, cash and dates again. */
export async function postBetween(firmId: string, counterId: string, entryId: string, kind: BetweenKind, cells: Record<string, string>): Promise<Saved | FormState> {
  await requireProfile('owner', 'office');
  const refuse = (key: string): FormState => ({ errors: { _form: key } });
  const working = await getWorkingFirm();
  const mine = new Set(working?.firms.map((f) => f.id));
  if (!mine.has(firmId) || !mine.has(counterId) || firmId === counterId || !UUID.test(entryId)) return refuse('not_allowed');
  const date = cells.date ?? '';
  if (!DATE.test(date)) return refuse('required');
  if (date > todayInIndia()) return refuse('future_date');
  let amountPaise = 0;
  try { amountPaise = rupeesToPaise(cells.amount ?? ''); } catch { /* refused next */ }
  if (!(amountPaise > 0)) return refuse('required');
  const db = await createClient();
  const note = { reference: cells.reference ?? '', narration: cells.narration ?? '' };
  let draft: EntryDraft;
  try {
    if (kind === 'rent') {
      const firms = await loadFirms(db);
      const supplier = firms.find((f) => f.runs_labour && (f.id === firmId || f.id === counterId));
      if (!supplier || !cells.site) return refuse('not_allowed');
      const bp = (name: string) => (/^\d{1,5}$/.test(cells[name] ?? '') ? Number(cells[name]) : 0);
      draft = firmSupply({
        id: entryId, kind: 'machine_rent', supplierId: supplier.id, takerId: supplier.id === firmId ? counterId : firmId, siteId: cells.site,
        amountPaise, gstBp: bp('gst'), tdsBp: bp('tds'), date, reference: note.reference,
        narration: [cells.machine, note.narration].filter(Boolean).join(' · '),
      });
    } else {
      const [payerId, otherId] = kind === 'gave' || kind === 'wePaid' ? [firmId, counterId] : [counterId, firmId];
      const from = await accountOf(db, cells.from, payerId);
      if (!from) return refuse('required');
      if (kind === 'gave' || kind === 'took') {
        const to = await accountOf(db, cells.to, otherId);
        if (!to) return refuse('required');
        draft = firmTransfer({ id: entryId, from, to, amountPaise, date, ...note });
      } else {
        if (!cells.party) return refuse('required');
        draft = paidForFirm({ id: entryId, from, billFirmId: otherId, vendorId: cells.party, amountPaise, date, ...note });
      }
    }
  } catch (error) {
    return { errors: { _form: 'save_failed' }, detail: (error as Error).message };
  }
  const { data, error } = await db.rpc('app_post_entry', { p_entry: draft });
  if (error) return { errors: { _form: 'save_failed' }, detail: error.message };
  revalidatePath('/', 'layout');
  return data as Saved;
}

const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const openingOf = async (db: Db, firmId: string, counterId: string) =>
  (await db.from('firm_rows').select('entry_id').eq('firm_id', firmId).eq('counter_firm_id', counterId).eq('entry_type', 'opening').maybeSingle()).data?.entry_id as string | undefined;

/** What the two firms owed each other when the app started, typed once for both. Changed by cancel and replace, with a reason; 0 takes it off. */
export async function saveFirmOpening(firmId: string, counterId: string, data: FormData): Promise<void> {
  await requireProfile('owner');
  const fail = (error: string): never => redirect(`/between/${counterId}/opening?error=${encodeURIComponent(error)}`);
  const date = text(data, 'date');
  if (!DATE.test(date) || date > todayInIndia()) fail('date');
  let amount = -1;
  try { amount = rupeesToPaise(text(data, 'amount') || '0'); } catch { /* checked next */ }
  if (!(amount >= 0)) fail('amount');
  const side = text(data, 'side');
  if (side !== 'them' && side !== 'us') fail('side');
  const db = await createClient();
  const old = await openingOf(db, firmId, counterId);
  const reason = text(data, 'reason');
  if (old && !reason) fail('reason');
  if (amount === 0 && !old) redirect(`/between/${counterId}`);
  const draft = amount === 0 ? null : openingFirms({ firmId, counterFirmId: counterId, amountPaise: side === 'them' ? amount : -amount, asOf: date });
  const { error } = draft === null
    ? await db.rpc('app_reverse_entry', { p_entry_id: old, p_reason: reason })
    : old
      ? await db.rpc('app_replace_entry', { p_old_id: old, p_new: draft, p_reason: reason })
      : await db.rpc('app_post_entry', { p_entry: draft });
  if (error) fail(error.message);
  revalidatePath('/', 'layout');
  redirect(`/between/${counterId}?month=${date.slice(0, 7)}`);
}
