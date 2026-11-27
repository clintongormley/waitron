import type { DashboardRequest, DownloadedFile } from "@waitron/dashboard-kit";
import { CloudApi } from "./cloud-api.js";

// ── Backup admin types ───────────────────────────────────────────────────────────────────────

export type BackupSchedule =
  | { kind: "interval"; ms: number }
  | {
      kind: "wall-clock";
      days: "daily" | number[];
      at: { hour: number; minute: number } | "auto";
    };

export type BackupDestinationStatus = {
  id: string;
  lastBackupAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  /** Why this destination could not be listed; it then reads stale with null times. */
  readErrorCode: string | null;
  /** This destination stored an archive since the running backup config was applied. */
  storedUnderCurrentKey: boolean;
  uploadErrorCode: string | null;
  pruneErrorCode: string | null;
};

export type BackupFreshness =
  | { configured: false; loadErrorCode?: string }
  | { configured: true; destinations: BackupDestinationStatus[] };
/** LOCAL copy of the server's `DestinationView` (`apps/server/src/backup-supervisor.ts`). */
export type BackupDestinationView =
  | { id: string; kind: "local-fs"; dir: string }
  | {
      id: string;
      kind: "s3";
      endpoint: string | null;
      region: string;
      bucket: string;
      prefix: string;
      accessKeyId: string;
      namespace: string;
      credentialPresent: true;
    };
/** Never carries the recovery key: the server strips it (`projectStatus`,
 * `apps/server/src/backup-api.ts`). */
export interface BackupStatusView {
  enabled: boolean;
  isPrimary: boolean;
  revision: string | null;
  /** A dashboard record is stored switched off. */
  storedDisabled: boolean;
  /** Why the stored settings could not be used, which leaves archives off. */
  loadErrorCode: string | null;
  destinations: BackupDestinationView[];
  cloud?: boolean;
  cloudBackups?: "available" | "unavailable";
  schedule?: BackupSchedule;
  retention?: { count: number; days: number };
  keyFingerprint?: string;
  keyRotatedAt?: string;
  backupStatus: BackupFreshness;
  activeRun?: { kind: "manual" | "scheduled"; startedAt: string };
  runStoppedCode?: string;
  archiveUnderCurrentKey: boolean;
  /** Whether the box holds a recovery key at all, archives on or off. */
  recoveryKeySet: boolean;
  /** The held key is under the length floor. */
  recoveryKeyTooShort: boolean;
}
/** LOCAL copy of the destination kinds `POST /api/backup/apply` reads
 * (`apps/server/src/archive-settings.ts`). */
export type ArchiveChoice =
  | { kind: "local-fs"; dir: string }
  | { kind: "stream-bucket" }
  | {
      kind: "custom-s3";
      endpoint?: string;
      region: string;
      bucket: string;
      prefix?: string;
      accessKeyId: string;
      secretAccessKey?: string;
    };
/** Apply, disable and rotate answer the full status; a reload that failed after the write is
 * reported here, and the write still stands. */
export type BackupWriteAnswer = BackupStatusView & { reloadErrorCode?: string };

export interface BackupApplyBody {
  destinations: ArchiveChoice[];
  cloud?: boolean;
  schedule: BackupSchedule;
  retention: { count: number; days: number };
}
/** LOCAL copy of `@waitron/stream`'s `StreamStatus`: a supervisor's state, running or stopped. */
export interface StreamSupervisorStatus {
  state: "off" | "opening" | "streaming" | "paused" | "refused";
  generation: string | null;
  reason: string | null;
  stateSince: string;
  bucketProblem: { reason: string; since: string } | null;
  lagMs: number;
  lastConfirmedUploadAt: string | null;
}
/** LOCAL copy of `@waitron/stream`'s `StreamView`: a supervisor's status; a copy whose
 * settings are stored but that has no supervisor, with why; or plain off. */
export type StreamStatusView = (
  StreamSupervisorStatus | { state: "off"; reason: string; stateSince: string } | { state: "off" }
) & { toSpare?: true };
/** LOCAL copy of `LoadFailureDetail` (`apps/server/src/backup-settings-evidence.ts`). */
export type BackupLoadFailureDetail = { reason: string } | { keyVersion: number } | { min: number };
/** One failure to load the saved backup settings, as the box kept it. */
export interface BackupLoadFailure {
  at: string;
  code: string;
  detail: BackupLoadFailureDetail | null;
  recordDigest: string | null;
  recordWrittenAt: string | null;
}

