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
