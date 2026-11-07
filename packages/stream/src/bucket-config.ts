import { checkLitestreamSettings } from "./litestream.js";
import type { BucketConfig } from "./s3-store.js";

/** A C0 control character or DEL. */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

/**
 * Bucket settings from untrusted input. A shape problem goes to `refuse` with the field's name,
 * never its value: one of them is the secret key. A setting Litestream could not use throws
 * `backup.stream_config_unsafe` (`checkLitestreamSettings`).
 */
export function readBucketConfig(
  raw: unknown,
  refuse: (field: keyof BucketConfig) => never,
): BucketConfig {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const field = (name: keyof BucketConfig, required: boolean): string => {
    const value = body[name];
    if (value === undefined || value === "") return required ? refuse(name) : "";
    if (typeof value !== "string" || CONTROL_CHARACTER.test(value) || value.trim() !== value) {
      return refuse(name);
    }
    return value;
  };
  const endpoint = field("endpoint", false);
  if (endpoint !== "") {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return refuse("endpoint");
    }
    // A user name, password, query or fragment is where a secret could sit, and status reports the
    // address as stored; S3 requests are signed with the access key, so none is needed.
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      refuse("endpoint");
    }
  }
  const bucket: BucketConfig = {
    ...(endpoint === "" ? {} : { endpoint }),
    prefix: field("prefix", false),
    region: field("region", true),
    bucket: field("bucket", true),
    accessKeyId: field("accessKeyId", true),
    secretAccessKey: field("secretAccessKey", true),
  };
  checkLitestreamSettings(bucket);
  return bucket;
}
