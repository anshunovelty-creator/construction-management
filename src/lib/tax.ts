import type { Paise } from '@/lib/money';

/** One firm's tax for a period: what it owes, what it can claim, and what it has paid (less what it got back). */
export interface FirmTax { owed: Paise; claim: Paise; paid: Paise }

/**
 * What a firm still has to pay, or the credit it has left over. Never both, and never added across firms: one firm's
 * credit cannot pay another's GST.
 */
export function gstLeft(f: FirmTax): { toPay: Paise; credit: Paise } {
  const net = f.owed - f.claim - f.paid;
  return { toPay: Math.max(net, 0), credit: Math.max(-net, 0) };
}

/** Tax still due on bills: of the months that are over and of this one, less what was paid. Credit from before comes off this month's; this month's credit does not reduce what was due before. */
export function taxDue(rows: { month: string; amount: Paise }[], paid: Paise, thisMonth: string): Paise {
  const before = rows.filter((r) => r.month < thisMonth).reduce((s, r) => s + r.amount, 0) - paid;
  const current = rows.filter((r) => r.month >= thisMonth).reduce((s, r) => s + r.amount, 0);
  return Math.max(before, 0) + Math.max(current + Math.min(before, 0), 0);
}
