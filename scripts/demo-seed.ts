// Fills a database with demo data for building and testing: every master field, several logins per
// role, and ~25 entries covering every entry type and status (waiting, checked, rejected, cancelled,
// replaced). The first 12 entries follow the Ledger Playground's story, so its numbers can be compared.
//
//   npm run demo:seed         -> local Docker database (.env.docker.local)
//   npm run demo:seed:cloud   -> the Supabase project in .env.local (test phase only; wipe before go-live)
//
// Demo logins are written to data/private/demo-logins.txt (git-ignored). Runs once per database.
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { cashCloseDifference, cashTransfer, ownerCapital, ownerDrawing, siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { openingClientBalance, openingMoneyBalance, openingVendorBalance } from '@/lib/ledger/posting/opening';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import type { ClientRef, EntryDraft, MoneyAccountRef } from '@/lib/ledger/types';
import { percentOf } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const local = /^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(url);
if (!url || (!local && !process.argv.includes('--yes-cloud'))) {
  console.error(`Refusing to seed ${url || '(no URL)'}: use npm run demo:seed:cloud to seed the cloud project on purpose.`);
  process.exit(1);
}

const db = createAdminClient();
const { data: seeded } = await db.from('firms').select('id').eq('code', 'FA').maybeSingle();
if (seeded) {
  console.error('Demo data is already here (firm FA exists). Wipe the database first to seed again.');
  process.exit(1);
}

const one = async <T = { id: string }>(table: string, row: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T;
};
const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
};
const rupees = (r: number) => Math.round(r * 100);

// ---------- Masters: every field filled, some records switched off ----------
const firmA = (await one('firms', { code: 'FA', name: 'Firm A' })).id;
const firmB = (await one('firms', { code: 'FB', name: 'Firm B' })).id;
const site1 = (await one('sites', { name: 'Site 1', location: 'Sector 12, Pune' })).id;
const site2 = (await one('sites', { name: 'Site 2', location: 'MIDC, Nashik' })).id;
await one('sites', { name: 'Site 3 (finished)', location: 'Old highway job', is_active: false });

const party = async (kind: string, name: string, phone: string, is_active = true) =>
  (await one('parties', { kind, name, phone, is_active })).id;
const vendor1 = await party('vendor', 'Vendor 1 (cement)', '98200 11111');
const vendor2 = await party('vendor', 'Vendor 2 (bricks)', '98200 22222');
const vendor3 = await party('vendor', 'Vendor 3 (JCB hire)', '98200 33333');
const vendor4 = await party('vendor', 'Vendor 4 (transport)', '98200 44444');
await party('vendor', 'Vendor 5 (no longer used)', '98200 55555', false);
const client1 = await party('client', 'Client 1', '022 4000 1000');
const client2 = await party('client', 'Client 2', '0253 400 2000');
await party('worker', 'Worker 1', '97000 10001');
await party('staff', 'Staff 1 (site engineer)', '97000 20002');
const colony = await party('other', 'Labour colony landlord', '97000 30003');

// Clients are billed by site directly (no work orders).
const C1: ClientRef = { firmId: firmA, clientId: client1, siteId: site1 };
const C2: ClientRef = { firmId: firmB, clientId: client2, siteId: site2 };

// ---------- Logins ----------
const logins: string[] = [];
async function login(
  email: string,
  fullName: string,
  role: string,
  opts: { firms?: string[]; sites?: string[]; active?: boolean } = {},
) {
  const password = randomBytes(9).toString('base64url');
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`login ${email}: ${error?.message}`);
  await one('profiles', {
    user_id: data.user.id, email, full_name: fullName, role, is_active: opts.active ?? true,
  });
  for (const firm_id of opts.firms ?? []) await one('user_firms', { user_id: data.user.id, firm_id });
  for (const site_id of opts.sites ?? []) await one('user_sites', { user_id: data.user.id, site_id });
  logins.push(`${role.padEnd(10)} ${email.padEnd(26)} ${password}${opts.active === false ? '   (switched off)' : ''}`);
  return data.user.id;
}
// The cloud project already has the real owner; entries "by the owner" use that account.
const { data: realOwner } = await db.from('profiles').select('user_id').eq('role', 'owner').limit(1).maybeSingle();
const owner: string = realOwner?.user_id ?? (await login('owner@demo.test', 'Owner', 'owner'));
const office1 = await login('office1@demo.test', 'Office 1', 'office', { firms: [firmA, firmB] });
const office2 = await login('office2@demo.test', 'Office 2 (Firm B only)', 'office', { firms: [firmB] });
const sup1 = await login('supervisor1@demo.test', 'Supervisor 1', 'supervisor', { sites: [site1] });
const sup2 = await login('supervisor2@demo.test', 'Supervisor 2', 'supervisor', { sites: [site2] });
await login('oldstaff@demo.test', 'Old staff (left)', 'office', { firms: [firmA], active: false });

