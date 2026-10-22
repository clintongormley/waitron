import { seriesMatchBases } from "./allocation-identity.js";

const EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");
const MINUTE_MS = 60_000;
const MINUTE_COUNT = 32 ** 5;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function encodeMinuteIdentity(instantMs: number): string {
  if (
    !Number.isSafeInteger(instantMs) ||
    instantMs < EPOCH_MS ||
    instantMs >= EPOCH_MS + MINUTE_COUNT * MINUTE_MS
  )
    throw new RangeError("Invalid minute instant");
  let minute = Math.floor((instantMs - EPOCH_MS) / MINUTE_MS);
  let identity = "";
  for (let digit = 0; digit < 5; digit++) {
    identity = ALPHABET[minute % 32]! + identity;
    minute = Math.floor(minute / 32);
  }
  return identity;
}

export function decodeMinuteIdentity(identity: string): number {
  if (!isMinuteIdentity(identity)) throw new RangeError("Invalid minute identity");
  let minute = 0;
  for (const symbol of identity) minute = minute * 32 + ALPHABET.indexOf(symbol);
  return minute;
}

export function isMinuteIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length === 5 && /^[0-9A-HJKMNP-TV-Z]{5}$/.test(value);
}

export function isMinuteAllocatedSeries(
  value: unknown,
  identity: string,
  bases: readonly { code: string; purpose: string }[],
): boolean {
  return isMinuteIdentity(identity) && seriesMatchBases(value, identity, bases);
}
