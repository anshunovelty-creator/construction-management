'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Things taken on rent for a site: what, how many, rent per item per day, from which day; who from and the bill, if known. */
export async function addRental(_state: FormState, data: FormData): Promise<FormState> {
  await requireProfile('owner', 'office', 'supervisor');
  const v = Object.fromEntries([...data.entries()].map(([k, x]) => [k, String(x).trim()]));
  const errors: Record<string, string> = {};
  if (!v.site_id) errors.site_id = 'required';
  if (!v.rent_item) errors.rent_item = 'required';
  let milli = 0;
  try {
    milli = quantityToMilli(v.rent_qty ?? '');
  } catch {
    errors.rent_qty = 'invalid_amount';
  }
  let rate = 0;
  try {
    rate = rupeesToPaise(v.rent_rate ?? '');
  } catch { /* checked below */ }
  if (rate <= 0) errors.rent_rate = 'invalid_amount';
  if (!DATE.test(v.rented_on ?? '')) errors.rented_on = 'invalid_date';
  if (Object.keys(errors).length) return { errors, values: v };

  const { error } = await (await createClient()).from('rentals').insert({
    site_id: v.site_id, vendor_id: v.rented_from || null, item: v.rent_item, quantity: milli / 1000,
    rate_paise: rate, rented_on: v.rented_on, bill_no: v.bill_no || null,
  });
  if (error) return { errors: { _form: 'save_failed' }, detail: error.message, values: v };
  revalidatePath('/rentals');
  return { saved: v.rent_item };
}

/** Stops the meter with the day they went back (or clears it, to fix a mistake) and keeps the bill number. */
export async function updateRental(id: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office', 'supervisor');
  const returnedOn = String(data.get('returned_on') ?? '').trim();
  const billNo = String(data.get('bill_no') ?? '').trim();
  if (returnedOn && !DATE.test(returnedOn)) redirect('/rentals?error=invalid_date');
  const { data: rows, error } = await (await createClient()).from('rentals')
    .update({ returned_on: returnedOn || null, bill_no: billNo || null }).eq('id', id).select('id');
  if (error || !rows?.length) redirect(`/rentals?error=${encodeURIComponent(error?.message ?? 'not_saved')}`);
  revalidatePath('/rentals');
}

/** Takes off a line typed wrong; the database allows it for the office, or whoever added it on the same day. */
export async function removeRental(id: string): Promise<void> {
  await requireProfile('owner', 'office', 'supervisor');
  const { data, error } = await (await createClient()).from('rentals').delete().eq('id', id).select('id');
  if (error || !data?.length) redirect('/rentals?error=not_removed');
  revalidatePath('/rentals');
}
