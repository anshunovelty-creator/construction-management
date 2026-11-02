/**
 * The rent meter: days from the day things came to the day they went back (today while still out), at least one day.
 * Rented 2 Nov, returned 12 Nov = 10 days.
 */
export function rentDays(rentedOn: string, upTo: string): number {
  const days = Math.round((Date.parse(`${upTo}T00:00:00Z`) - Date.parse(`${rentedOn}T00:00:00Z`)) / 86_400_000);
  return Math.max(days, 1);
}

/** Rent so far in paise: quantity (in thousandths) × rate per day × days, to the nearest paisa. */
export const rentPaise = (quantityMilli: number, ratePaise: number, days: number) =>
  Math.round((quantityMilli * ratePaise * days) / 1000);
