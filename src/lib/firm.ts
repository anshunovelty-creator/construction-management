import type { AppRole } from '@/lib/auth';
import { FIRM_FORMS, type Choice, type Field } from '@/lib/masters/registry';

/** runs_labour: the one firm that runs Labour payment and owns the AJAX machines (Setup → Firms). */
export type Firm = { id: string; name: string; runs_labour?: boolean };

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
 * The firms a save is checked against (`allowed` in `firmErrors`): null only for supervisors, who post without a firm.
 * Anyone else with no working firm (office staff with no firm assigned) gets none, so nothing they save gets through.
 */
export function firmsForSave(role: AppRole, working: { firms: Firm[] } | null): string[] | null {
  if (role === 'supervisor') return null;
  return working ? working.firms.map((f) => f.id) : [];
}

export type AccountRow = { id: string; name: string; firm_id: string | null; kind: string };

/** The bank and cash accounts offered in the working firm: only its own, as firms never share an account. */
export function accountChoices(rows: AccountRow[], firmId: string): Choice[] {
  return rows.filter((r) => r.firm_id === firmId).map((r) => ({ value: r.id, label: r.name, kind: r.kind }));
}

/**
 * What stops a form filled in `firmId` from being saved, as field errors (keys under `errors.*`); null when nothing does.
 * `allowed`: the firms this person may use, or null when they work without one (supervisors).
 * `picked`: for each bank/cash field filled in, the firm of the row chosen (null = shared cash from before each firm had its own).
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
    if (picked[field.name] !== firmId) return { [field.name]: 'other_firm' };
  }
  return null;
}

/** An entry that belongs to no firm: none of its lines names one. Only entries from before every account had a firm. */
export const isCommonEntry = (lines: { firm_id: string | null }[]): boolean => lines.every((l) => l.firm_id === null);
