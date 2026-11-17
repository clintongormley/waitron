import { defineSettingsDocument } from "@waitron/db";

export interface StoredArchive {
  revision: string;
  writtenAt: string;
  enabled: boolean;
  cloud?: boolean;
  destinations: unknown[];
  schedule: unknown;
  retention: { count: number; days: number };
  destinationTimeoutMs: number;
}

export interface StoredStream {
  endpoint: string | null;
  region: string;
  bucket: string;
  prefix: string;
}

export interface BackupDocument {
  archive: StoredArchive | null;
  stream: StoredStream | null;
}

export const BACKUP_SETTINGS = defineSettingsDocument<BackupDocument>({
  module: "backup",
  version: 1,
  transfers: false,
  defaults: () => ({ archive: null, stream: null }),
  parse(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return { ok: false, field: "archive" };
    for (const key of Object.keys(value)) {
      if (key !== "archive" && key !== "stream") return { ok: false, field: key };
    }
    const doc = value as Record<string, unknown>;
    for (const key of ["archive", "stream"] as const) {
      const part = doc[key];
      if (part !== null && (typeof part !== "object" || Array.isArray(part)))
        return { ok: false, field: key };
    }
    return { ok: true, doc: doc as unknown as BackupDocument };
  },
});
