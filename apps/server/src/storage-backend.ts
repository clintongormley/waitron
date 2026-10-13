import type { FileCall } from "@waitron/stream";
import { AppError } from "@waitron/shared";
import "@waitron/stream";
import "./errors.js";

export interface StoredObject {
  key: string;
  size: number;
  mtimeMs: number;
}

/** The caller's way to stop one call. */
export type StorageCall = FileCall;

/** The most a bucket destination's `put` sends, and the most any destination's `get` holds.
 * Archives travel by `putFile` and `getFile`, never these. */
export const SMALL_OBJECT_MAX_BYTES = 16 * 1024 * 1024;

export function objectTooLarge(): AppError {
  return new AppError("backup.destination_object_too_large", { maxBytes: SMALL_OBJECT_MAX_BYTES });
}

// C0 controls, DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** One plain name directly inside the destination, so no key reaches outside it. */
export function isPlainKey(key: string): boolean {
  return key !== "" && key !== "." && key !== ".." && !/[/\\]/.test(key) && !CONTROL.test(key);
}

export function checkedKey(key: string): string {
  if (!isPlainKey(key)) throw new AppError("backup.destination_key_invalid", { field: "key" });
  return key;
}

/** A backup destination. Fan-out writes one artifact to every configured backend. */
export interface StorageBackend {
  readonly id: string;
  put(key: string, bytes: Uint8Array, call: StorageCall): Promise<void>;
  putFile(key: string, path: string, call: StorageCall): Promise<void>;
  getFile(key: string, outPath: string, call: StorageCall): Promise<void>;
  /** An object of at most `SMALL_OBJECT_MAX_BYTES`; a larger one is refused with
   * `backup.destination_object_too_large`. */
  get(key: string, call: StorageCall): Promise<Buffer>;
  /** Objects directly in the destination, never deeper, whose key starts with `prefix`, newest-first
   * by mtime. Missing store → []. */
  list(prefix: string, call: StorageCall): Promise<StoredObject[]>;
  delete(key: string, call: StorageCall): Promise<void>;
  /** A key that is already absent is not a failure. */
  deleteMany(keys: string[], call: StorageCall): Promise<void>;
  /** Called once no call on this backend is in flight. */
  close(): void;
}

export type BackupDestination = { kind: "local-fs"; id: string; dir: string };
