import { canonicalJson } from "./canonical-json.js";

export const PACK_ATTACHMENT = "waitron-recovery-pack-v1.json";
export const MAX_PACK_FILE = 16 * 1024;
export const BUCKET_CODE_PREFIX = "WAITRON-RECOVERY-KIT-1:";
export const ARCHIVE_CODE_PREFIX = "WAITRON-ARCHIVE-PACK-1:";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * True when the bytes start `%PDF-`; a kit or pack text file never does. Kept here, apart from
 * the PDF reader, so a screen can sniff a chosen file without loading pdf-lib.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, i) => bytes[i] === byte);
}

export type RecoveryPackFileRefusal =
  "size" | "encoding" | "shape" | "noncanonical" | "not_a_pack" | "carrier" | "digest";

export class RecoveryPackFileError extends Error {
  constructor(readonly reason: RecoveryPackFileRefusal) {
    super(`Recovery pack file refused: ${reason}`);
    this.name = "RecoveryPackFileError";
  }
}

/** The pack that holds the server key, named on a pack that does not hold it. */
export type ServerKeyHolder = { number: number; madeOn: string; received: boolean };

/** Every key is always present; a part the pack does not hold is `null`. */
export type RecoveryPackFile = {
  kind: "waitron-recovery-pack";
  version: 1;
  number: number;
  madeAt: string;
  bucketCode: string | null;
  archiveCode: string | null;
  /** Carried exactly as the box holds it: a passphrase's spaces, even at either end, are part of it. */
  backupKey: string | null;
  /** The fiscal module's own key file, carried as it is; its reader checks it. */
  serverKey: Record<string, unknown> | null;
  serverKeyName: string | null;
  serverKeyHeldBy: ServerKeyHolder | null;
};

const FIELDS = [
  "kind",
  "version",
  "number",
  "madeAt",
  "bucketCode",
  "archiveCode",
  "backupKey",
  "serverKey",
  "serverKeyName",
  "serverKeyHeldBy",
] as const;

function refuse(reason: RecoveryPackFileRefusal): never {
  throw new RecoveryPackFileError(reason);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    plainObject(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/**
 * A value {@link canonicalJson} writes as JSON that reads back to the same bytes. The depth limit
 * also refuses a value that contains itself.
 */
function json(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  const keys = typeof value === "object" ? Reflect.ownKeys(value as object) : [];
  if (Array.isArray(value))
    return (
      Object.getPrototypeOf(value) === Array.prototype &&
      keys.length === value.length + 1 &&
      Object.keys(value).length === value.length &&
      value.every((item) => json(item, depth + 1))
    );
  return (
    plainObject(value) &&
    Object.keys(value).length === keys.length &&
    Object.values(value).every((item) => json(item, depth + 1))
  );
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function code(value: unknown, prefix: string): boolean {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > prefix.length &&
      value.startsWith(prefix) &&
      !/\s/.test(value))
  );
}

function label(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

function instant(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function day(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\d$/.test(value) &&
    instant(`${value}T00:00:00.000Z`)
  );
}

function holder(value: unknown): boolean {
  return (
    value === null ||
    (exact(value, ["number", "madeOn", "received"]) &&
      count(value.number) &&
      day(value.madeOn) &&
      typeof value.received === "boolean")
  );
}

function checked(value: unknown): RecoveryPackFile {
  if (
    !exact(value, FIELDS) ||
    value.kind !== "waitron-recovery-pack" ||
    value.version !== 1 ||
    !count(value.number) ||
    !instant(value.madeAt) ||
    !code(value.bucketCode, BUCKET_CODE_PREFIX) ||
    !code(value.archiveCode, ARCHIVE_CODE_PREFIX) ||
    !(
      value.backupKey === null ||
      (typeof value.backupKey === "string" && value.backupKey !== "")
    ) ||
    !(value.serverKey === null || (plainObject(value.serverKey) && json(value.serverKey))) ||
    !(value.serverKeyName === null || label(value.serverKeyName)) ||
    !holder(value.serverKeyHeldBy)
  )
    refuse("shape");
  return value as RecoveryPackFile;
}

/** Refuses a file {@link parseRecoveryPackFile} would refuse. */
export function buildRecoveryPackFile(fields: RecoveryPackFile): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(canonicalJson(checked(fields)));
  if (bytes.length > MAX_PACK_FILE) refuse("size");
  return bytes;
}

/**
 * Accepts only the canonical bytes of an exact-keys file. The canonical comparison is what refuses
 * a duplicate key: `JSON.parse` keeps the last one, so its re-serialisation differs from the input.
 */
export function parseRecoveryPackFile(bytes: Uint8Array): RecoveryPackFile {
  if (bytes.length === 0 || bytes.length > MAX_PACK_FILE) refuse("size");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    refuse("encoding");
  }
  const file = checked(raw);
  const canonical = new TextEncoder().encode(canonicalJson(file));
  if (canonical.length !== bytes.length || canonical.some((byte, i) => bytes[i] !== byte))
    refuse("noncanonical");
  return file;
}