export type BackupEvidenceDestination =
  | { kind: "folder"; dir: string; look: "folder" | "missing" | "not_a_folder" | "unknown" }
  | {
      kind: "bucket";
      endpoint: string | null;
      region: string;
      bucket: string;
      accessKeyId: string;
      archiveFolder: string;
    };
/** `GET /api/backup/settings-evidence` — LOCAL copy of the server's `SettingsEvidence`
 * (`apps/server/src/backup-settings-evidence.ts`). Never carries a secret. */
export interface BackupSettingsEvidence {
  readAt: string;
  /** Newest first. */
  failures: BackupLoadFailure[];
  lastCleanLoadAt: string | null;
  /** By the order the box recorded its loads in, not by comparing `lastCleanLoadAt` with a
   * failure's `at`: the box clock can move backwards. */
  latestLoadFailed: boolean;
  record: { keyVersion: number | null; writtenAt: string; digest: string } | null;
  /** Also true when the record that failed has been deleted since (`record` is null). */
  rewrittenSinceLastFailure: boolean;
  boxKeyNumbers: { current: number; previous?: number };
  now:
    | { state: "absent" }
    | { state: "unreadable"; code: string; detail: BackupLoadFailureDetail | null }
    | { state: "readable"; destinations: BackupEvidenceDestination[] };
  recoveryKey: { held: boolean; tooShort: boolean; fingerprint?: string };
}

