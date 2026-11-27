import type { DashboardRequest, DownloadedFile } from "@waitron/dashboard-kit";
import { isInstant, type StreamStatusView } from "./backup-api.js";
import { PrintingApi } from "./printing-api.js";

// ── Diagnostics (recent logs + runtime verbosity) types ──────────────────────────────────────────

export type DiagnosticsLine = {
  at: string;
  level: string;
  event: string;
  requestId?: string;
} & Record<string, unknown>;

export type DiagnosticsLevel = "error" | "warn" | "info" | "all";

export interface DiagnosticsLog {
  lines: DiagnosticsLine[];
  timeZone: string;
  oldestScannedAt: string | null;
}

export type Verbosity = { level: "debug" | "info"; revertsAt: string | null };
/** One machine in the venue's signed membership chart (`listServers`,
 * `apps/server/src/membership-removal.ts`). */
export interface ServerRow {
  nodeId: string;
  /** `""` when the machine gave no address. */
  contactUrl: string;
  standing: "serving-primary" | "serving-secondary" | "sell-only" | "evicted";
  isSelf: boolean;
  removable: boolean;
  canClear: boolean;
  /** A spare that finished joining: Remove must send both declarations. */
  requiresRetirementConfirmation: boolean;
  /** A handover here still waits for this old main box to return its records. */
  returnOutstanding: boolean;
  /** Remove of this former main box is refused unless it sends `resetStatement`. */
  needsResetStatement: boolean;
  /** This server has ordered the old main box to reset. */
  reset: null | "ordered";
  canReset: boolean;
  /**
   * Wipe and remove is offered for this old main box only as an order accepting that what it has
   * not returned is set aside.
   */
  canWipeWithLoss: boolean;
  /** How this box was replaced: the takeover whose return completed, else the latest; null if none. */
  returnScenario: "controlled" | "emergency" | null;
  /**
   * Null unless this venue holds a completed return from the box. `backed-up`: a backup started
   * after the records came back; `awaiting-backup`: none has, or that is unknown; `no-backups`:
   * backups are not set up.
   */
  recoveredRecordsBackup: "backed-up" | "awaiting-backup" | "no-backups" | null;
}

export type SelfResetRefusal =
  | "environment"
  | "local_address_required"
  | "joined_another_box"
  | "remove_other_boxes"
  | "reset_pending";
/** `term` is null, and `nodes` empty, when this server holds no chart. */
export interface ServerListing {
  resetThisBox?: "available" | Exclude<SelfResetRefusal, "environment">;
  spare?: SpareFollowView | null;
  term: number | null;
  nodes: ServerRow[];
  /** Boxes asking to join that the main box lists; absent on a box that answers none. */
  joinRequests?: BoxJoinRequestRow[];
}
/** LOCAL copy of the server's `ListedJoinRequest` (`apps/server/src/box-join-requests.ts`). */
export interface BoxJoinRequestRow {
  id: string;
  address: string;
  askedAt: string;
  startedAgain: boolean;
  /** The new box has chosen Join, so Add as spare can be sent. */
  newConfirmed: boolean;
}
/** The Check answer (`apps/server/src/box-join-api.ts`). */
export interface BoxJoinCheck {
  code: string;
  newConfirmed: boolean;
}
/** LOCAL copy of the server's `Alert` (`packages/module/src/alerts.ts`). */
export interface AlertView {
  key: string;
  kind: "event" | "ongoing";
  code: string;
  params: Record<string, unknown>;
  severity: "warning" | "error" | "notice";
  since: string | null;
  area: string;
  screen?: string;
  handledAt?: string;
  handledBy?: string | null;
  /** An event's source: `device`, or the job that raised it. Ongoing alerts carry none. */
  source?: string;
  deviceId?: string | null;
  deviceName?: string | null;
}

export type BoxNetworkChange = {
  kind: "join" | "forget";
  ssidHex: string;
  state: "running" | "applied" | "refused";
  reason: "password-rejected" | "network-not-found" | "timed-out" | "failed" | null;
};

export interface BoxNetwork {
  change: BoxNetworkChange | null;
  bootCopy: {
    state: "pending" | "current" | "absent" | "failed";
    reason: string | null;
    failure: string | null;
  };
  wired: { connected: boolean; address: string | null };
  wifi: { connectedSsidHex: string | null; savedSsidHex: string | null };
}

export interface BoxWifiNetwork {
  ssidHex: string;
  signal: number;
  security: "wpa-psk" | "sae" | "other";
}

