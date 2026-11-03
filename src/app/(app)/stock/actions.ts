'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

/** Stock arrives on the Stock page; assets on the Assets page. Both are kept in stock_in, by the material's kind. */
type Page = '/stock' | '/assets';
const back = (page: Page, error?: string): never => redirect(`${page}?tab=arrived${error ? `&error=${error}` : ''}`);

/** What arrived at a site: the supervisor's own sites only (the database checks). The rate is optional. */
export async function addArrival(page: Page, data: FormData): Promise<void> {
  await requireProfile();
  const v = (name: string) => String(data.get(name) ?? '').trim();
  const [site, material, date, rateText] = [v('site_id'), v('material_id'), v('in_date'), v('rate')];
  if (!site || !material) back(page, 'pick_all');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back(page, 'invalid_date');
  let milli = 0;
  try {
    milli = quantityToMilli(v('quantity'));
  } catch {
    back(page, 'bad_quantity');
  }
  let rate: number | null = null;
  if (rateText) {
    try {
      rate = rupeesToPaise(rateText);
    } catch {
      back(page, 'bad_rate');
    }
    if (rate! <= 0) back(page, 'bad_rate');
  }
  const { error } = await (await createClient()).from('stock_in').insert({
    site_id: site, material_id: material, in_date: date, quantity: milli / 1000, rate_paise: rate, note: v('note'),
  });
  if (error) back(page, 'not_saved');
  revalidatePath('/', 'layout');
  back(page);
}

/** Takes a line typed wrong off: the office any time, a supervisor their own line on the day it was typed. */
export async function removeArrival(page: Page, id: string): Promise<void> {
  await requireProfile();
  const { data, error } = await (await createClient()).from('stock_in').delete().eq('id', id).select('id');
  if (error || !data?.length) back(page, 'not_removed');
  revalidatePath('/', 'layout');
  back(page);
}