export interface MadeRecoveryPack {
  pdf: Blob;
  number: number;
  /** The box's own time for the pack, the same instant its status read reports. */
  madeAt: string;
  /** The new master key as printed, and its name; only when the box made one. */
  masterKey?: { key: string; name: string };
}
function decodedName(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
/** True for a string spelled exactly as `Date#toISOString` spells a real instant. */
export function isInstant(value: string): boolean {
  const at = new Date(value);
  return !Number.isNaN(at.getTime()) && at.toISOString() === value;
}
type RecoveryPackPart = "bucket" | "archives" | "emergency" | "master-key";
/** Each reason names only the parts the box can give it for. */
export type RecoveryPackReason =
  | { part: "bucket"; kind: "key_changed"; at: string }
  | { part: "bucket"; kind: "settings_changed" }
  | { part: "bucket"; kind: "set_up_after" }
  | { part: "emergency"; kind: "set_up_after" }
  | { part: "bucket"; kind: "removed" };
/** `GET /api/backup/recovery-pack` — LOCAL copy of `apps/server/src/backup-recovery-pack-status.ts`'s
 * `PackStatus`. */
export interface RecoveryPackStatus {
  latest: null | {
    number: number;
    madeAt: string;
    madeByName: string | null;
    received: boolean;
    parts: {
      part: RecoveryPackPart;
      state: "included" | "absent" | "failed" | "not-set-up";
    }[];
  };
  upToDate: boolean;
  incomplete: boolean;
  unreceived: null | {
    number: number;
    madeAt: string;
    offeredAtSetup?: true;
    /** The pack showed the current master key; named even when a later pack was received. */
    holdsCurrentMasterKey?: true;
  };
  reasons: RecoveryPackReason[];
  keep: {
    number: number;
    madeAt: string;
    until: string;
    why: "backup_key";
  }[];
  backupsUseOlderKey: boolean;
  /** The venue's current master key, and this box's pack that showed it, if one did. */
  masterKey: { name: string; pack: number | null } | null;
  /** Until when a pack made before now is kept, were a new master key made now. */
  keepOldPackUntil: string;
  /** The venue's time zone, which the pack's pages are dated in. */
  timeZone: string;
  /** A new master key was made and shown, and the box has not yet taken or dropped it. */
  newKeyWaiting?: boolean;
  /** The box's backup key; null while it holds none it can use. */
  backupKey: {
    number: number;
    fingerprint: string;
    /** Null when the key was never changed. */
    changedAt: string | null;
    /** False with no master key too. */
    fromCurrentMasterKey: boolean;
  } | null;
}
/** `GET /api/backup/stream` — LOCAL copy of `apps/server/src/stream-api.ts`'s `StreamSettingsView`.
 * Never carries the secret access key. */
export interface StreamSettingsView {
  isPrimary: boolean;
  configured: boolean;
  bucket: {
    endpoint: string | null;
    region: string;
    bucket: string;
    prefix: string;
    accessKeyId: string;
  } | null;
  status: StreamStatusView;
  /** True for a key under the length floor too, which has no fingerprint. */
  recoveryKeySet: boolean;
  keyFingerprint: string | null;
  /** Changes on every stored change, a secret-only one included; null when nothing is stored. */
  revision: string | null;
}
/** The bucket form's body: a blank `endpoint` means an Amazon bucket, a blank `prefix` the bucket
 * root. */
export interface StreamBucketBody {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface RefundAuditItem {
  charge?: { amount: string; settledAt: string };
  reason:
    | "not_checked"
    | "confirmed"
    | "amount_agreement"
    | "amount"
    | "ambiguous"
    | "missing_local"
    | "missing_provider"
    | "void"
    | "outside"
    | "read_failed"
    | "not_found"
    | "missing_events"
    | "missing_reference"
    | "invalid"
    | "pending";
  processorRef: string | null;
  providerRefundRef: string | null;
  paymentRef: string | null;
  workingOrderId: string | null;
  externalMachine: string | null;
  externalRef: string | null;
  providerAmount: string | null;
  localAmount: string | null;
  providerAt: string | null;
  localAt: string | null;
}

export interface BackupAuditView {
  pairedAudit: {
    complete: boolean;
    matched: number;
    toCheck: number;
    rows: {
      settledAt: string;
      amount: string;
      readerName: string;
      billNumber: number | null;
      orderNumber: number;
      tableName: string | null;
      statuses: (
        | "matched"
        | "resolved"
        | "refunded_before_check"
        | "partly_refunded_before_check"
        | "refunded_at_sumup"
        | "not_checked"
        | "missing_local"
        | "drift"
        | "orphan"
        | "unsettled"
        | "lost_settlement"
      )[];
    }[];
  };
  refundAudit: {
    complete: boolean;
    checkedAt: string[];
    matches: RefundAuditItem[];
    agreements: RefundAuditItem[];
    exceptions: RefundAuditItem[];
    outside: RefundAuditItem[];
  };
  day: string;
  timeZone: string;
  complete: boolean;
  backupMatches: {
    references: string[];
    amount: string;
    settledAt: string;
    paymentRef: string;
    workingOrderId: string;
    externalMachine: string | null;
    externalRef: string | null;
  }[];
  backupUnmatched: ({
    references: string[];
    amount: string;
    settledAt: string;
    reason: "ambiguous" | "unmatched";
  } & (
    | { kind: "charge" }
    | {
        kind: "recorded";
        paymentRef: string;
        workingOrderId: string;
        externalMachine: string | null;
        externalRef: string | null;
      }
  ))[];
}

export class BackupApi extends CloudApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  getBackupStatus(): Promise<BackupStatusView> {
    return this.#request<BackupStatusView>("/api/backup/status", "GET");
  }
  getBackupSettingsEvidence(): Promise<BackupSettingsEvidence> {
    return this.#request<BackupSettingsEvidence>("/api/backup/settings-evidence", "GET");
  }
  exportConfiguration(passphrase: string): Promise<Blob> {
    return this.#request<Blob>(
      "/management-api/configuration-export",
      "POST",
      { passphrase },
      { as: "blob" },
    );
  }
  /**
   * Refuses, as `recovery.pack_invalid`, an answer without its pack headers (the made-at one an exact
   * ISO instant) or whose body does not start `%PDF-` and end `%%EOF` (whitespace after it allowed);
   * nothing between is read. A non-2xx that is not the box's refusal rejects as `connection.failed`.
   */
  async makeRecoveryPack(
    body: { locale: "en" | "es"; masterKey: string } | { locale: "en" | "es"; newMasterKey: true },
  ): Promise<MadeRecoveryPack> {
    const file = await this.#request<DownloadedFile>("/api/backup/recovery-pack", "POST", body, {
      as: "file",
      headers: [
        "X-Waitron-Recovery-Pack",
        "X-Waitron-Recovery-Pack-Made-At",
        "X-Waitron-Master-Key",
        "X-Waitron-Master-Key-Name",
      ],
      refusals: "envelope",
    });
    const pdf = file.blob;
    const number = file.headers?.["X-Waitron-Recovery-Pack"] ?? "";
    const madeAt = file.headers?.["X-Waitron-Recovery-Pack-Made-At"] ?? "";
    const masterKey = file.headers?.["X-Waitron-Master-Key"] ?? undefined;
    const encodedName = file.headers?.["X-Waitron-Master-Key-Name"] ?? undefined;
    const masterKeyName = encodedName === undefined ? undefined : decodedName(encodedName);
    if (
      (masterKey === undefined) !== (encodedName === undefined) ||
      masterKey === "" ||
      masterKeyName === null ||
      masterKeyName === ""
    )
      throw { code: "recovery.pack_invalid" };
    if (
      pdf.type !== "application/pdf" ||
      pdf.size === 0 ||
      pdf.size > 8 * 1024 * 1024 ||
      !/^[1-9][0-9]*$/.test(number) ||
      !isInstant(madeAt) ||
      (await pdf.slice(0, 5).text()) !== "%PDF-" ||
      !/%%EOF\s*$/.test(await pdf.slice(-16).text())
    )
      throw { code: "recovery.pack_invalid" };
    return {
      pdf,
      number: Number(number),
      madeAt,
      ...(masterKey === undefined || masterKeyName === undefined
        ? {}
        : { masterKey: { key: masterKey, name: masterKeyName } }),
    };
  }
  getRecoveryPackStatus(): Promise<RecoveryPackStatus> {
    return this.#request<RecoveryPackStatus>("/api/backup/recovery-pack", "GET", undefined, {
      passive: true,
    });
  }
  /** A new master key's pack sends back the key it showed: the box takes the key only then. */
  markRecoveryPackReceived(packNumber: number, masterKey?: string): Promise<void> {
    return this.#request<void>(
      `/api/backup/recovery-pack/${packNumber}/received`,
      "POST",
      masterKey === undefined ? {} : { masterKey },
    );
  }
  applyBackup(body: BackupApplyBody): Promise<BackupWriteAnswer> {
    return this.#request<BackupWriteAnswer>("/api/backup/apply", "POST", body);
  }
  runBackupNow(): Promise<void> {
    return this.#request<void>("/api/backup/run-now", "POST");
  }
  disableBackup(): Promise<BackupWriteAnswer> {
    return this.#request<BackupWriteAnswer>("/api/backup/disable", "POST");
  }
  /** Moves backups to the next backup key of the typed master key, sent as typed. */
  rotateBackupKey(body: { masterKey: string }): Promise<BackupWriteAnswer> {
    return this.#request<BackupWriteAnswer>("/api/backup/rotate", "POST", body);
  }
  getStreamSettings(): Promise<StreamSettingsView> {
    return this.#request<StreamSettingsView>("/api/backup/stream", "GET");
  }
  /** Tests the bucket, stores the settings and switches the copy on. */
  saveStreamSettings(body: StreamBucketBody): Promise<StreamSettingsView> {
    return this.#request<StreamSettingsView>("/api/backup/stream", "PUT", body);
  }
  /** Runs the bucket checks and stores nothing. */
  testStreamBucket(body: StreamBucketBody): Promise<{ ok: true }> {
    return this.#request<{ ok: true }>("/api/backup/stream/test", "POST", body);
  }
  /** What is already in the bucket stays there. */
  turnOffStream(): Promise<StreamSettingsView> {
    return this.#request<StreamSettingsView>("/api/backup/stream", "DELETE");
  }
  /** Starts a copy that stopped by itself with the settings it already holds. */
  restartStream(): Promise<StreamSettingsView> {
    return this.#request<StreamSettingsView>("/api/backup/stream/restart", "POST");
  }
  getBackupAudit(day?: string): Promise<BackupAuditView> {
    return this.#request(
      `/management-api/payments/backup-audit${day ? `?day=${encodeURIComponent(day)}` : ""}`,
      "GET",
      undefined,
      { passive: true },
    );
  }
}
