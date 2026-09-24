import { AppError } from "@waitron/shared";
import "./errors.js";

/** One key segment: letters, digits and hyphens, not starting with a hyphen. A node id is a UUID. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * `gen-<term>-<node-id>-<opened-at>`. The node id may itself contain hyphens, so the name is read from
 * both ends: the term is the first number, the time is the fixed-width tail.
 */
export const GENERATION_NAME =
  /^gen-(0|[1-9][0-9]*)-([A-Za-z0-9][A-Za-z0-9-]*)-([0-9]{8}T[0-9]{6}Z)$/;

export function isKeySegment(value: string): boolean {
  return SEGMENT.test(value);
}

function invalid(field: string, value: string): AppError {
  return new AppError("backup.stream_name_invalid", { field, value });
}

export function venuePrefix(venueId: string): string {
  if (!isKeySegment(venueId)) throw invalid("venueId", venueId);
  return `venues/${venueId}/`;
}

/**
 * A generation is one primary's unbroken stream. The name carries the time it was opened because a
 * rebuilt box reuses the dead box's node id and can sign the same next term (spec §4.4); the
 * create-only marker (`claimGeneration`) refuses the one collision this leaves, two openings in the
 * same second.
 */
export function generationName(term: number, nodeId: string, openedAt: Date): string {
  if (!Number.isSafeInteger(term) || term < 0) throw invalid("term", String(term));
  if (!isKeySegment(nodeId)) throw invalid("nodeId", nodeId);
  const time = openedAt.getTime();
  const iso = Number.isNaN(time) ? "" : openedAt.toISOString();
  const stamp = iso
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll("-", "")
    .replaceAll(":", "");
  const name = `gen-${term}-${nodeId}-${stamp}`;
  if (parseGenerationName(name) === null) throw invalid("openedAt", String(time));
  return name;
}

export function parseGenerationName(
  name: string,
): { term: number; nodeId: string; openedAt: Date } | null {
  const match = GENERATION_NAME.exec(name);
  if (match === null) return null;
  const [, termText, nodeId, stamp] = match as unknown as [string, string, string, string];
  const term = Number(termText);
  if (!Number.isSafeInteger(term)) return null;
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.000Z`;
  const openedAt = new Date(iso);
  // The engine accepts 2026-09-31 as 1 October; only a round trip proves the date is real.
  if (Number.isNaN(openedAt.getTime()) || openedAt.toISOString() !== iso) return null;
  return { term, nodeId, openedAt };
}

export function normalisePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}

/**
 * The key as the bucket holds it. Litestream's replica path must start with the same normalised
 * prefix, or Litestream and this package will look for a generation in different places.
 */
export function bucketKey(config: { readonly prefix: string }, key: string): string {
  return `${normalisePrefix(config.prefix)}${key}`;
}
