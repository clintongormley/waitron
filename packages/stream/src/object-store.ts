/** "Only if absent" (`If-None-Match: *`) or "only if unchanged since this version" (`If-Match`). */
export type PutCondition = { ifNoneMatch: "*" } | { ifMatch: string };

export interface StoredObject {
  body: Uint8Array;
  etag: string;
}

export interface ListedObject {
  key: string;
  lastModified: Date;
}

/**
 * The bucket operations the stream needs. Keys are relative to the owner's configured prefix.
 * `put` throws `backup.stream_precondition_failed` when its condition does not hold; the S3 store's
 * `list` throws `backup.stream_name_invalid` for a listed key outside the prefix asked for; every
 * other failure is `backup.stream_request_failed`.
 */
export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, body: Uint8Array, condition?: PutCondition): Promise<{ etag: string }>;
  list(prefix: string): Promise<ListedObject[]>;
  delete(key: string): Promise<void>;
  /**
   * Deletes every key, however the store deletes several keys. Rejects at the first failure, naming
   * the key refused or, when the answer does not say which of its keys (a whole request failed, or
   * a refusal names none it sent), the first key that request carried; once it has, it starts no
   * further deletes and answers only when those already sent have settled.
   */
  deleteMany(keys: string[]): Promise<void>;
}
