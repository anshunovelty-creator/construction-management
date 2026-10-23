import { assertBalanced } from './balance';
import type { EntryDraft } from './types';

/** Anything that can run a parameterised SQL query: PGlite in tests, a Postgres client in the app. */
export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface PostResult {
  id: string;
  serial: string;
  /** True when this id was already posted (an offline retry); nothing new was written. */
  duplicate: boolean;
}

export async function postEntry(
  db: Queryable,
  draft: EntryDraft,
  actorId: string,
  overrideReason?: string,
): Promise<PostResult> {
  assertBalanced(draft);
  const { rows } = await db.query<{ result: PostResult }>(
    'select post_entry($1::jsonb, $2::uuid, $3) as result',
    [JSON.stringify(draft), actorId, overrideReason ?? null],
  );
  return rows[0]!.result;
}

export async function lockBooks(db: Queryable, through: string, actorId: string, reason = ''): Promise<void> {
  await db.query('select lock_books($1::date, $2::uuid, $3)', [through, actorId, reason]);
}
