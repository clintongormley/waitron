import { seriesMatchBases } from "./allocation-identity.js";

const EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");
const HOUR_MS = 3_600_000;
const HOUR_COUNT = 32 ** 4;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function encodeHourIdentity(instantMs: number): string {
  if (
    !Number.isSafeInteger(instantMs) ||
    instantMs < EPOCH_MS ||
    instantMs >= EPOCH_MS + HOUR_COUNT * HOUR_MS
  )
    throw new RangeError("Invalid hour instant");
  let hour = Math.floor((instantMs - EPOCH_MS) / HOUR_MS);
  let identity = "";
  for (let digit = 0; digit < 4; digit++) {
    identity = ALPHABET[hour % 32]! + identity;
    hour = Math.floor(hour / 32);
  }
  return identity;
}

export function decodeHourIdentity(identity: string): number {
  if (!isHourIdentity(identity)) throw new RangeError("Invalid hour identity");
  let hour = 0;
  for (const symbol of identity) hour = hour * 32 + ALPHABET.indexOf(symbol);
  return hour;
}

export function isHourIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length === 4 && /^[0-9A-HJKMNP-TV-Z]{4}$/.test(value);
}

export function isHourAllocatedSeries(
  value: unknown,
  identity: string,
  bases: readonly { code: string; purpose: string }[],
): boolean {
  return isHourIdentity(identity) && seriesMatchBases(value, identity, bases);
}
