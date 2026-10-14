import { AppError, isAppError } from "@waitron/shared";
import { readBucketConfig, type BucketConfig } from "@waitron/stream";
import { archiveNamespace, hasExactKeys, isRecord, isText } from "./archive-settings.js";
import { checkedRecoveryKey } from "./backup-config.js";
import "./errors.js";

/** Marks the pack token and its format version, so a pasted wrong thing is refused by name. */
export const ARCHIVE_PACK_PREFIX = "WAITRON-ARCHIVE-PACK-1:";

/**
 * What a restore from one archive needs: the bucket and its key, the archive folder within it, and
 * the recovery key the archives are encrypted under. As sensitive as the recovery key it carries.
 */
export interface ArchiveRecoveryPack {
  version: 1;
  /** The archive file format the cipher writes (`artifact-cipher.ts`). */
  format: "WBK1";
  venueId: string;
  /** `prefix` is the folder the owner selected, not the archive folder. */
  bucket: BucketConfig;
  /** Always `archiveNamespace(bucket.prefix, venueId)`. */
  archivePrefix: string;
  recoveryKey: string;
}

const PACK_FIELDS = [
  "version",
  "format",
  "venueId",
  "bucket",
  "archivePrefix",
  "recoveryKey",
] as const;
const BUCKET_FIELDS = ["region", "bucket", "prefix", "accessKeyId", "secretAccessKey"] as const;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function usableKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return checkedRecoveryKey(value) !== undefined;
  } catch (error) {
    if (isAppError(error) && error.code === "backup.recovery_key_too_short") return false;
    throw error;
  }
}

function refuse(reason: "not_found" | "encoding" | "shape" | "several"): never {
  throw new AppError("backup.archive_recovery_pack_invalid", { reason });
}

function token(pack: ArchiveRecoveryPack): string {
  return ARCHIVE_PACK_PREFIX + Buffer.from(JSON.stringify(pack), "utf8").toString("base64url");
}

/**
 * The pack's code line alone; the dashboard writes the file's explanatory lines around it in the
 * owner's language. Refuses a pack {@link decodeArchiveRecoveryPack} would refuse.
 */
export function encodeArchiveRecoveryPack(pack: ArchiveRecoveryPack): string {
  const line = token(pack);
  decodeArchiveRecoveryPack(line);
  return line;
}

/** Accepts the bare token or the downloaded file, whose explanatory lines surround it. */
export function decodeArchiveRecoveryPack(input: string): ArchiveRecoveryPack {
  const tokens = input.split(/\s+/).filter((part) => part.startsWith(ARCHIVE_PACK_PREFIX));
  if (tokens.length > 1) refuse("several");
  const found = tokens[0];
  if (found === undefined) refuse("not_found");
  const body = found.slice(ARCHIVE_PACK_PREFIX.length);
  // Node's base64url decoder skips characters it does not know rather than refusing them.
  if (!BASE64URL.test(body)) refuse("encoding");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    refuse("encoding");
  }
  if (!isRecord(raw) || !hasExactKeys(raw, PACK_FIELDS)) refuse("shape");
  const { version, format, venueId, archivePrefix, recoveryKey } = raw;
  if (
    version !== 1 ||
    format !== "WBK1" ||
    !isText(venueId) ||
    !usableKey(recoveryKey) ||
    typeof archivePrefix !== "string"
  ) {
    refuse("shape");
  }
  // `readBucketConfig` would read an empty endpoint as none; every bucket a pack is built from has
  // already been through it, so no pack this server issues carries one.
  const b = raw.bucket;
  if (!isRecord(b) || !hasExactKeys(b, BUCKET_FIELDS, ["endpoint"]) || b.endpoint === "") {
    refuse("shape");
  }
  let bucket: BucketConfig;
  let namespace: string;
  try {
    bucket = readBucketConfig(b, () => refuse("shape"));
    namespace = archiveNamespace(bucket.prefix, venueId);
  } catch {
    refuse("shape");
  }
  if (archivePrefix !== namespace) refuse("shape");
  return { version: 1, format: "WBK1", venueId, bucket, archivePrefix, recoveryKey };
}
