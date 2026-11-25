'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { openingClientBalance, openingVendorBalance } from '@/lib/ledger/posting/opening';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { loadOpenings } from './data';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

/**
 * Sets a party's or client's opening balance in one firm. One already there is cancelled and replaced, with a reason; an
 * amount of 0 takes it off. `entryId` is made with the page, so pressing Save twice saves it once.
 */
export async function saveOpening(firmId: string, partyId: string, entryId: string, data: FormData): Promise<void> {
  await requireProfile('owner');
  const fail = (error: string): never => redirect(`/party/opening?id=${partyId}&error=${encodeURIComponent(error)}`);
  const working = await getWorkingFirm();
  if (!UUID.test(entryId) || !working?.firms.some((f) => f.id === firmId)) fail('not_saved');
  let amount = -1;
  try { amount = rupeesToPaise(text(data, 'amount') || '0'); } catch { /* checked below */ }
  if (!(amount >= 0)) fail('amount');
  const date = text(data, 'date');
  if (amount > 0 && (!DATE.test(date) || date > todayInIndia())) fail('date');

  const db = await createClient();
  const { data: party } = await db.from('parties').select('id, kind').eq('id', partyId).in('kind', ['vendor', 'client', 'other']).maybeSingle();
  if (!party) return fail('not_saved');
  const client = party.kind === 'client';
  const openings = await loadOpenings(db, firmId, partyId, client);
  if (openings.length > 1) fail('many');
  const old = openings[0];
  const back = `/${client ? 'client' : 'party'}?id=${partyId}`;
  // Save pressed twice: it is already there.
  if (old?.entry_id === entryId) redirect(back);
  const reason = text(data, 'reason');
  if (old && !reason) fail('reason');
  if (amount === 0 && !old) redirect(back);

  // Above zero is still to pay (a party) or to come (a client); extra paid or received is below zero.
  const amountPaise = text(data, 'side') === 'extra' ? -amount : amount;
  const { error } = amount === 0 ? await db.rpc('app_reverse_entry', { p_entry_id: old!.entry_id, p_reason: reason })
    : await (async () => {
      const draft = client ? openingClientBalance({ client: { firmId, clientId: partyId }, amountPaise, asOf: date })
        : openingVendorBalance({ firmId, vendorId: partyId, amountPaise, asOf: date });
      draft.id = entryId;
      return old ? db.rpc('app_replace_entry', { p_old_id: old.entry_id, p_new: draft, p_reason: reason }) : db.rpc('app_post_entry', { p_entry: draft });
    })();
  if (error) fail(error.message);
  revalidatePath('/', 'layout');
  redirect(back);
}
