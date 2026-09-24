// A bare side-effect import: it makes TypeScript treat "@waitron/shared" as a real module to augment
// (the idiom packages/credentials/src/errors.ts uses).
import "@waitron/shared";

export type BucketOperation = "get" | "put" | "list" | "delete";

/**
 * This package's codes in the shared registry. They sit in the `backup.*` family with the archive's
 * codes (apps/server/src/errors.ts) because the stream is the venue's other kind of backup. No param
 * ever carries a credential: `name` is the store's error code, or the name of a listing this package
 * refused, never message text.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A conditional write was refused: the object existed when "only if absent" was asked, or had
     * changed since the version named. For `current.json` or a generation's marker, that is another
     * box writing this venue. */
    "backup.stream_precondition_failed": { key: string };
    /** Any other failure talking to the bucket, after conflict retries are spent. `status` is the HTTP
     * status, or null when no answer arrived at all. */
    "backup.stream_request_failed": {
      operation: BucketOperation;
      key: string;
      status: number | null;
      name: string;
    };
    /** `current.json` is not a pointer this package wrote; `reason` names the check that failed. */
    "backup.stream_pointer_invalid": { reason: string };
    /** A venue id, node id, term, time or window that cannot form a key or a generation name, or a
     * listed key outside the prefix asked for (`field: "listedKey"`, `value` the key as the listing
     * named it). */
    "backup.stream_name_invalid": { field: string; value: string };
    /** A value bound for Litestream could not be written into its configuration safely: a `$` in
     * `dbPath` or `replicaUrl`, a bucket key a single-quoted YAML scalar cannot hold whole
     * (`accessKeyId`, `secretAccessKey`), or a `prefix` path cleaning would change. `field` names
     * the value, never its content. */
    "backup.stream_config_unsafe": { field: string };
  }
}