export interface BoxWifiJoin {
  ssidHex: string;
  keyMgmt: "wpa-psk" | "sae";
  psk: string;
  hidden: boolean;
}
/** Cached, signed follower facts from the main box's paired spare. */
export interface SpareFollowView {
  peerNodeId: string;
  generation: string | null;
  state: "rebuilding" | "following" | "unknown";
  appliedTXID: string | null;
  uploadedTXID: string | null;
  lagMs: number | null;
  lastAppliedAt: string | null;
  clockAt: string | null;
}
function spareFollowView(value: unknown): SpareFollowView | null {
  if (value === undefined || value === null) return null;
  const v =
    typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const unknown: SpareFollowView = {
    peerNodeId: typeof v.peerNodeId === "string" ? v.peerNodeId : "",
    generation: null,
    state: "unknown",
    appliedTXID: null,
    uploadedTXID: null,
    lagMs: null,
    lastAppliedAt: null,
    clockAt: null,
  };
  const txid = (x: unknown) => x === null || (typeof x === "string" && /^[0-9a-f]{16}$/.test(x));
  const date = (x: unknown) => x === null || (typeof x === "string" && isInstant(x));
  if (
    typeof v.peerNodeId !== "string" ||
    v.peerNodeId === "" ||
    !(
      v.generation === null ||
      (typeof v.generation === "string" &&
        /^gen-(0|[1-9][0-9]*)-[A-Za-z0-9][A-Za-z0-9-]*-[0-9]{8}T[0-9]{6}Z$/.test(v.generation))
    ) ||
    typeof v.state !== "string" ||
    !["following", "rebuilding", "unknown"].includes(v.state) ||
    !txid(v.appliedTXID) ||
    !txid(v.uploadedTXID) ||
    !date(v.lastAppliedAt) ||
    !date(v.clockAt) ||
    !(
      v.lagMs === null ||
      (typeof v.lagMs === "number" && Number.isFinite(v.lagMs) && v.lagMs >= 0)
    ) ||
    (v.state === "following" &&
      (typeof v.appliedTXID !== "string" ||
        typeof v.uploadedTXID !== "string" ||
        v.appliedTXID > v.uploadedTXID ||
        v.lagMs === null ||
        v.generation === null))
  )
    return unknown;
  return value as SpareFollowView;
}
/** Settings exchanged with the box host by the server's Box status routes. */
export interface BoxUpgradeSettingsEdit {
  revision: number;
  automatic: boolean;
  start: string | null;
  end: string | null;
}

export interface BoxUpgradeSettings extends BoxUpgradeSettingsEdit {
  version: 1;
}
export type ShutdownStatus =
  | { phase: "idle" | "checking" }
  | { phase: "ready"; checked?: false }
  | { phase: "paused"; errorCode: string }
  | { phase: "download"; name: string; bytes: number; delivered: boolean; errorCode?: string };

export type ShutdownStaffMember = { displayName: string; state: "working" | "on_break" };

export type ShutdownDecision = "retry" | "shut-down-anyway";

/** LOCAL copy of the server's `BoxHealth` (`apps/server/src/box-health.ts`). */
export interface BoxHealth {
  at: string;
  sales: { lastAt: string | null };
  notices: {
    key: string;
    code: string;
    severity: "error" | "warning" | "notice";
    params: Record<string, unknown>;
    owner: string;
  }[];
  noticesUnavailable: string[];
  filing: boolean;
  outbox: { lastAcceptedAt: string | null; waiting: number; awaitingCertificate: boolean } | null;
  stream: StreamStatusView;
  shutdown?: ShutdownStatus & { available: boolean; downloadOnly?: true; paired?: true };
  spare?: SpareFollowView | null;
  lastOfferedUpgrade?: {
    attemptId: string;
    finishedAt: string;
    fromVersion: string;
    toVersion: string;
    status: "upgraded" | "rolled-back";
  };
  clock: {
    authority:
      { state: "unknown" } | { state: "ok" | "warning"; driftSeconds: number; measuredAt: string };
    sync: { synced: boolean; source: "timedatectl" | "unavailable"; warn: boolean };
    /** Present only while the box files records and its start waits for its time. */
    waiting?: {
      boxAt: string;
      agreed: number;
      hostAnswers: boolean;
      /** Never null while the box waits. */
      cause: "start" | "future_date_refused" | "clock_jumped" | "identity_change" | null;
    };
  };
  printers: { id: string; name: string }[];
  /** Null when the payments module is off. */
  readers: { id: string; name: string }[] | null;
  canFree: boolean;
  disk: {
    freeBytes: number | null;
    totalBytes: number | null;
    databaseBytes: number | null;
    backupsBytes: number | null;
    logBytes: number | null;
    otherBytes: number | null;
    stoppedSince: string | null;
    lowSince: string | null;
    reclaimable: { bytes: number; backupRunning: boolean };
  };
}
/** LOCAL copy of the Retry now route's answer (`packages/fiscal-verifactu/src/routes.ts`). */
export interface FiscalRetryView {
  waiting: number;
}
/** LOCAL copy of `POST /api/box/clock-challenge`'s answer (`apps/server/src/box-health-api.ts`). */
export interface ClockChallengeView {
  challengeId: string;
  boxAt: string;
}
/** LOCAL copy of the answer of `POST /api/box/clock-set` and `POST /api/box/clock-confirm`
 * (`apps/server/src/box-health-api.ts`). */
