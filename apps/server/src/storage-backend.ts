export interface StoredObject {
  key: string;
  size: number;
  mtimeMs: number;
}

/** A backup destination. Fan-out writes one artifact to every configured backend. */
export interface StorageBackend {
  readonly id: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  putFile(key: string, path: string): Promise<void>;
  getFile(key: string, outPath: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Objects whose key starts with `prefix`, newest-first by mtime. Missing store → []. */
  list(prefix: string): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
}

export type BackupDestination = { kind: "local-fs"; id: string; dir: string };
