import { basename, dirname, join } from "node:path";
import { AppError } from "@waitron/shared";
import { bucketKey, venuePrefix } from "./names.js";
import type { BucketConfig } from "./s3-store.js";
import "./errors.js";

/**
 * The one Litestream version this package runs: every measurement the design rests on was taken on
 * it. `scripts/litestream-pin.test.ts` holds it equal to the box image's and the setup script's.
 */
export const LITESTREAM_VERSION = "0.5.17";

/** Found on PATH, where the box image puts it. */
export const DEFAULT_LITESTREAM_BIN = "litestream";

/**
 * `WAITRON_LITESTREAM_BIN`, or {@link DEFAULT_LITESTREAM_BIN} when it is unset or empty. Never
 * throws: the restore command line calls it and reads no other configuration.
 */
export function resolveLitestreamBin(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.WAITRON_LITESTREAM_BIN;
  return value === undefined || value === "" ? DEFAULT_LITESTREAM_BIN : value;
}

/** The bucket key reaches Litestream only through these variables, never through the file. */
export const ENV_ACCESS_KEY_ID = "WAITRON_STREAM_ACCESS_KEY_ID";
export const ENV_SECRET_ACCESS_KEY = "WAITRON_STREAM_SECRET_ACCESS_KEY";

/**
 * Litestream's configuration for one database streaming into one generation.
 *
 * - Litestream expands variables over the whole file's text before parsing it
 *   (`cmd/litestream/main.go:640-641` at the pinned tag), so the key is named, never written, and a
 *   `$` in any other value is refused. A `$` inside a value the environment supplies is not
 *   expanded again (`bench/sqlite-failover/src/litestream.ts`, on `ENV_ACCESS_KEY_ID`).
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
    `access-key-id: \${${ENV_ACCESS_KEY_ID}}`,
    `secret-access-key: \${${ENV_SECRET_ACCESS_KEY}}`,
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
 */
export function replicaUrl(bucket: BucketConfig, venueId: string, generation: string): string {
  const path = bucketKey(bucket, `${venuePrefix(venueId)}${generation}`);
  const query = new URLSearchParams({ region: bucket.region });
  if (bucket.endpoint !== undefined) query.set("endpoint", bucket.endpoint);
  return `s3://${bucket.bucket}/${encodeURI(path)}?${query.toString()}`;
}

/** Litestream's own state for `dbPath`: `.<file>-litestream` beside it (`db.go:312` at the pinned tag). */
export function litestreamMetaDir(dbPath: string): string {
  return join(dirname(dbPath), `.${basename(dbPath)}-litestream`);
}
