import type { Paise } from '@/lib/money';

export type Doubt = 'more' | 'overdrawn';

/**
 * What looks wrong with an amount about to be saved, so the pop-ups ask once (a slip of a zero): it is more than what is
 * left, or it takes a bank below zero. An advance to someone with nothing left is not asked about, nor is a bank that is
 * already overdrawn: both are usual.
 */
export function amountDoubts({ paise, left, before, after }: { paise: Paise; left?: Paise; before?: Paise; after?: Paise }): Doubt[] {
  return [
    // A part of a rupee is rounded off on saving.
    ...(left !== undefined && left > 0 && paise - left >= 100 ? ['more' as const] : []),
    ...(before !== undefined && after !== undefined && before >= 0 && after < 0 ? ['overdrawn' as const] : []),
  ];
}
