import { isValidGuestCount } from "@waitron/shared";

/** A blank field records no count; anything else must be a whole number from 1. */
export function parseGuestCount(value: string): { guestCount: number | null } | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return { guestCount: null };
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const count = Number(trimmed);
  return isValidGuestCount(count) ? { guestCount: count } : undefined;
}
