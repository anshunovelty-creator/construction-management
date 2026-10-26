import type { AppRole } from '@/lib/auth';
import type { Choice, RefSource } from '@/lib/masters/registry';

export type Firm = { id: string; name: string };

/** The firms someone may work in: the owner every firm, office staff their assigned ones, supervisors none. */
export function allowedFirms(role: AppRole, firms: Firm[], assignedFirmIds: string[]): Firm[] {
  if (role === 'owner') return firms;
  if (role === 'office') return firms.filter((f) => assignedFirmIds.includes(f.id));
  return [];
}

/** The saved firm while it is still allowed, else the first allowed one. */
export function pickWorkingFirm(allowed: Firm[], savedId: string | null | undefined): Firm | undefined {
  return allowed.find((f) => f.id === savedId) ?? allowed[0];
}

/**
 * Which money accounts a list offers in a working firm: `own` is the firm's banks and common cash;
 * `weOwe` / `theyOwe` add the other firms' banks, where using them leaves a between-firm due.
 */
export type AccountScope = 'own' | 'weOwe' | 'theyOwe';

const SCOPES: Partial<Record<RefSource, AccountScope>> = {
  moneyAccounts: 'own',
  moneyAccountsWeOwe: 'weOwe',
  moneyAccountsTheyOwe: 'theyOwe',
};

/** The account scope of a reference field's source; undefined when it is not a money account list. */
export const accountScope = (source: RefSource): AccountScope | undefined => SCOPES[source];

/** Whether an account (by its firm; null = common cash) is in a list for the working firm. */
export const inScope = (scope: AccountScope, accountFirmId: string | null, firmId: string): boolean =>
  accountFirmId === null || accountFirmId === firmId || scope !== 'own';

export type AccountRow = { id: string; name: string; firm_id: string | null };

/** A money account list in the working firm: its own banks and common cash, then any other firm's banks under `groupOf`. */
export function accountChoices(rows: AccountRow[], scope: AccountScope, firmId: string, groupOf: (otherFirmId: string) => string): Choice[] {
  const own = rows.filter((r) => r.firm_id === null || r.firm_id === firmId).map((r) => ({ value: r.id, label: r.name }));
  if (scope === 'own') return own;
  const other = rows
    .filter((r) => r.firm_id !== null && r.firm_id !== firmId)
    .map((r) => ({ value: r.id, label: r.name, group: groupOf(r.firm_id!) }));
  return [...own, ...other];
}

/** An entry that belongs to no firm: none of its lines names one (cash between the owner and supervisors, a supervisor's spend). */
export const isCommonEntry = (lines: { firm_id: string | null }[]): boolean => lines.every((l) => l.firm_id === null);
