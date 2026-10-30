import type { AppRole } from '@/lib/auth';
import { FIRM_FORMS, type Choice, type Field, type RefSource } from '@/lib/masters/registry';

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
 * Which money accounts a list offers in a working firm. `own` is the firm's banks and common cash (owner money,
 * day close, site spending). `firm` is only the firm's own banks and cash: where money is paid or received,
 * firms never share an account.
 */
export type AccountScope = 'own' | 'firm';

const SCOPES: Partial<Record<RefSource, AccountScope>> = {
  moneyAccounts: 'own',
  firmAccounts: 'firm',
};

/** The account scope of a reference field's source; undefined when it is not a money account list. */
export const accountScope = (source: RefSource): AccountScope | undefined => SCOPES[source];

/** Whether an account (by its firm; null = common cash) is in a list for the working firm. */
export const inScope = (scope: AccountScope, accountFirmId: string | null, firmId: string): boolean =>
  scope === 'firm' ? accountFirmId === firmId : accountFirmId === null || accountFirmId === firmId;

export type AccountRow = { id: string; name: string; firm_id: string | null };

/** A money account list in the working firm: its own banks, and common cash too when the list allows it. */
export function accountChoices(rows: AccountRow[], scope: AccountScope, firmId: string): Choice[] {
  return rows.filter((r) => inScope(scope, r.firm_id, firmId)).map((r) => ({ value: r.id, label: r.name }));
}

/**
 * What stops a form filled in `firmId` from being saved, as field errors (keys under `errors.*`); null when nothing does.
 * `allowed`: the firms this person may use, or null when they work without one (supervisors).
 * `picked`: for each bank/cash field filled in, the firm of the row chosen (null = common cash).
 */
export function firmErrors(
  slug: string,
  fields: Field[],
  firmId: string | null,
  allowed: string[] | null,
  picked: Record<string, string | null>,
): Record<string, string> | null {
  if (allowed === null) return firmId === null && !FIRM_FORMS.has(slug) ? null : { _form: 'not_allowed' };
  if (!firmId || !allowed.includes(firmId)) return { _form: 'not_allowed' };
  for (const field of fields) {
    if (field.kind !== 'ref' || !(field.name in picked)) continue;
    const rowFirm = picked[field.name] ?? null;
    const scope = accountScope(field.ref);
    if (scope && !inScope(scope, rowFirm, firmId)) return { [field.name]: 'other_firm' };
  }
  return null;
}

/** An entry that belongs to no firm: none of its lines names one (cash between the owner and supervisors, a supervisor's spend). */
export const isCommonEntry = (lines: { firm_id: string | null }[]): boolean => lines.every((l) => l.firm_id === null);
