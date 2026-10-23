import type { Paise } from '@/lib/money';
import type { LineDraft } from './types';

/**
 * Money crossed between firms: `creditorFirmId`'s money was used for `debtorFirmId`,
 * so the debtor now owes the creditor. Returns no lines when no firm boundary is crossed
 * (same firm, or common cash on either side). Positive inter_firm balance = amount owed to that firm.
 */
export function interFirmLines(
  creditorFirmId: string | null,
  debtorFirmId: string | null,
  amountPaise: Paise,
): LineDraft[] {
  if (!creditorFirmId || !debtorFirmId || creditorFirmId === debtorFirmId) {
    return [];
  }
  return [
    { account: 'inter_firm', amountPaise, firmId: creditorFirmId, counterFirmId: debtorFirmId },
    { account: 'inter_firm', amountPaise: -amountPaise, firmId: debtorFirmId, counterFirmId: creditorFirmId },
  ];
}
