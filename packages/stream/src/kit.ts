import { AppError } from "@waitron/shared";
import { checkLitestreamSettings } from "./litestream.js";
import type { BucketConfig } from "./s3-store.js";
import "./errors.js";

/** Marks the kit token and its format version, so a pasted wrong thing is refused by name. */
export const KIT_PREFIX = "WAITRON-RECOVERY-KIT-1:";

/**
 * Everything a rebuild asks for: where the bucket is and the key to it, which venue to look under,
 * the recovery key that opens the locked secrets row, and the public key that must have signed
 * `current.json`. As sensitive as the recovery key it carries.
 */
export interface RecoveryKit {
  version: 1;
  venueId: string;
  bucket: BucketConfig;
  recoveryKey: string;
  pointerSignerPublicKey: string;
}

export function encodeRecoveryKit(kit: RecoveryKit): string {
  return KIT_PREFIX + Buffer.from(JSON.stringify(kit), "utf8").toString("base64url");
}

/** A C0 control character or DEL. */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

function text(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === "string" && (allowEmpty || value !== "") && !CONTROL_CHARACTER.test(value)
  );
}

function refuse(reason: "not_found" | "encoding" | "shape"): never {
  throw new AppError("backup.stream_kit_invalid", { reason });
}

/** Accepts the bare token or the downloaded file, whose explanatory lines surround it. */
export function parseRecoveryKit(input: string): RecoveryKit {
  const token = input.split(/\s+/).find((part) => part.startsWith(KIT_PREFIX));
  if (token === undefined) refuse("not_found");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(token.slice(KIT_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    refuse("encoding");
  }
  if (typeof raw !== "object" || raw === null) refuse("shape");
  const k = raw as Record<string, unknown>;
  const b = (typeof k.bucket === "object" && k.bucket !== null ? k.bucket : {}) as Record<
    string,
    unknown
  >;
  if (
    k.version !== 1 ||
    !text(k.venueId) ||
    !text(k.recoveryKey) ||
    !text(k.pointerSignerPublicKey) ||
    !text(b.region) ||
    !text(b.bucket) ||
    !text(b.prefix, true) ||
    !text(b.accessKeyId) ||
    !text(b.secretAccessKey) ||
    (b.endpoint !== undefined && !text(b.endpoint))
  ) {
    refuse("shape");
  }
  const bucket: BucketConfig = {
    ...(b.endpoint === undefined ? {} : { endpoint: b.endpoint as string }),
    region: b.region as string,
    bucket: b.bucket as string,
    prefix: b.prefix as string,
    accessKeyId: b.accessKeyId as string,
    secretAccessKey: b.secretAccessKey as string,
  };
  try {
    checkLitestreamSettings(bucket);
  } catch {
    refuse("shape");
  }
  return {
    version: 1,
    venueId: k.venueId,
    bucket,
    recoveryKey: k.recoveryKey,
    pointerSignerPublicKey: k.pointerSignerPublicKey,
  };
}
