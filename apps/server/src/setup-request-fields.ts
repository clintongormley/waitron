import { AppError } from "@waitron/shared";
import { readBucketConfig } from "@waitron/stream";
import "./errors.js";

export const MAX_RESTORE_UPLOAD_BYTES = 256 * 1024 * 1024;
/** Throw the request-shape refusal for `field`, naming it but NEVER echoing its value (a PIN,
 * password or certificate secret is exactly the value a caller can mis-send). */
export function invalidRequest(field: string): never {
  throw new AppError("setup.request_invalid", { field });
}
export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidRequest(field);
  return value as Record<string, unknown>;
}
export function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalidRequest(field);
  return value;
}
export function asNullableString(value: unknown, field: string): string | null {
  return value === null ? null : asString(value, field);
}
/** The longest typed master key any request may carry. */
export const MAX_MASTER_KEY_BYTES = 4096;
/** A typed master key: refused as `field` when blank or over {@link MAX_MASTER_KEY_BYTES}, before
 * anything reads it. */
export function asMasterKey(value: unknown, field: string): string {
  const key = asString(value, field);
  if (key.trim().length === 0 || Buffer.byteLength(key) > MAX_MASTER_KEY_BYTES)
    invalidRequest(field);
  return key;
}

export function bucketRestoreSource(body: Record<string, unknown>) {
  return {
    bucket: readBucketConfig(body.bucket, invalidRequest),
    masterKey: asMasterKey(body.masterKey, "masterKey"),
  };
}
