'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { otherMoney } from '@/lib/ledger/posting/other';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { payAccount } from './data';

/** GST, TDS or PF paid to the government by the working firm, for a month. `back` is the page it was typed on. */
export async function payTax(reason: 'gst_paid' | 'tds_paid' | 'pf_paid', back: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const page = /^\/(gst|tds|salary)(\/labour)?(\?[\w=&-]*)?$/.test(back) ? back : '/bankbook';
  const fail = (error: string): never => redirect(`${page}${page.includes('?') ? '&' : '?'}taxError=${encodeURIComponent(error)}`);
  const text = (name: string) => String(data.get(name) ?? '').trim();
  const db = await createClient();
  const [account, working] = await Promise.all([payAccount(db, text('account')), getWorkingFirm()]);
  if (!account || account.firmId !== working?.firm.id) return fail('Choose one of this firm’s accounts.');
  if (text('date') > todayInIndia()) fail('This date is in the future.');
  let draft;
  try {
    draft = otherMoney({ reason, account, amountPaise: rupeesToPaise(text('amount')), date: text('date'), month: text('month'), reference: text('reference') });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { error } = await db.rpc('app_post_entry', { p_entry: draft });
  if (error) fail(error.message);
  revalidatePath('/', 'layout');
  redirect(page);
}
