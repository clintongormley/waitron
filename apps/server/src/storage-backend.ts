export interface StoredObject {
  key: string;
  size: number;
  mtimeMs: number;
}

/** A backup destination. Fan-out writes one artifact to every configured backend. */
export interface StorageBackend {
  readonly id: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Objects whose key starts with `prefix`, newest-first by mtime. Missing store → []. */
  list(prefix: string): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
}

/** v1: only local-fs. Adding a kind (s3, sftp) is a config-shape + buildBackend addition. */
export type BackupDestination = { kind: "local-fs"; id: string; dir: string };
