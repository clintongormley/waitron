export interface StoredObject {
  key: string;
  size: number;
  mtimeMs: number;
}

/** The caller's way to stop one call. */
export interface StorageCall {
  signal: AbortSignal;
}

/** A backup destination. Fan-out writes one artifact to every configured backend. */
export interface StorageBackend {
  readonly id: string;
  put(key: string, bytes: Uint8Array, call: StorageCall): Promise<void>;
  putFile(key: string, path: string, call: StorageCall): Promise<void>;
  getFile(key: string, outPath: string, call: StorageCall): Promise<void>;
  get(key: string, call: StorageCall): Promise<Buffer>;
  /** Objects directly in the destination, never deeper, whose key starts with `prefix`, newest-first
   * by mtime. Missing store → []. */
  list(prefix: string, call: StorageCall): Promise<StoredObject[]>;
  delete(key: string, call: StorageCall): Promise<void>;
  /** A key that is already absent is not a failure. */
  deleteMany(keys: string[], call: StorageCall): Promise<void>;
}

export type BackupDestination = { kind: "local-fs"; id: string; dir: string };
