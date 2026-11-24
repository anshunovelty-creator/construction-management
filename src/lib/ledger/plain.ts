import type { CostHead, LedgerAccount } from './types';

/** One ledger line, or one row of the `balances` view, as the database returns it. */
export interface LineRow {
  account: LedgerAccount;
  amount_paise: number;
  firm_id: string | null;
  counter_firm_id: string | null;
  money_account_id: string | null;
  party_id: string | null;
  site_id: string | null;
  cost_head: CostHead | null;
}

export interface Names {
  firms: Map<string, string>;
  parties: Map<string, string>;
  sites: Map<string, string>;
  accounts: Map<string, string>;
}

/** Where a balance sits on the home board. */
export type Group = 'money' | 'weOwe' | 'owedToUs' | 'betweenFirms' | 'heldByClients' | 'assets' | 'gst' | 'tds' | 'sites' | 'owner' | 'unknown' | 'firm';

export type Translate = (key: string, values?: Record<string, string>) => string;

export interface Plain {
  key: string;
  group: Group;
  label: string;
  /** The number people expect to see: what we owe is stored as a minus but shown as a plus. */
  shown: number;
}

/**
 * Between two firms, both sides of a due are stored (a + for one firm, a − for the other).
 * Only the side of the firm with the smaller id is counted, so the pair is one number.
 */
const isCountedSide = (r: LineRow) => r.account !== 'inter_firm' || r.firm_id! < r.counter_firm_id!;

function keyOf(r: LineRow): string {
  switch (r.account) {
    case 'money': return `money:${r.money_account_id}`;
    case 'vendor_payable': return `owe:${r.firm_id}:${r.party_id}`;
    case 'client_receivable': return `owed:${r.firm_id}:${r.party_id}`;
    case 'tds_claimable': return `tds:${r.party_id ?? r.counter_firm_id}`;
    case 'retention_held': return `retention:${r.party_id}`;
    case 'security_deposit_held': return `deposit:${r.party_id}`;
    case 'inter_firm': return `firms:${r.firm_id}:${r.counter_firm_id}`;
    case 'site_cost': return `cost:${r.site_id}:${r.cost_head}`;
    case 'company_assets': return `assets:${r.firm_id}`;
    case 'contract_income': return `billed:${r.site_id}`;
    case 'wages_paid': case 'loan': case 'deposit_given': case 'gst_paid': case 'tds_paid': case 'pf_paid': case 'tds_claimed':
      return `${r.account}:${r.firm_id}`;
    case 'firm_cost': case 'other_income': return `${r.account}:${r.firm_id}:${r.cost_head}`;
    case 'firm_income': return `firmIncome:${r.firm_id}:${r.counter_firm_id}`;
    case 'owner_capital': return 'capital';
    case 'opening_balance': return 'opening';
    case 'cash_short_excess': return 'short';
    case 'round_off': return `round:${r.firm_id}`;
    case 'not_yet_known': return `unknown:${r.firm_id}`;
    case 'gst_input': return `gstIn:${r.firm_id}`;
    case 'gst_output': return `gstOut:${r.firm_id}`;
    case 'tds_payable': return `tdsPay:${r.firm_id}`;
  }
}

/** Who kept TDS: a client, or another of our firms. */
const tdsKeeper = (row: LineRow, names: Names, party: string) => (row.counter_firm_id ? names.firms.get(row.counter_firm_id) ?? '?' : party);

/** Adds rows up by the key people think in (e.g. one number per firm and vendor). */
export function sumByKey(rows: LineRow[]): Map<string, { row: LineRow; amount: number }> {
  const sums = new Map<string, { row: LineRow; amount: number }>();
  for (const row of rows.filter(isCountedSide)) {
    const key = keyOf(row);
    sums.set(key, { row, amount: (sums.get(key)?.amount ?? 0) + Number(row.amount_paise) });
  }
  return sums;
}

/**
 * A balance (or a change to one) in plain words. `amount` is the raw ledger sum for `row`'s key.
 * For a due between firms, `pairBalance` decides who is named as owing: pass the pair's current
 * balance so a repayment reads "B owes A: down" rather than "A owes B: up".
 */