const account = async (kind: MoneyAccountRef['kind'], name: string, firmId: string | null, holder?: string, is_active = true) => {
  const row = await one('money_accounts', { kind, name, firm_id: firmId, holder_user_id: holder ?? null, is_active });
  return { id: row.id, kind, firmId } as MoneyAccountRef;
};
const bankA = await account('bank', 'Firm A bank', firmA);
await account('bank', 'Firm A UPI', firmA);
const bankB = await account('bank', 'Firm B bank', firmB);
await account('bank', 'Firm B old bank (closed)', firmB, undefined, false);
const ownerCash = await account('owner_cash', 'Owner cash', null);
const cash1 = await account('supervisor_cash', 'Supervisor 1 cash', null, sup1);
const cash2 = await account('supervisor_cash', 'Supervisor 2 cash', null, sup2);

// ---------- Entries ----------
const post = async (actor: string, draft: EntryDraft) =>
  (await rpc<{ id: string }>('post_entry', { p_entry: draft, p_actor: actor, p_override_reason: null })).id;
const verify = (id: string, actor: string) => rpc('verify_entry', { p_entry_id: id, p_actor: actor });

// Starting balances carried over from "old records".
const asOf = '2026-10-01';
const opening = [
  await post(owner, openingMoneyBalance({ account: ownerCash, amountPaise: rupees(30_000), asOf })),
  await post(owner, openingVendorBalance({ firmId: firmA, vendorId: vendor3, amountPaise: rupees(2_50_000), asOf, reference: 'Statement 30-Sep' })),
  await post(owner, openingVendorBalance({ firmId: firmB, vendorId: vendor4, amountPaise: rupees(-20_000), asOf, reference: 'Advance paid in Sept' })),
  await post(owner, openingClientBalance({ client: C2, amountPaise: rupees(1_00_000), asOf })),
];

// The Playground's twelve steps (step 2, the work order, is a master above).
const s1a = await post(owner, ownerCapital({ account: bankA, amountPaise: rupees(10_00_000), date: '2026-10-01', narration: 'Starting money for Firm A' }));
const s1b = await post(owner, ownerCapital({ account: bankB, amountPaise: rupees(5_00_000), date: '2026-10-01', narration: 'Starting money for Firm B' }));
const s3 = await post(office1, vendorBill({
  firmId: firmA, vendorId: vendor1, siteId: site1, billDate: '2026-10-03', billNo: 'V1-101',
  items: [{ costHead: 'material', amountPaise: rupees(1_00_000) }], narration: '250 bags cement',
}));
const s4 = await post(office1, vendorBill({
  firmId: firmB, vendorId: vendor2, siteId: site1, billDate: '2026-10-03', billNo: 'V2-55',
  items: [{ costHead: 'material', amountPaise: rupees(50_000) }], narration: '6,000 bricks',
}));
const s5 = await post(office1, vendorPayment({
  billFirmId: firmA, vendorId: vendor1, from: bankA, amountPaise: rupees(60_000), paymentDate: '2026-10-05', reference: 'UTR4471001',
}));
const s6 = await post(office1, vendorPayment({
  billFirmId: firmB, vendorId: vendor2, from: bankA, amountPaise: rupees(50_000), paymentDate: '2026-10-05',
  reference: 'UTR4471002', narration: 'Firm A pays Firm B’s brick bill',
}));
const s7 = await post(owner, cashTransfer({
  from: bankA, to: cash1, amountPaise: rupees(20_000), transferDate: '2026-10-06', reference: 'CHQ-201', narration: 'Cash for Site 1 this week',
}));
const s8 = await post(sup1, siteCashExpense({
  from: cash1, siteId: site1, costHead: 'labour', amountPaise: rupees(15_000), expenseDate: '2026-10-07', narration: '12 workers, weekly wages',
}));
const s9 = await post(sup1, cashCloseDifference({ account: cash1, expectedPaise: rupees(5_000), countedPaise: rupees(4_800), closeDate: '2026-10-07' }));
const s10 = await post(office1, clientBill({
  client: C1, billDate: '2026-10-15', billNo: 'RA-1', grossPaise: rupees(3_00_000), narration: 'Work done till 15 Oct',
  deductions: { tdsPaise: percentOf(rupees(3_00_000), 200), retentionPaise: percentOf(rupees(3_00_000), 500) },
}));
const s11 = await post(office1, clientReceipt({
  client: C1, to: bankA, amountPaise: rupees(2_79_000), receiptDate: '2026-10-20', reference: 'NEFT-88812',
}));
await post(office1, cashTransfer({
  from: bankB, to: bankA, amountPaise: rupees(50_000), transferDate: '2026-10-21', reference: 'UTR9900', narration: 'Firm B pays Firm A back',
}));

