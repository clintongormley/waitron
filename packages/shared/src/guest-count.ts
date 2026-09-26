/** The largest party one seating records; a bigger number is a mistyped count. */
export const MAX_GUEST_COUNT = 999;

/** A whole number from 1 to {@link MAX_GUEST_COUNT}. A numeric string is not a count. */
export function isValidGuestCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_GUEST_COUNT;
}
