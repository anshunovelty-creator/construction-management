import { describe, expect, it } from 'vitest';
import { chargeFor, placeMonth, supplied } from '@/lib/labour-supply';

const rates = [{ from_month: '2026-10-01', rate_paise: 500_00 }];

describe('charged rate', () => {
  it('is the day’s salary until one is kept, from its month on, and again once it is taken off', () => {
    const charges = [{ from_month: '2026-11-01', rate_paise: 600_00 }, { from_month: '2027-01-01', rate_paise: null }];
    expect(chargeFor([], rates, '2026-11')).toBe(500_00);
    expect(chargeFor(charges, rates, '2026-10')).toBe(500_00);
    expect(chargeFor(charges, rates, '2026-12')).toBe(600_00);
    expect(chargeFor(charges, rates, '2027-01')).toBe(500_00);
  });
});

describe('where a month was spent', () => {
  it('is all at the usual place, all at the one said, or split, with what has no place', () => {
    const total = { days: 26, ot: 10 };
    expect(placeMonth(total, [], 'u')).toEqual({ at: [{ placeId: 'u', days: 26, ot: 10 }], days: 0, ot: 0 });
    expect(placeMonth(total, [{ place_id: 'p', days: 3, ot_hours: 0 }], 'u')).toEqual({ at: [{ placeId: 'p', days: 26, ot: 10 }], days: 0, ot: 0 });
    expect(placeMonth(total, [], null)).toEqual({ at: [], days: 26, ot: 10 });
    expect(placeMonth(total, [{ place_id: 'p', days: 18, ot_hours: 10 }, { place_id: 'q', days: '7.5', ot_hours: 0 }], 'u')).toMatchObject({ days: 0.5, ot: 0 });
  });
});

describe('labour supplied', () => {
  it('adds up the owner’s example: Jayraj ₹25,350 and AB ₹4,000, at the paid rates', () => {
    const a = { id: 'a', days: 26, ot: 0, rates, charges: [], usual: 'jayraj', said: [{ place_id: 'jayraj', days: 18, ot_hours: 0 }, { place_id: 'ab', days: 8, ot_hours: 0 }] };
    // ₹75 an hour is ₹600 a day.
    const b = { id: 'b', days: 26, ot: 10, rates: [{ from_month: '2026-01-01', rate_paise: 600_00 }], charges: [], usual: 'jayraj', said: [] };
    const { places, unplaced } = supplied([a, b], '2026-11');
    expect(places.get('jayraj')).toEqual({ days: 44, ot: 10, charged: 25_350_00, paid: 25_350_00 });
    expect(places.get('ab')).toEqual({ days: 8, ot: 0, charged: 4_000_00, paid: 4_000_00 });
    expect(unplaced).toEqual([]);
  });

  it('charges the charged rate and pays the paid one: ₹10,800 against ₹9,000 for 18 days', () => {
    const w = { id: 'w', days: 18, ot: 0, rates, charges: [{ from_month: '2026-11-01', rate_paise: 600_00 }], usual: 'jayraj', said: [] };
    expect(supplied([w], '2026-11').places.get('jayraj')).toMatchObject({ charged: 10_800_00, paid: 9_000_00 });
    expect(supplied([{ ...w, usual: null }], '2026-11').unplaced).toEqual(['w']);
  });
});