export function describe(row: LineRow, amount: number, names: Names, t: Translate, pairBalance = amount): Plain {
  const firm = names.firms.get(row.firm_id ?? '') ?? '?';
  const party = names.parties.get(row.party_id ?? '') ?? '?';
  const site = names.sites.get(row.site_id ?? '') ?? '?';
  // `+ 0` turns −0 into 0.
  const make = (group: Group, label: string, sign: 1 | -1): Plain => ({ key: keyOf(row), group, label, shown: amount * sign + 0 });

  switch (row.account) {
    case 'money':
      return make('money', names.accounts.get(row.money_account_id ?? '') ?? '?', 1);
    case 'vendor_payable':
      return make('weOwe', t('plain.vendorPayable', { firm, vendor: party }), -1);
    case 'client_receivable':
      return make('owedToUs', t('plain.clientReceivable', { firm, client: party }), 1);
    case 'tds_claimable':
      return make('heldByClients', t('plain.tds', { client: tdsKeeper(row, names, party) }), 1);
    case 'retention_held':
      return make('heldByClients', t('plain.retention', { client: party }), 1);
    case 'security_deposit_held':
      return make('heldByClients', t('plain.securityDeposit', { client: party }), 1);
    case 'inter_firm': {
      const other = names.firms.get(row.counter_firm_id ?? '') ?? '?';
      // A plus on this firm's side means the other firm owes it.
      return pairBalance >= 0
        ? make('betweenFirms', t('plain.interFirm', { debtor: other, creditor: firm }), 1)
        : make('betweenFirms', t('plain.interFirm', { debtor: firm, creditor: other }), -1);
    }
    case 'site_cost':
      return make('sites', t('plain.siteCost', { site, head: t(`options.cost_head.${row.cost_head}`) }), 1);
    case 'contract_income':
      return make('sites', t('plain.billed', { site }), -1);
    case 'wages_paid':
      return make('firm', t('plain.wagesPaid', { firm }), 1);
    case 'firm_cost':
      return make('firm', t('plain.firmCost', { firm, head: t(`options.cost_head.${row.cost_head}`) }), 1);
    case 'other_income':
      return make('firm', t(row.cost_head === 'machine_hire' ? 'plain.machineRent' : 'plain.otherIncome', { firm }), -1);
    case 'pf_paid':
      return make('firm', t('plain.pfPaid', { firm }), 1);
    case 'loan':
      return make('weOwe', t('plain.loan', { firm }), -1);
    case 'deposit_given':
      return make('owedToUs', t('plain.depositGiven', { firm }), 1);
    case 'gst_paid':
      return make('gst', t('plain.gstPaid', { firm }), 1);
    case 'tds_paid':
      return make('tds', t('plain.tdsPaid', { firm }), -1);
    case 'tds_claimed':
      return make('heldByClients', t('plain.tdsClaimed', { firm }), 1);
    // Not on the board: the sites table shows what clients are billed, and the other firm's cost is in its own sites.
    case 'firm_income':
      return make('sites', t('plain.firmIncome', { firm, other: names.firms.get(row.counter_firm_id ?? '') ?? '?' }), -1);
    // Tools and the like bought to reuse: the company's, kept apart from every site's cost.
    case 'company_assets':
      return make('assets', t('plain.companyAssets', { firm }), 1);
    case 'owner_capital':
      return make('owner', t('plain.capital'), -1);
    case 'opening_balance':
      return make('owner', t('plain.opening'), -1);
    case 'cash_short_excess':
      return make('owner', t('plain.short'), 1);
    case 'round_off':
      return make('firm', t('plain.roundOff', { firm }), 1);
    // Came in and not explained is a minus here, so it is shown the other way: plus came in, minus went out.
    case 'not_yet_known':
      return make('unknown', t('plain.notYetKnown', { firm }), -1);
    // GST paid on vendor bills is claimed back; GST charged on client bills is owed to the government.
    case 'gst_input':
      return make('gst', t('plain.gstInput', { firm }), 1);
    case 'gst_output':
      return make('gst', t('plain.gstOutput', { firm }), -1);
    // TDS deducted from a vendor's bill is owed to the government until it is paid in.
    case 'tds_payable':
      return make('tds', t('plain.tdsPayable', { firm }), -1);
  }
}

/**
 * One stored line on its own (the entry's plus/minus table). A between-firm due is stored in both
 * firms' books, so each side says whose books it is in rather than repeating "B owes A" twice.
 */
export function lineLabel(row: LineRow, names: Names, t: Translate): string {
  if (row.account !== 'inter_firm') return describe(row, Number(row.amount_paise), names, t).label;
  const firm = names.firms.get(row.firm_id ?? '') ?? '?';
  const other = names.firms.get(row.counter_firm_id ?? '') ?? '?';
  return t(Number(row.amount_paise) > 0 ? 'plain.interFirmReceive' : 'plain.interFirmPay', { firm, other });
}

/**
 * A balance that has gone the other way gets its own words: paying a vendor before the bill is an
 * advance we are owed back, money from a client before a bill is an advance we owe in work.
 */
function asBalance(p: Plain, row: LineRow, names: Names, t: Translate): Plain {
  if (p.shown >= 0) return p;
  const firm = names.firms.get(row.firm_id ?? '') ?? '?';
  const party = names.parties.get(row.party_id ?? '') ?? '?';
  switch (row.account) {
    case 'vendor_payable':
      return { ...p, group: 'owedToUs', label: t('plain.vendorAdvance', { firm, vendor: party }), shown: -p.shown };
    case 'client_receivable':
      return { ...p, group: 'weOwe', label: t('plain.clientAdvance', { firm, client: party }), shown: -p.shown };
    case 'cash_short_excess':
      return { ...p, label: t('plain.excess'), shown: -p.shown };
    default:
      return p;
  }
}

/** Every balance in plain words, biggest first. */
export function describeAll(rows: LineRow[], names: Names, t: Translate): Plain[] {
  return [...sumByKey(rows).values()]
    .filter(({ amount }) => amount !== 0)
    .map(({ row, amount }) => asBalance(describe(row, amount, names, t), row, names, t))
    .sort((a, b) => Math.abs(b.shown) - Math.abs(a.shown));
}

/**
 * What one entry changed, in plain words. `current` holds today's balances, used to name the owing
 * firm in a between-firm due: whoever owed before this entry (a repayment brings the due to zero,
 * which says nothing), or whoever owes after it when nothing was owed before.
 */
export function describeChanges(lines: LineRow[], current: LineRow[], names: Names, t: Translate): Plain[] {
  const now = sumByKey(current);
  return [...sumByKey(lines).entries()]
    .filter(([, { amount }]) => amount !== 0)
    .map(([key, { row, amount }]) => {
      // The balances view leaves out zero totals, so a missing key means nothing is owed now.
      const after = now.get(key)?.amount ?? 0;
      const before = after - amount;
      return describe(row, amount, names, t, before !== 0 ? before : after);
    });
}
