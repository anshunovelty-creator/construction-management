import type { Paise } from '@/lib/money';

/** A row of the party_totals view: one firm and vendor. */
export interface PartyTotalRow {
  firm_id: string;
  party_id: string;
  opening_paise: number | string;
  bills_paise: number | string;
  paid_paise: number | string;
  last_payment: string | null;
}

export type PartyStatus = 'cleared' | 'partPaid' | 'pending';

export interface PartyFigures {
  opening: Paise;
  bills: Paise;
  total: Paise;
  paid: Paise;
  balance: Paise;
  /** Whole percent of the total that is paid, 0 when nothing is owed. */
  percentPaid: number;
  status: PartyStatus;
  lastPayment: string | null;
}

/** The columns of the outstanding workbook's Index sheet, with its Status rule. */
export function partyFigures(row: Pick<PartyTotalRow, 'opening_paise' | 'bills_paise' | 'paid_paise' | 'last_payment'>): PartyFigures {
  const opening = Number(row.opening_paise);
  const bills = Number(row.bills_paise);
  const paid = Number(row.paid_paise);
  const total = opening + bills;
  const balance = total - paid;
  return {
    opening, bills, total, paid, balance,
    percentPaid: total <= 0 ? 0 : Math.floor((paid * 100) / total),
    status: balance <= 0 ? 'cleared' : paid > 0 ? 'partPaid' : 'pending',
    lastPayment: row.last_payment,
  };
}

/** Adds up several parties' figures for a grand total line. */
export function sumFigures(all: PartyFigures[]): Omit<PartyFigures, 'status' | 'lastPayment'> {
  const add = (key: 'opening' | 'bills' | 'total' | 'paid' | 'balance') => all.reduce((s, f) => s + f[key], 0);
  const total = add('total');
  const paid = add('paid');
  return {
    opening: add('opening'), bills: add('bills'), total, paid, balance: add('balance'),
    percentPaid: total <= 0 ? 0 : Math.floor((paid * 100) / total),
  };
}
