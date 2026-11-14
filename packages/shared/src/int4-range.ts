const INT4_MAX = 2_147_483_647;

/** A whole number from `min` (int4's lowest by default) to int4's highest. A numeric string is not one. */
export function int4InRange(value: unknown, min = -2_147_483_648): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= INT4_MAX;
}
