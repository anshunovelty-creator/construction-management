import { describe, expect, it } from 'vitest';
import { parseFields, percentToBasisPoints, submittedValues, toFormValue } from '@/lib/masters/parse';
import { EDIT_USER_FIELDS, MASTERS, NEW_USER_FIELDS } from '@/lib/masters/registry';

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

const FIRM = '0b6c1f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const CLIENT = '1b6c1f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const SITE = '2b6c1f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('percentToBasisPoints', () => {
  it('converts percentages to basis points', () => {
    expect(percentToBasisPoints('1')).toBe(100);
    expect(percentToBasisPoints('0.5')).toBe(50);
    expect(percentToBasisPoints('12.25 %')).toBe(1225);
    expect(percentToBasisPoints('100')).toBe(10_000);
  });

  it('rejects anything else', () => {
    expect(() => percentToBasisPoints('101')).toThrow('more than 100%');
    expect(() => percentToBasisPoints('1.234')).toThrow('not a valid percentage');
    expect(() => percentToBasisPoints('-1')).toThrow('not a valid percentage');
  });
});

describe('parseFields', () => {
  const workOrder = MASTERS['work-orders']!.fields;

  it('turns a work-order form into column values', () => {
    const result = parseFields(
      workOrder,
      form([
        ['firm_id', FIRM], ['client_id', CLIENT], ['site_id', SITE], ['ref', ' WO-SVG-1 '],
        ['contract_type', 'item_rate'], ['contract_value_paise', '61,99,578'], ['tds_bp', '1'],
        ['retention_bp', '5'], ['security_deposit_bp', ''], ['start_date', '2026-04-01'], ['is_active', 'on'],
      ]),
    );
    expect(result).toEqual({
      ok: true,
      values: {
        firm_id: FIRM, client_id: CLIENT, site_id: SITE, ref: 'WO-SVG-1', contract_type: 'item_rate',
        contract_value_paise: 619_957_800, tds_bp: 100, retention_bp: 500, security_deposit_bp: 0,
        start_date: '2026-04-01', is_active: true,
      },
    });
  });

  it('reports every bad field at once', () => {
    const result = parseFields(
      workOrder,
      form([
        ['firm_id', 'not-an-id'], ['ref', ''], ['contract_type', 'lump_sum'], ['contract_value_paise', '12.345'],
        ['tds_bp', '150'], ['start_date', '2026-02-30'],
      ]),
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        firm_id: 'invalid_choice', client_id: 'required', site_id: 'required', ref: 'required',
        contract_type: 'invalid_choice', contract_value_paise: 'invalid_amount', tds_bp: 'invalid_percent',
        start_date: 'invalid_date',
      },
    });
  });

  it('handles user forms: email, password, assignments', () => {
    const created = parseFields(
      NEW_USER_FIELDS,
      form([
        ['email', ' Priya@Example.com '], ['password', 'secret pass'], ['full_name', 'Priya'], ['role', 'office'],
        ['language', 'hi'], ['firms', FIRM], ['firms', SITE],
      ]),
    );
    expect(created).toEqual({
      ok: true,
      values: {
        email: 'priya@example.com', password: 'secret pass', full_name: 'Priya', role: 'office', language: 'hi',
        firms: [FIRM, SITE], sites: [],
      },
    });
    expect(parseFields(NEW_USER_FIELDS, form([['email', 'nope'], ['password', 'short']]))).toMatchObject({
      ok: false,
      errors: { email: 'invalid_email', password: 'password_short' },
    });
  });

  it('keeps the current password when the edit form leaves it empty', () => {
    const result = parseFields(
      EDIT_USER_FIELDS,
      form([['full_name', 'Priya'], ['role', 'office'], ['language', 'en'], ['password', '']]),
    );
    expect(result.ok && 'password' in result.values).toBe(false);
  });
});

describe('form values', () => {
  it('shows stored values the way the form takes them', () => {
    const [, , , , , value, tds] = MASTERS['work-orders']!.fields;
    expect(toFormValue(value!, 619_957_800)).toBe('6199578.00');
    expect(toFormValue(value!, null)).toBe('');
    expect(toFormValue(tds!, 50)).toBe('0.5');
  });

  it('keeps what the user typed, except the password', () => {
    expect(submittedValues(form([['name', 'A'], ['firms', 'x'], ['firms', 'y'], ['password', 'p'], ['$ACTION_ID_1', '']]))).toEqual({
      name: 'A',
      firms: ['x', 'y'],
    });
  });
});
