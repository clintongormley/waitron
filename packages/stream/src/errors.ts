// A bare side-effect import: it makes TypeScript treat "@waitron/shared" as a real module to augment
// (the idiom packages/credentials/src/errors.ts uses).
import "@waitron/shared";

export type BucketOperation = "get" | "put" | "list" | "delete";

/** The archive file store's requests (`s3-file-store.ts`). */
export type DestinationOperation =
  "put" | "create_upload" | "upload_part" | "complete_upload" | "get" | "list" | "delete";

export type DestinationCleanup = "abort_upload" | "delete_object";

/**
 * This package's codes in the shared registry: the bucket copy's (`backup.stream_*`) and the archive
 * destination's (`backup.destination_*`), in the `backup.*` family with the archive's other codes
 * (apps/server/src/errors.ts). No param ever carries a credential; what `name` may hold is stated at
 * `backup.stream_request_failed`.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A conditional write was refused: the object existed when "only if absent" was asked, or had
     * changed since the version named. For `current.json` or a generation's marker, that is usually
     * another box writing this venue; it can also be a late pointer write by this box from before a
     * restart, or, on a bucket that answers a conditional write to a missing object with 412, a
     * pointer that was deleted (a bucket answering 404 gives `backup.stream_request_failed`). */
    "backup.stream_precondition_failed": { key: string };
    /** Any other failure talking to the bucket, after conflict retries are spent. `status` is the HTTP
     * status, or null when no answer arrived at all, its body broke off, or the caller cancelled the
     * call (`name` "AbortError"). From `createS3ObjectStore`, `name` is the error's
     * name as `loggableErrorName` passes it: a name on its lists, or "other". A file refused inside a
     * batch delete the bucket otherwise answered carries that answer's status (200) and the file's own
     * error code, vetted the same way, as `name`. `name` is "IncompleteDeleteResult" when the refusal
     * gives no code or names no file of the batch; in the latter case `key` is the batch's first file. */
    "backup.stream_request_failed": {
      operation: BucketOperation;
      key: string;
      status: number | null;
      name: string;
    };
    /** `current.json` is not a pointer this package wrote; `reason` names the check that failed. */
    "backup.stream_pointer_invalid": { reason: string };
    /** A venue id, node id, term, time or window that cannot form a key or a generation name, or a
     * listed key outside the prefix asked for (`field: "listedKey"`, `value` "other", never the key: the
     * key is text the bucket supplied). */
    "backup.stream_name_invalid": { field: string; value: string };
    /** A value bound for Litestream could not be written into its configuration safely
     * (`litestream.ts`). `field` names the value, never its content. */
    "backup.stream_config_unsafe": { field: string };
    /** Text offered as a recovery kit is not one: `not_found` (no kit token in it), `encoding` (the
     * token does not decode to JSON) or `shape` (the decoded kit is not an object, is not version 1,
     * has a text field that is missing, empty, not a string or holds a control character, has no bucket
     * object, or carries bucket settings refused by the kit's own check in `kit.ts` — no prefix field, a prefix of "-",
     * an empty endpoint — by the shared reader in `bucket-config.ts`, or by Litestream's settings
     * check). Never carries any of the text: a kit holds the recovery key and the bucket's
     * secret key. */
    "backup.stream_kit_invalid": { reason: "not_found" | "encoding" | "shape" };
    /** `litestream restore` did not produce the database: its exit code, or `null` when it gave
     * none — abandoned, never started, or ended by a signal; `diskFull` when its output carries the
     * system's own "no space left on device", or its configuration could not be written for lack of
     * space. Its output is not carried — it can name the bucket and endpoint. */
    "backup.stream_restore_failed": { exitCode: number | null; diskFull: boolean };
    /** An archive destination's bucket request failed (`createS3FileStore`). `status` and `name`
     * follow `backup.stream_request_failed`'s rules. A cancelled signal is always `status` null and
     * `name` "AbortError": the store cannot tell a caller's stop from a time limit, so it names
     * neither. */
    "backup.destination_request_failed": {
      operation: DestinationOperation;
      key: string;
      status: number | null;
      name: string;
    };
    /** After a failed upload, the store could not abandon its own multipart upload, or delete its
     * own key when the bucket may have stored it, within its cleanup budget. Reported in place of
     * the failure that caused the cleanup, because something of this upload may be left in the
     * bucket. `unresolved` names every step left unfinished, abandoning the upload before deleting
     * the key, so a whole object the bucket may hold is named even when the abandonment failed too.
     * The steps run side by side under one budget, counted from the failure; a step it ran out on
     * is `status` null and `name` "AbortError". Otherwise each step's `status` and `name` describe
     * its request, as `backup.stream_request_failed`'s do. */
    "backup.destination_cleanup_failed": {
      key: string;
      unresolved: { cleanup: DestinationCleanup; status: number | null; name: string }[];
    };
    /** A key, a listing prefix or the configured prefix is empty where it must not be, absolute,
     * holds a control character or an empty, `.` or `..` segment; or a listing named a key outside
     * the prefix asked for (`listedKey`). The server's destinations add a stricter rule: a key must
     * be one plain name, and a bucket destination's listing prefix may hold no "/". Never carries
     * the key. */
    "backup.destination_key_invalid": { field: "key" | "prefix" | "listedKey" };
    /** The file being uploaded to `key` ended before the length it had when its upload began, so
     * the upload stopped rather than send a part shorter than the length it stated. Never carries the
     * file's path. */
    "backup.destination_file_shrank": { key: string };
    /** A file needs more than 10,000 parts of the largest part size, refused before any request. */
    "backup.destination_file_too_large": { bytes: number; maxBytes: number };
  }
}
