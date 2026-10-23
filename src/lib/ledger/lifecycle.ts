import { assertBalanced } from './balance';
import type { PostResult, Queryable } from './repo';
import type { EntryDraft } from './types';

export type EntryStatus = 'unverified' | 'verified' | 'cancelled' | 'reversal';

/** Cancels an entry by posting its exact opposite. A reason is always required. */
export async function reverseEntry(
  db: Queryable,
  entryId: string,
  actorId: string,
  reason: string,
): Promise<PostResult> {
  const { rows } = await db.query<{ result: PostResult }>(
    'select reverse_entry($1::uuid, $2::uuid, $3) as result',
    [entryId, actorId, reason],
  );
  return rows[0]!.result;
}

/** Rejects someone else's unverified entry (reverses it and marks it rejected). */
export async function rejectEntry(
  db: Queryable,
  entryId: string,
  actorId: string,
  reason: string,
): Promise<PostResult> {
  const { rows } = await db.query<{ result: PostResult }>(
    'select reject_entry($1::uuid, $2::uuid, $3) as result',
    [entryId, actorId, reason],
  );
  return rows[0]!.result;
}

export async function verifyEntry(db: Queryable, entryId: string, actorId: string): Promise<void> {
  await db.query('select verify_entry($1::uuid, $2::uuid)', [entryId, actorId]);
}

/** Edits an entry: cancels the old one and posts the corrected one, linked, in one transaction. */
export async function replaceEntry(
  db: Queryable,
  oldEntryId: string,
  replacement: EntryDraft,
  actorId: string,
  reason: string,
): Promise<{ reversal: PostResult; entry: PostResult }> {
  assertBalanced(replacement);
  const { rows } = await db.query<{ result: { reversal: PostResult; entry: PostResult } }>(
    'select replace_entry($1::uuid, $2::jsonb, $3::uuid, $4) as result',
    [oldEntryId, JSON.stringify(replacement), actorId, reason],
  );
  return rows[0]!.result;
}

export async function entryStatus(db: Queryable, entryId: string): Promise<EntryStatus> {
  const { rows } = await db.query<{ status: EntryStatus }>(
    'select status from entry_status where entry_id = $1::uuid',
    [entryId],
  );
  if (!rows[0]) {
    throw new Error(`entry ${entryId} not found`);
  }
  return rows[0].status;
}
