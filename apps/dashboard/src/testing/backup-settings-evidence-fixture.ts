import { vi } from "vitest";
import type { BackupLoadFailure, BackupSettingsEvidence } from "../api/client.js";

export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function failure(overrides: Partial<BackupLoadFailure> = {}): BackupLoadFailure {
  return {
    at: "2026-10-29T10:00:00.000Z",
    code: "credentials.decrypt_failed",
    detail: null,
    recordDigest: "digest-a",
    recordWrittenAt: "2026-10-29T09:00:00.000Z",
    ...overrides,
  };
}
export function evidence(overrides: Partial<BackupSettingsEvidence> = {}): BackupSettingsEvidence {
  return {
    readAt: "2026-10-29T11:00:00.000Z",
    managedByEnvironment: false,
    failures: [failure()],
    lastCleanLoadAt: null,
    latestLoadFailed: true,
    record: { keyVersion: 2, writtenAt: "2026-10-29T09:00:00.000Z", digest: "digest-a" },
    rewrittenSinceLastFailure: false,
    boxKeyNumbers: { current: 2 },
    now: { state: "unreadable", code: "credentials.decrypt_failed", detail: null },
    recoveryKey: { held: true, tooShort: false, fingerprint: "ABCD1234" },
    ...overrides,
  };
}
export function apiAnswering(...answers: (() => Promise<BackupSettingsEvidence>)[]) {
  const getBackupSettingsEvidence = vi.fn<() => Promise<BackupSettingsEvidence>>();
  for (const answer of answers) getBackupSettingsEvidence.mockImplementationOnce(answer);
  return { getBackupSettingsEvidence };
}
