import { basename, dirname, join } from "node:path";
import { AppError } from "@waitron/shared";
import { bucketKey, normalisePrefix, venuePrefix } from "./names.js";
import type { BucketConfig } from "./s3-store.js";
import "./errors.js";

/**
 * The one Litestream version this package runs: every measurement the design rests on was taken on
 * it. `scripts/litestream-pin.test.ts` holds it equal to the box image's, the setup script's and the
 * bench's.
 */
export const LITESTREAM_VERSION = "0.5.17";

/** Found on PATH, where the box image puts it. */
export const DEFAULT_LITESTREAM_BIN = "litestream";

/**
 * `WAITRON_LITESTREAM_BIN`, or {@link DEFAULT_LITESTREAM_BIN} when it is unset or empty. Never
 * throws.
 */
export function resolveLitestreamBin(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.WAITRON_LITESTREAM_BIN;
  return value === undefined || value === "" ? DEFAULT_LITESTREAM_BIN : value;
}

/** The bucket key reaches Litestream only through these variables, never through the file. */
export const ENV_ACCESS_KEY_ID = "WAITRON_STREAM_ACCESS_KEY_ID";
export const ENV_SECRET_ACCESS_KEY = "WAITRON_STREAM_SECRET_ACCESS_KEY";

const BUCKET_NAME = /^[a-z0-9.-]+$/;
const LONE_SURROGATE = /\p{Cs}/u;

/** Printable ASCII without the quote: what a single-quoted YAML scalar holds whole on one line. */
const SINGLE_QUOTABLE = /^[\x20-\x26\x28-\x7e]*$/;

/**
 * The environment that hands Litestream the bucket key. Each value is substituted into the
 * configuration's text inside single quotes before the YAML is parsed, so a value that could end or
 * fold that scalar is refused here, before anything is started.
 */
export function litestreamEnv(
  keys: Pick<BucketConfig, "accessKeyId" | "secretAccessKey">,
): Record<string, string> {
  for (const field of ["accessKeyId", "secretAccessKey"] as const) {
    if (!SINGLE_QUOTABLE.test(keys[field])) {
      throw new AppError("backup.stream_config_unsafe", { field });
    }
  }
  return {
    [ENV_ACCESS_KEY_ID]: keys.accessKeyId,
    [ENV_SECRET_ACCESS_KEY]: keys.secretAccessKey,
  };
}

/**
 * Litestream's configuration for one database streaming into one generation.
 *
 * - Litestream expands variables over the whole file's text before parsing it
 *   (`cmd/litestream/main.go:640-641` at the pinned tag), so the key is named, never written, and a
 *   `$` in any other value is refused. The references are single-quoted because the key's own
 *   characters are parsed as YAML after substitution; {@link litestreamEnv} refuses what a quote
 *   cannot hold. A `$` inside a value the environment supplies is not expanded again
 *   (`bench/sqlite-failover/src/litestream.ts`, on `ENV_ACCESS_KEY_ID`).
 * - One full copy a day and a week of history (spec §4.4); `retention` takes hours only.
 * - `l0-retention` is Litestream's default, written out because the freshness reader relies on a
 *   level-0 file staying listed at least that long after it is compacted.
 * - The path and the address are double-quoted YAML scalars (JSON's escaping is valid there), so a
 *   `:` or `#` in either cannot change the structure.
 */
export function litestreamConfig(input: { dbPath: string; replicaUrl: string }): string {
  for (const [field, value] of Object.entries(input)) {
    if (value.includes("$")) throw new AppError("backup.stream_config_unsafe", { field });
  }
  return [
    `access-key-id: '\${${ENV_ACCESS_KEY_ID}}'`,
    `secret-access-key: '\${${ENV_SECRET_ACCESS_KEY}}'`,
    "snapshot:",
    "  interval: 24h",
    "  retention: 168h",
    "l0-retention: 5m",
    "",
    "dbs:",
    `  - path: ${JSON.stringify(input.dbPath)}`,
    "    replica:",
    `      url: ${JSON.stringify(input.replicaUrl)}`,
    "",
  ].join("\n");
}

/**
 * Litestream's `s3://` address for one generation, and the only place it is built: the same key
 * {@link bucketKey} gives the object store, so the supervisor, its listings and the restore all name
 * one folder. With an endpoint Litestream defaults to path-style addressing
 * (`s3/replica_client.go:175-183` at the pinned tag), which non-Amazon stores need.
 *
 * Litestream reads the path through Go's `url.Parse` and then `path.Clean`
 * (`replica_url.go:106` at the pinned tag). Each segment is percent-encoded so `#` and `?` stay in
 * the path, and a prefix holding an empty, `.` or `..` segment is refused, because cleaning would
 * move Litestream to a folder the object store does not write to. Half a surrogate pair is refused
 * too: `encodeURIComponent` throws on it. The bucket is the host, which is not encoded, so only
 * S3's bucket-name characters are let through there.
 */
export function replicaUrl(bucket: BucketConfig, venueId: string, generation: string): string {
  if (!BUCKET_NAME.test(bucket.bucket)) {
    throw new AppError("backup.stream_config_unsafe", { field: "bucket" });
  }
  const prefixSegments = normalisePrefix(bucket.prefix).split("/").slice(0, -1);
  if (
    prefixSegments.some(
      (segment) =>
        segment === "" || segment === "." || segment === ".." || LONE_SURROGATE.test(segment),
    )
  ) {
    throw new AppError("backup.stream_config_unsafe", { field: "prefix" });
  }
  const path = bucketKey(bucket, `${venuePrefix(venueId)}${generation}`)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const query = new URLSearchParams({ region: bucket.region });
  if (bucket.endpoint !== undefined) query.set("endpoint", bucket.endpoint);
  return `s3://${bucket.bucket}/${path}?${query.toString()}`;
}

/** Litestream's own state for `dbPath`: `.<file>-litestream` beside it (`db.go:312` at the pinned tag). */
export function litestreamMetaDir(dbPath: string): string {
  return join(dirname(dbPath), `.${basename(dbPath)}-litestream`);
}
