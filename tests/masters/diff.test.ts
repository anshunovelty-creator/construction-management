import { describe, expect, it } from 'vitest';
import { changedFields } from '@/lib/masters/diff';

describe('changedFields', () => {
  it('lists only the fields that changed', () => {
    expect(
      changedFields(
        { id: 'p1', name: 'Ansari', phone: '', created_at: 'a' },
        { id: 'p1', name: 'Ansari Enterprise', phone: '', created_at: 'b' },
      ),
    ).toEqual([{ field: 'name', before: 'Ansari', after: 'Ansari Enterprise' }]);
  });

  it('shows every field for an insert or a delete', () => {
    expect(changedFields(null, { user_id: 'u1', firm_id: 'f1' })).toEqual([
      { field: 'firm_id', before: null, after: 'f1' },
      { field: 'user_id', before: null, after: 'u1' },
    ]);
    expect(changedFields({ user_id: 'u1' }, null)).toEqual([{ field: 'user_id', before: 'u1', after: null }]);
  });
});