// More of everything: a two-item bill, a cash payment, a second site and supervisor, cash excess,
// a bill with security deposit, a part payment, the owner taking money out.
const e13 = await post(office1, vendorBill({
  firmId: firmA, vendorId: vendor3, siteId: site2, billDate: '2026-10-08', billNo: 'V3-9', narration: 'JCB 20 hours + carting',
  items: [{ costHead: 'machine_hire', amountPaise: rupees(40_000) }, { costHead: 'transport', amountPaise: rupees(5_000) }],
}));
await post(owner, vendorPayment({
  billFirmId: firmA, vendorId: vendor3, from: ownerCash, amountPaise: rupees(30_000), paymentDate: '2026-10-09', narration: 'Paid in cash at site',
}));
const e15 = await post(office2, cashTransfer({
  from: bankB, to: cash2, amountPaise: rupees(10_000), transferDate: '2026-10-10', reference: 'CHQ-77', narration: 'Cash for Site 2',
}));
await post(sup2, siteCashExpense({
  from: cash2, siteId: site2, costHead: 'site_overhead', amountPaise: rupees(1_600), expenseDate: '2026-10-11',
  paidToPartyId: colony, narration: 'Labour colony rent, 1 day',
}));
await post(sup2, siteCashExpense({
  from: cash2, siteId: site2, costHead: 'transport', amountPaise: rupees(850), expenseDate: '2026-10-11', narration: 'Diesel for tractor',
}));
await post(sup2, cashCloseDifference({ account: cash2, expectedPaise: rupees(7_550), countedPaise: rupees(7_700), closeDate: '2026-10-11' }));
const e19 = await post(office2, clientBill({
  client: C2, billDate: '2026-10-16', billNo: 'B-RA-1', grossPaise: rupees(2_00_000), narration: 'Stage 1: foundation',
  deductions: {
    tdsPaise: percentOf(rupees(2_00_000), 100),
    retentionPaise: percentOf(rupees(2_00_000), 500),
    securityDepositPaise: percentOf(rupees(2_00_000), 250),
  },
}));
await post(office2, clientReceipt({
  client: C2, to: bankB, amountPaise: rupees(1_50_000), receiptDate: '2026-10-22', reference: 'RTGS-5521', narration: 'Part payment',
}));
const e21 = await post(owner, cashTransfer({ from: bankA, to: ownerCash, amountPaise: rupees(50_000), transferDate: '2026-10-12', reference: 'CASH-WD-1' }));
const e22 = await post(owner, ownerDrawing({ account: ownerCash, amountPaise: rupees(25_000), date: '2026-10-13', narration: 'Personal use' }));

// Mistakes, handled the three ways the books allow: rejected, replaced, cancelled.
const typo = await post(sup1, siteCashExpense({
  from: cash1, siteId: site1, costHead: 'other', amountPaise: rupees(999), expenseDate: '2026-10-08', narration: 'Typing mistake',
}));
await rpc('reject_entry', { p_entry_id: typo, p_actor: office1, p_reason: 'Wrong amount, nothing was spent' });
const sand = (amount: number, narration: string) =>
  vendorBill({
    firmId: firmA, vendorId: vendor1, siteId: site1, billDate: '2026-10-14', billNo: 'V1-102',
    items: [{ costHead: 'material', amountPaise: rupees(amount) }], narration,
  });
const wrongBill = await post(office1, sand(12_000, 'Sand'));
await rpc('replace_entry', { p_old_id: wrongBill, p_new: sand(21_000, 'Sand (corrected)'), p_actor: owner, p_reason: 'Bill is ₹21,000, not ₹12,000' });
const duplicate = await post(office2, vendorBill({
  firmId: firmB, vendorId: vendor2, siteId: site2, billDate: '2026-10-17', billNo: 'V2-60',
  items: [{ costHead: 'material', amountPaise: rupees(8_000) }], narration: 'Entered twice by mistake',
}));
await rpc('reverse_entry', { p_entry_id: duplicate, p_actor: office2, p_reason: 'Duplicate of an earlier entry' });

// Checking is done by someone other than the person who typed the entry. The rest stay waiting.
for (const id of [...opening, s1a, s1b, s7, s8, s9, e21, e22]) await verify(id, office1);
for (const id of [s3, s4, s5, s6, s10, s11, e13, e15, e19]) await verify(id, owner);

mkdirSync('data/private', { recursive: true });
appendFileSync('data/private/demo-logins.txt', `\nDemo logins for ${url} (seeded ${new Date().toISOString()})\n${logins.join('\n')}\n`);
const { count } = await db.from('entries').select('id', { count: 'exact', head: true });
console.log(`Demo data ready: ${count} entries. Logins added to data/private/demo-logins.txt`);