export interface ClockSetView {
  confirmationId: string | null;
  stepMs: number;
  confirmedAt: string;
}
/** LOCAL copy of the server's `FreedSpace` (`apps/server/src/free-space-now.ts`). */
export interface FreedSpaceView {
  freedBytes: number;
  deleted: number;
  failed: number;
  backupRunning: boolean;
  freeBytes: number | null;
}

export interface AlertsResponse {
  visible: boolean;
  alerts: AlertView[];
}

export interface DiskStopResponse {
  stopped: boolean;
}
function diskStopFrom(body: unknown): DiskStopResponse {
  return {
    stopped:
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>)["stopped"] === true,
  };
}
// ── Card payments (providers + readers) ──────────────────────────────────────────────────────────

export interface ModuleRow {
  id: string;
  category: "module" | "card-provider";
  enabled: boolean;
  applied?: boolean;
  revision?: number;
}
/** Keep above the battery deadline in apps/server/src/alert-sources.ts; no shared constant enforces it. */
const ALERTS_READ_LIMIT_MS = 55_000;

export class ServersApi extends PrintingApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  getRecentLogs(limit = 200, level?: DiagnosticsLevel): Promise<DiagnosticsLog> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (level !== undefined) query.set("level", level);
    return this.#request<DiagnosticsLog>(`/management-api/diagnostics/recent?${query}`, "GET");
  }
  getVerbosity(): Promise<Verbosity> {
    return this.#request<Verbosity>("/management-api/diagnostics/verbosity", "GET");
  }
  setVerbosity(level: "debug" | "info", ttlMinutes: number): Promise<void> {
    return this.#request<void>("/management-api/diagnostics/verbosity", "POST", {
      level,
      ttlMinutes,
    });
  }
  // ── Servers ───────────────────────────────────────────────────────────────────────────────────

  startHandover(body: {
    operationId: string;
    destinationNodeId: string;
  }): Promise<{ handoverPage?: string }> {
    return this.#request("/management-api/handover", "POST", body);
  }
  async handoverStatus(operationId: string): Promise<{ handoverPage?: string; state: string }> {
    const response = await this.#request<{ body: { handoverPage?: string; state: string } }>(
      `/api/node/handover/${encodeURIComponent(operationId)}`,
      "GET",
      undefined,
      { passive: true },
    );
    return response.body;
  }
  async listServers(): Promise<ServerListing> {
    const listing = await this.#request<ServerListing>("/management-api/servers", "GET");
    return listing.spare === undefined
      ? listing
      : { ...listing, spare: spareFollowView(listing.spare) };
  }
  resetThisBox(signal: AbortSignal): Promise<{ setupUrl: string }> {
    return this.#request(
      "/management-api/servers/reset-this-box",
      "POST",
      { confirmation: "reset" },
      { signal },
    );
  }
  /** `removed` is false when the machine was already removed and nothing was written. */
  removeServer(
    nodeId: string,
    declarations?: { spareSwitchedOff: true; noParallelRecovery: true } | { resetStatement: true },
  ): Promise<{ removed: boolean; term: number }> {
    return this.#request(
      `/management-api/servers/${encodeURIComponent(nodeId)}/remove`,
      "POST",
      declarations,
    );
  }
  abandonServerReturn(nodeId: string): Promise<{ operationId: string; state: "return_abandoned" }> {
    return this.#request(
      `/management-api/servers/${encodeURIComponent(nodeId)}/return-abandoned`,
      "POST",
      { confirmed: true },
    );
  }
  orderServerReset(
    nodeId: string,
    acceptLoss = false,
  ): Promise<{ orderId: string; acceptLoss: boolean }> {
    return this.#request(`/management-api/servers/${encodeURIComponent(nodeId)}/reset`, "POST", {
      acceptLoss,
    });
  }
  downloadOldBoxData(nodeId: string): Promise<DownloadedFile> {
    return this.#request<DownloadedFile>(
      `/management-api/servers/${encodeURIComponent(nodeId)}/old-box-data`,
      "POST",
      undefined,
      { as: "file" },
    );
  }
  /** Needs a fresh sign-in; writes nothing. */
  checkBoxJoin(requestId: string): Promise<BoxJoinCheck> {
    return this.#request(
      `/management-api/box-joins/${encodeURIComponent(requestId)}/check`,
      "POST",
    );
  }
  dismissBoxJoin(requestId: string): Promise<void> {
    return this.#request(
      `/management-api/box-joins/${encodeURIComponent(requestId)}/dismiss`,
      "POST",
    );
  }
  /** `cleared` is false when the machine was already cleared and nothing was written. */
  clearServer(nodeId: string): Promise<{ cleared: boolean; term: number }> {
    return this.#request(`/management-api/servers/${encodeURIComponent(nodeId)}/clear`, "POST");
  }
  // ── Alerts ────────────────────────────────────────────────────────────────────────────────────

  listAlerts(): Promise<AlertsResponse> {
    return this.#request<AlertsResponse>("/management-api/alerts", "GET", undefined, {
      timeLimitMs: ALERTS_READ_LIMIT_MS,
    });
  }
  async getDiskStop(): Promise<DiskStopResponse> {
    return diskStopFrom(await this.#request<unknown>("/management-api/disk-stop", "GET"));
  }
  listHandledAlerts(): Promise<AlertsResponse> {
    return this.#request<AlertsResponse>("/management-api/alerts/handled", "GET");
  }
  markIncidentHandled(incidentId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/alerts/incidents/${encodeURIComponent(incidentId)}/handled`,
      "POST",
    );
  }
  retryFiscalSubmissions(): Promise<FiscalRetryView> {
    return this.#request<FiscalRetryView>("/management-api/fiscal-outbox/retry", "POST", {});
  }
  getBoxNetwork(): Promise<BoxNetwork> {
    return this.#request<BoxNetwork>("/api/box/network", "GET");
  }
  scanBoxNetwork(): Promise<{ networks: BoxWifiNetwork[] }> {
    return this.#request("/api/box/network/scan", "POST", {});
  }
  joinBoxNetwork(input: BoxWifiJoin): Promise<Record<string, never>> {
    return this.#request("/api/box/network/join", "POST", input);
  }
  forgetBoxNetwork(input: { ssidHex: string }): Promise<Record<string, never>> {
    return this.#request("/api/box/network/forget", "POST", input);
  }
  getBoxUpgradeSettings(): Promise<BoxUpgradeSettings> {
    return this.#request("/api/box/upgrade-settings", "GET");
  }
  saveBoxUpgradeSettings(edit: BoxUpgradeSettingsEdit): Promise<BoxUpgradeSettings> {
    return this.#request("/api/box/upgrade-settings", "POST", edit);
  }
  async getBoxHealth(): Promise<BoxHealth> {
    const health = await this.#request<BoxHealth>("/api/box/health", "GET");
    return health.spare === undefined
      ? health
      : { ...health, spare: spareFollowView(health.spare) };
  }
  clockChallenge(): Promise<ClockChallengeView> {
    return this.#request<ClockChallengeView>("/api/box/clock-challenge", "POST", {});
  }
  /** Asks the box to set its clock to this device's; `deviceAt` is this device's clock in
   * milliseconds since the epoch. */
  clockSet(input: { challengeId: string; deviceAt: number }): Promise<ClockSetView> {
    return this.#request<ClockSetView>("/api/box/clock-set", "POST", input);
  }
  /** Confirms a waiting start's time as the box shows it. */
  clockConfirm(input: { challengeId: string; asShown: true }): Promise<ClockSetView> {
    return this.#request<ClockSetView>("/api/box/clock-confirm", "POST", input);
  }
  getBoxShutdownStaff(): Promise<ShutdownStaffMember[]> {
    return this.#request("/api/box/shutdown", "GET");
  }
  startBoxShutdown(): Promise<ShutdownStatus> {
    return this.#request("/api/box/shutdown", "POST", {});
  }
  resolveBoxShutdown(decision: ShutdownDecision): Promise<ShutdownStatus> {
    return this.#request("/api/box/shutdown", "PATCH", { decision });
  }
  confirmBoxShutdownDownload(name: string): Promise<ShutdownStatus> {
    return this.#request("/api/box/shutdown", "PATCH", { decision: "backup-saved", name });
  }
  cancelBoxShutdown(): Promise<ShutdownStatus> {
    return this.#request("/api/box/shutdown", "DELETE", {});
  }
  async restartBox(): Promise<void> {
    await this.#request<Record<string, never>>("/api/box/restart", "POST", {});
  }
  freeBoxSpace(): Promise<FreedSpaceView> {
    return this.#request<FreedSpaceView>("/api/box/free-space", "POST", {});
  }
  // ── Card payments (providers + readers) ──────────────────────────────────────────────────────────

  setModuleState(
    id: string,
    enabled: boolean,
    revision: number,
  ): Promise<{ enabled: boolean; applied: boolean; revision: number }> {
    return this.#request(`/management-api/modules/${encodeURIComponent(id)}/state`, "PUT", {
      enabled,
      revision,
    });
  }
  listModules(): Promise<ModuleRow[]> {
    return this.#request<ModuleRow[]>("/management-api/modules", "GET");
  }
}
