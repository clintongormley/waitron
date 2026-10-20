export type BackupValue = null | string | number | bigint | Uint8Array;
export type BackupRow = Readonly<Record<string, BackupValue>>;

export interface BackupQuery {
  rows(sql: string, values?: readonly BackupValue[]): AsyncIterable<BackupRow>;
}
