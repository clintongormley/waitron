/** The largest party one seating records; a bigger number is a mistyped count. */
export const MAX_GUEST_COUNT = 999;

/** A whole number from 1 to {@link MAX_GUEST_COUNT}. A numeric string is not a count. */
export function isValidGuestCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_GUEST_COUNT;
}

export interface PartyGuestCount {
  guestCount: number | null;
  billCount: number;
}

/** A party's default guest count: its own count, only while it has exactly one bill and the count is valid. */
export function defaultGuestCount(party: PartyGuestCount): number | null {
  return party.billCount === 1 && isValidGuestCount(party.guestCount) ? party.guestCount : null;
}
