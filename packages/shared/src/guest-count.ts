/** The largest party one seating records; a bigger number is a mistyped count. */
export const MAX_GUEST_COUNT = 999;

/** A whole number from 1 to {@link MAX_GUEST_COUNT}. A numeric string is not a count. */
export function isValidGuestCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_GUEST_COUNT;
}

/** The count a receipt prints when nobody chose one: the party's own, only while it has exactly one bill. */
export function defaultGuestCount(guestCount: number | null, billCount: number): number | null {
  return billCount === 1 && isValidGuestCount(guestCount) ? guestCount : null;
}
