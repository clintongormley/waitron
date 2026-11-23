import type { RecoveryOperationBinding } from "@waitron/module/src/setup-contract.js";
import type { RegisteredAddressParts } from "@waitron/country-packs";
import { firstSetupHeaders } from "./first-setup-types.js";
import type {
  FirstSetupOwner,
  FirstSetupState,
  FirstSetupOwnership,
  FirstSetupStatus,
  FirstSetupUpdate,
  FirstSetupPublicRequest,
  FirstSetupProvisionBody,
  FirstSetupInspection,
  FirstSetupResolutionSnapshot,
  StartAgainConfirm,
  StartAgainSummary,
} from "./first-setup-types.js";

// Local copies of the server's JSON shapes: a runtime import of `@waitron/provisioning` would pull
// its barrel, and `@waitron/db` through it, into the browser bundle.

export type FetchLike = typeof fetch;

export interface SetupStatus {
  installationOrigin?: "usb";
  provisioned: boolean;
  environment: "production" | "preproduction";
  developmentMode?: boolean;
  cloudSignInAvailable?: boolean;
  needs: string[];
  operationBlocked?: boolean;
  operation?: {
    id: string;
    kind: "provision" | "adopt" | "restore" | "import";
    phase:
      | "started"
      | "venue_committed"
      | "content_seeded"
      | "identity_established"
      | "membership_seeded"
      | "secret_sealed"
      | "publishing"
      | "complete";
    updatedAt: string;
  };
}

/** Sent in plain text: the server hashes `pin` and `password` (`apps/server/src/setup-api.ts`). */
export interface AdminDraft {
  firstNames: string;
  lastNames: string;
  displayName: string;
  email: string;
  pin: string;
  password: string;
}

export interface VenueDraft {
  country: string;
  taxId: string;
  legalName: string;
  taxpayerDomicile: string | null;
  seriesCode: string;
  fullSeriesCode: string;
  correctiveSeriesCode: string;
  admin: AdminDraft;
  name: string;
  fiscalTerritory: string;
  invoiceLocales: string[];
  staffLanguage?: "en" | "es";
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  province: string;
  timeZone: string;
  dayCutover: string;
}

export interface AeatCertDraft {
  pfxBase64: string;
  passphrase: string;
  certKind: "sello" | "representante";
}

export interface EmailSettingsDraft {
  server: string;
  port: number;
  encryption: "starttls" | "tls";
  user: string;
  password: string;
  from: string;
}

export const SMTP_TEST_CODES = [
  "email.test_host_not_found",
  "email.test_connection_refused",
  "email.test_starttls_refused",
  "email.test_tls_refused",
  "email.test_certificate_untrusted",
  "email.test_login_refused",
  "email.test_login_required",
  "email.test_timeout",
  "email.test_refused",
] as const;
export type SmtpTestCode = (typeof SMTP_TEST_CODES)[number];

export type EmailTestResult = { accepted: true } | { accepted: false; code: SmtpTestCode };

/** The registered address as the venue form holds it. Kept in the draft so Back keeps line 2, and
 * never sent: the server takes the joined `venue.taxpayerDomicile`. */
export interface RegisteredAddressDraft extends RegisteredAddressParts {
  sameAsVenue: boolean;
}

export interface ProvisionBody {
  demoVenueNameSource?: "automatic" | "custom";
  registeredAddress?: RegisteredAddressDraft;
  mode: "demo" | "prepare" | "live";
  firstSetup?: { attemptId: string; revision: number };
  configurationImport?: boolean;
  /** Only with `configurationImport`: the venue takes a different tax ID from the export's. */
  newTaxpayer?: boolean;
  venue: VenueDraft;
  /** Omitted, not `null`, when no certificate is expected: the server refuses any value it is sent. */
  aeatCert?: AeatCertDraft;
  email?: EmailSettingsDraft;
  cloudStaffEmail?: boolean;
  errorReportsEnabled?: boolean;
}

export interface ProvisionResult {
  provisioned: true;
  restarting: true;
  recoveryPackPdf?: string;
  breakGlassSecret?: string;
  breakGlassKeyName?: string;
  breakGlassKeyInBackups?: true;
  cloudStaffEmailUnavailable?: true;
}

export interface AdoptOutcome {
  adopted: true;
  /** The offline promote fallback. The server returns it once, so the wizard must show it before
   * the box restarts. */
  breakGlassSecret?: string;
  breakGlassKeyName?: string;
  restarting: true;
}

/** A join's code as the new box first shows it, with the handle that keeps it on this tab. */
export interface JoinStarted {
  code: string;
  addresses: string[];
  /** Measured on the new box's own clock when it answered; the browser's clock plays no part. */
  timeLeftMs: number;
  handle: string;
}

/**
 * `elsewhere`: another page holds this box's join; `replaced`: this page's handle no longer counts.
 * `reason` and `error` are kept as strings: a newer server may send one this page does not know.
 */
export type JoinState =
  | { state: "none" }
  | { state: "elsewhere" }
  | { state: "replaced" }
  | { state: "waiting"; code: string; addresses: string[]; primaryUrl: string; timeLeftMs: number }
  | { state: "approved"; code: string }
  | { state: "ended"; reason: string }
  | { state: "failed"; error: string };

export interface ResetOutcome {
  resetStaged: true;
  restarting: true;
}

export interface RestoreOutcome {
  restoreStaged: true;
  restarting: true;
}

export interface RecoveryRestoreCredentials {
  recoveryOperation: {
    binding: {
      module: string;
      action: string;
      eventId: string;
      sourceId: string;
      targetNodeId: string;
    };
    input: unknown;
  };
  nodeRecoverySecret: string;
  recoveryContext?: {
    selectedSourceId: string;
    oldBoxGone: boolean;
    soleRecovery: boolean;
  };
}

export interface RecoveryPreparationRequest {
  binding: RecoveryRestoreCredentials["recoveryOperation"]["binding"];
  context: NonNullable<RecoveryRestoreCredentials["recoveryContext"]>;
  nodeRecoverySecret: string;
  proposal: unknown;
}
export type RecoveryPreparationSource =
  | {
      kind: "archive";
      artifact: Blob;
      recoveryKey: string;
      environment: "production" | "preproduction";
    }
  | { kind: "bucket"; kit: string; environment: "production" | "preproduction" }
  | { kind: "cloud"; pointId: string }
  | { kind: "staged"; stagedId: string };

export interface BucketRestoreBody extends RecoveryRestoreCredentials {
  /**
   * The recovery kit as pasted, read from its file, or read from a recovery pack PDF's attached
   * file; as sensitive as the recovery key.
   */
  kit: string;
  environment: "production" | "preproduction";
  oldBoxGone: boolean;
  venueConfirmed: string | null;
}

export interface CloudRecoveryView {
  requestId: string;
  code: string;
  openCloudUrl: string;
  expiresAt: string;
  state: "awaiting_owner" | "approved" | "expired";
  point?: { id: string; venueId: string; capturedAt: string; modules: Record<string, number> };
}

export interface RecoveryBackupPreview {
  readonly fiscalSelection?: {
    readonly module: string;
    readonly country: string;
    readonly fiscalTerritory: string;
    readonly timeZone: string;
  };
  readonly activationSourceId?: string;
  sourceId: string;
  createdAt: string;
  environment: "production" | "preproduction";
  nodeId: string;
  nodeRecoveryKeyName: string | null;
  taxpayer: { legalName: string; taxId: string };
  venueName: string;
}

export const PREVIEW_NULLABLE_VENUE_FIELDS = [
  "addressLine1",
  "postalCode",
  "city",
  "province",
] as const satisfies readonly (keyof VenueDraft)[];
type PreviewNullableVenueField = (typeof PREVIEW_NULLABLE_VENUE_FIELDS)[number];

export interface ConfigurationPreview {
  venue: Omit<VenueDraft, "admin" | PreviewNullableVenueField> &
    Record<PreviewNullableVenueField, string | null>;
  modules: string[];
  reconnectModules: string[];
}

export type FiscalReadinessResult =
  | {
      status: "accepted" | "rejected" | "uncertain";
      testedAt?: string;
      rejections?: { code: string | null; message: string | null }[];
    }
  | { status: "not-applicable" };

export interface ApiError {
  code: string;
  /** `setup.request_invalid` and `venue.detail_invalid` name the refused field in `params.field`. */
  params?: Record<string, unknown>;
  /**
   * Set only when the server answered: `fetch` rejects when nothing is reachable. The wizard uses
   * it to tell a box that answered from one it could not reach.
   */
  status?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const joinHeaders = (handle: string | undefined): Record<string, string> =>
  handle === undefined ? {} : { "x-waitron-join-handle": handle };

/**
 * The body is untrusted: a failed response need not carry our envelope, may not be JSON, or may be
 * a literal `null`, which parses. Nothing about it may throw here, or the `status` is lost.
 */
async function apiError(res: Response): Promise<ApiError> {
  const parsed: unknown = await res.json().catch(() => undefined);
  const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
  const code = envelope?.code;
  const params = envelope?.params;
  return {
    code: typeof code === "string" ? code : "server.internal",
    params: isRecord(params) ? params : undefined,
    status: res.status,
  };
}

async function upload(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw { code: "restore.upload_interrupted" } satisfies ApiError;
  }
  if (response.status === 408)
    throw { code: "restore.upload_interrupted", status: 408 } satisfies ApiError;
  return response;
}

const JOIN_COPY_STAGES = ["waiting", "restoring", "ready"] as const;
export type JoinCopyStage = (typeof JOIN_COPY_STAGES)[number];

export interface HandoverStatus {
  operationId: string;
  role: "source" | "destination";
  scenario: "controlled" | "emergency";
  state: string;
  sourceNodeId: string;
  destinationNodeId: string;
  waitingReason: string | null;
  timeZone: string;
  handoverPage?: string;
  copyPlaced?: boolean;
}
/** Left out on an emergency step when the switch's proof cookie stands in. */
export type HandoverSignIn =
  { email: string; password: string; totp?: string } | { passkey: unknown };

export interface EmergencyHandoverPreview {
  sourceNodeId: string;
  destinationNodeId: string;
  sourceServersUrl: string;
  copy: (
    { source: "mirror-copy" } | { source: "selected-backup" | "followed-copy"; sourceId: string }
  ) & {
    identifier: string;
    lastChangeAtMs: number | null;
  };
  /** When this spare finished joining; null when it is not a joined spare. */
  joinedAtMs: number | null;
  operation: { operationId: string; reason: string | null; declaredAtMs: number | null } | null;
}
export interface FollowedCopyTake {
  state: "restarting" | "catching-up" | "taken";
}
export interface EmergencyHandoverDeclaration {
  operationId: string;
  expectedCopy: EmergencyHandoverPreview["copy"];
  signIn: HandoverSignIn | undefined;
  statements: { sourceSwitchedOff: true; noParallelRecovery: true; missingTailAccepted: true };
  reason: string;
  locale: "en" | "es";
}

/** What the box's watch for another box answering the venue's name last found. */
export type VenueNameState = "other-box-answers" | "no-other-box" | "not-asked" | "ask-failed";

export class SetupApi {
  readonly #baseUrl: string;
  /**
   * Read into a local before calling, so it is called as a free function: called as a method of
   * `this`, the browser's native `fetch` throws "Illegal invocation".
   */
  readonly #fetchImpl: FetchLike;

  constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetchImpl = fetchImpl;
  }

  async handoverStatus(operationId: string, signal?: AbortSignal): Promise<HandoverStatus> {
    const fetchImpl = this.#fetchImpl;
    const response = await fetchImpl(
      this.#baseUrl + `/api/node/handover/${encodeURIComponent(operationId)}`,
      {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        signal,
      },
    );
    if (!response.ok) throw await apiError(response);
    return ((await response.json()) as { body: HandoverStatus }).body;
  }

  /**
   * The main server's own address, from the chart this spare holds; `null` when it names none. With
   * how long the spare has found it silent, by the spare's clock; `null` when it does not know.
   */
  async mainServer(
    signal?: AbortSignal,
  ): Promise<{ mainUrl: string | null; silentForMs: number | null }> {
    const fetchImpl = this.#fetchImpl;
    const response = await fetchImpl(this.#baseUrl + "/api/node/main", {
      method: "GET",
      credentials: "include",
      signal,
    });
    if (!response.ok) throw await apiError(response);
    const body = (await response.json()) as { mainUrl: string | null; silentForMs?: unknown };
    return {
      mainUrl: body.mainUrl,
      silentForMs:
        Number.isSafeInteger(body.silentForMs) && (body.silentForMs as number) >= 0
          ? (body.silentForMs as number)
          : null,
    };
  }

  /** This box's standing in the chart it holds, from its role probe; `null` when the answer names none. */
  async nodeStanding(signal: AbortSignal): Promise<string | null> {
    const fetchImpl = this.#fetchImpl;
    const response = await fetchImpl(this.#baseUrl + "/api/node", {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw await apiError(response);
    const body = (await response.json()) as { standing?: unknown };
    return typeof body.standing === "string" ? body.standing : null;
  }

  /**
   * Where the first copy has got to, from the status a box still joining answers
   * (`mountLatchBoxStatus`); `null` for any other successful answer; rejects on a refusal.
   */
  async joinCopyStage(signal: AbortSignal): Promise<JoinCopyStage | null> {
    const fetchImpl = this.#fetchImpl;
    const response = await fetchImpl(this.#baseUrl + "/api/box/status", {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw await apiError(response);
    const body: unknown = await response.json();
    if (!isRecord(body) || body.adoption !== "pending") return null;
    return (JOIN_COPY_STAGES as readonly unknown[]).includes(body.copy)
      ? (body.copy as JoinCopyStage)
      : null;
  }

  /** Resolves once the main server answers at all: a `no-cors` answer is opaque, and still an answer. */
  async probeMain(mainUrl: string, signal: AbortSignal): Promise<void> {
    const fetchImpl = this.#fetchImpl;
    await fetchImpl(new URL("/api/node", mainUrl).href, {
      mode: "no-cors",
      cache: "no-store",
      signal,
    });
  }

  previewEmergencyHandover(signIn: HandoverSignIn | undefined): Promise<EmergencyHandoverPreview> {
    return this.#request("/api/node/handover/emergency/preview", "POST", { signIn });
  }

  /** WebAuthn sign-in options for one emergency step; the spare keeps the challenge two minutes. */
  switchPasskeyChallenge(): Promise<{ options: unknown }> {
    return this.#request("/api/node/handover/emergency/passkey-challenge", "POST");
  }

  takeFollowedCopy(signIn: HandoverSignIn | undefined): Promise<FollowedCopyTake> {
    return this.#request("/api/node/handover/emergency/followed", "POST", { signIn });
  }

  async selectEmergencyBackup(
    artifact: File,
    signIn: HandoverSignIn | undefined,
    recoveryKey?: string,
  ): Promise<void> {
    const body = new FormData();
    body.append(
      "request",
      JSON.stringify({ signIn, ...(recoveryKey === undefined ? {} : { recoveryKey }) }),
    );
    body.append("artifact", artifact);
    const fetchImpl = this.#fetchImpl;
    const response = await fetchImpl(this.#baseUrl + "/api/node/handover/emergency/backup", {
      method: "POST",
      credentials: "include",
      body,
    });
    if (!response.ok) throw await apiError(response);
  }

  declareEmergencyHandover(
    request: EmergencyHandoverDeclaration,
  ): Promise<{ declaration: { body: { declaredAtMs: number } } }> {
    return this.#request("/api/node/handover/emergency/declare", "POST", request);
  }

  prepareHandover(
    operationId: string,
    signIn: HandoverSignIn | undefined,
    binding: RecoveryOperationBinding,
    proposal: unknown,
  ): Promise<unknown> {
    return this.#request(
      `/api/node/handover/${encodeURIComponent(operationId)}/preparation`,
      "POST",
      {
        signIn,
        moduleOperation: { binding, input: null },
        proposal,
      },
    );
  }

  activateHandover(
    operationId: string,
    signIn: HandoverSignIn | undefined,
    moduleOperation: { binding: RecoveryOperationBinding; input: unknown },
  ): Promise<{ activated: true; restarting: boolean }> {
    return this.#request(`/api/node/handover/${encodeURIComponent(operationId)}/activate`, "POST", {
      signIn,
      moduleOperation,
    });
  }

  getDiscovery(): Promise<{
    caDownloadAvailable: boolean;
    hostnameUrl?: string;
    ipUrls?: string[];
    venueName?: VenueNameState;
  }> {
    return this.#request("/setup-api/discovery", "GET");
  }

  /** A route of the waiting app a restore's start serves while it waits to confirm its time. */
  restoreClock<T>(
    route: "challenge" | "compare" | "confirm" | "set",
    body: Record<string, unknown>,
  ): Promise<T> {
    return this.#request<T>(`/restore-clock/${route}`, "POST", body);
  }

  getStatus(): Promise<SetupStatus> {
    return this.#request<SetupStatus>("/setup-api/status", "GET");
  }

  startCloudSignIn(
    tab: string,
    admin: Partial<AdminDraft>,
  ): Promise<{ authorizationUrl?: string }> {
    return this.#request("/setup-api/cloud/sign-in/start", "POST", {
      tab,
      prepare: true,
      admin,
    });
  }

  cloudAddressLookup(
    tab: string,
    operation:
      | { kind: "available" }
      | { kind: "suggest"; workflowId: string; query: string; language: "en" | "es" }
      | { kind: "validate"; workflowId: string; selectedText: string },
  ): Promise<{
    available?: boolean;
    candidates?: { text: string }[];
    fields?: {
      addressLine1: string;
      addressLine2: string | null;
      postalCode: string;
      city: string;
      province: string;
      countryCode: "ES";
    };
  }> {
    return this.#request("/setup-api/cloud/sign-in/address-lookup", "POST", { tab, ...operation });
  }

  /** Answered only by the page a box shows when its start failed (`recovery-surface.ts`). */
  getRecoveryStatus(): Promise<unknown> {
    return this.#request<unknown>("/recovery-api/status", "GET");
  }

  /**
   * The server takes the admin account's language from `Accept-Language`, so `locale` is sent there
   * only when the operator chose one; otherwise the browser's own header stands.
   */
  provision(
    body: ProvisionBody,
    locale?: string,
    recoveryPackLocale?: string,
    cloudSignInTab?: string,
  ): Promise<ProvisionResult> {
    return this.#request<ProvisionResult>("/setup-api/provision", "POST", body, {
      ...(locale === undefined ? {} : { "accept-language": locale }),
      ...(recoveryPackLocale === undefined
        ? {}
        : { "x-waitron-recovery-pack-locale": recoveryPackLocale }),
      ...(cloudSignInTab === undefined ? {} : { "X-Waitron-Setup-Cloud-Tab": cloudSignInTab }),
    });
  }

  startJoin(primaryUrl: string, handle: string | undefined): Promise<JoinStarted> {
    return this.#request("/setup-api/join/start", "POST", { primaryUrl }, joinHeaders(handle));
  }

  joinState(handle: string | undefined): Promise<JoinState> {
    return this.#request("/setup-api/join", "GET", undefined, joinHeaders(handle));
  }

  cancelJoin(handle: string | undefined): Promise<void> {
    return this.#request("/setup-api/join/cancel", "POST", {}, joinHeaders(handle));
  }

  /** Finish joining: the server reads nothing from the body, so every resend is the same request. */
  finishJoin(handle: string | undefined): Promise<AdoptOutcome> {
    return this.#request("/setup-api/adopt", "POST", {}, joinHeaders(handle));
  }

  resetIncompleteAdopt(): Promise<ResetOutcome> {
    return this.#request<ResetOutcome>("/setup-api/reset-incomplete-adopt", "POST");
  }

  startCloudRecovery(): Promise<CloudRecoveryView> {
    return this.#request("/setup-api/cloud-recovery/start", "POST", {});
  }

  cloudRecoveryStatus(): Promise<CloudRecoveryView> {
    return this.#request("/setup-api/cloud-recovery/status", "GET");
  }

  startCloudRecoveryAgain(): Promise<CloudRecoveryView> {
    return this.#request("/setup-api/cloud-recovery/start-again", "POST", {});
  }

  /** `oldBoxGone` answers `restore.stream_source_live`/`restore.stream_source_unchecked`. */
  restoreFromCloud(
    pointId: string,
    oldBoxGone: boolean,
    recovery: RecoveryRestoreCredentials,
  ): Promise<RestoreOutcome> {
    return this.#request("/setup-api/cloud-recovery/restore", "POST", {
      pointId,
      ...(oldBoxGone ? { oldBoxGone } : {}),
      ...recovery,
    });
  }

  /** `oldBoxGone` answers `restore.stream_source_live`/`restore.stream_source_unchecked`. */
  async restore(
    artifact: Blob,
    recoveryKey: string,
    environment: "production" | "preproduction",
    oldBoxGone: boolean,
    recovery: RecoveryRestoreCredentials,
  ): Promise<RestoreOutcome> {
    const form = new FormData();
    form.set("artifact", artifact, "backup.waitron");
    form.set("recoveryKey", recoveryKey);
    form.set("environment", environment);
    form.set("oldBoxGone", oldBoxGone ? "1" : "0");
    form.set("recoveryOperation", JSON.stringify(recovery.recoveryOperation));
    form.set("nodeRecoverySecret", recovery.nodeRecoverySecret);
    if (recovery.recoveryContext !== undefined)
      form.set("recoveryContext", JSON.stringify(recovery.recoveryContext));
    const res = await upload(this.#fetchImpl, this.#baseUrl + "/setup-api/restore", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) throw await apiError(res);
    return JSON.parse(await res.text()) as RestoreOutcome;
  }

  previewBucketRestore(
    kit: string,
    environment: "production" | "preproduction",
    oldBoxGone = false,
  ): Promise<RecoveryBackupPreview> {
    return this.#request("/setup-api/restore-bucket/preview", "POST", {
      kit,
      environment,
      oldBoxGone,
    });
  }
  async prepareRecovery(
    source: RecoveryPreparationSource,
    preparation: RecoveryPreparationRequest,
  ): Promise<unknown> {
    if (source.kind !== "archive")
      return this.#request("/setup-api/recovery/preparation", "POST", { source, preparation });
    const { artifact, ...metadata } = source;
    const form = new FormData();
    form.set("request", JSON.stringify({ source: metadata, preparation }));
    form.set("artifact", artifact);
    const fetchImpl = this.#fetchImpl;
    const response = await fetchImpl(this.#baseUrl + "/setup-api/recovery/preparation", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!response.ok) throw await apiError(response);
    return response.json() as Promise<unknown>;
  }

  /** Checks the backup once on the box, so the clock requests that follow carry only its id. */
  async stageRecovery(
    artifact: Blob,
    recoveryKey: string,
    environment: "production" | "preproduction",
    eventId: string,
  ): Promise<{ stagedId: string }> {
    const form = new FormData();
    form.set(
      "request",
      JSON.stringify({ eventId, source: { kind: "archive", recoveryKey, environment } }),
    );
    form.set("artifact", artifact);
    const response = await upload(this.#fetchImpl, this.#baseUrl + "/setup-api/recovery/stage", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!response.ok) throw await apiError(response);
    return (await response.json()) as { stagedId: string };
  }

  discardStagedRecovery(stagedId: string): Promise<{ discarded: true }> {
    return this.#request("/setup-api/recovery/stage/discard", "POST", { stagedId });
  }

  previewCloudRestore(pointId: string): Promise<RecoveryBackupPreview> {
    return this.#request("/setup-api/cloud-recovery/preview", "POST", { pointId });
  }

  async previewRestore(
    artifact: Blob,
    recoveryKey: string,
    environment: "production" | "preproduction",
  ): Promise<RecoveryBackupPreview> {
    const fetchImpl = this.#fetchImpl;
    const response = await upload(fetchImpl, this.#baseUrl + "/setup-api/restore/preview", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-recovery-key": recoveryKey,
        "x-waitron-restore-environment": environment,
      },
      body: artifact,
    });
    if (!response.ok) throw await apiError(response);
    return (await response.json()) as RecoveryBackupPreview;
  }

  /** `POST /setup-api/restore-bucket` — check the owner's bucket and stage a rebuild from it.
   * `restore.stream_source_live` carries `params.lastChangeAt`, and
   * `restore.stream_venue_unconfirmed` the restored copy's names. The route's `venueConfirmed` is
   * optional, so no confirmation is left out rather than sent as `null`. */
  restoreFromBucket(body: BucketRestoreBody): Promise<RestoreOutcome> {
    const { venueConfirmed, ...rest } = body;
    return this.#request<RestoreOutcome>(
      "/setup-api/restore-bucket",
      "POST",
      venueConfirmed === null ? rest : { ...rest, venueConfirmed },
    );
  }

  async stageConfiguration(artifact: Blob, passphrase: string): Promise<ConfigurationPreview> {
    const fetchImpl = this.#fetchImpl;
    const res = await fetchImpl(this.#baseUrl + "/setup-api/configuration", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-export-passphrase": passphrase,
      },
      body: artifact,
    });
    if (!res.ok) throw await apiError(res);
    return JSON.parse(await res.text()) as ConfigurationPreview;
  }

  runEmailTest(
    email: EmailSettingsDraft,
    adminEmail: string,
    mode: "live" | "prepare" = "live",
  ): Promise<EmailTestResult> {
    return this.#request<EmailTestResult>("/setup-api/email-test", "POST", {
      mode,
      email,
      venue: { admin: { email: adminEmail } },
    });
  }

  runFiscalTest(body: ProvisionBody): Promise<FiscalReadinessResult> {
    return this.#request<FiscalReadinessResult>("/setup-api/fiscal-test", "POST", body);
  }

  firstSetupOfferings(
    fiscalTerritory: string,
  ): Promise<{ modules: { module: string; version: string }[] }> {
    return this.#request("/setup-api/first-setup/offerings", "POST", { fiscalTerritory });
  }

  firstSetupStatus(owner?: FirstSetupOwner): Promise<FirstSetupStatus> {
    return this.#request(
      "/setup-api/first-setup/status",
      "GET",
      undefined,
      owner === undefined ? {} : firstSetupHeaders(owner),
    );
  }

  claimFirstSetup(
    venue: ProvisionBody["venue"],
    locale?: string,
    intent?: Pick<ProvisionBody, "configurationImport" | "newTaxpayer">,
    cloudAdminTab?: string,
  ): Promise<FirstSetupOwnership> {
    return this.#request(
      "/setup-api/first-setup/claim",
      "POST",
      { venue, ...intent },
      {
        ...(locale === undefined ? {} : { "accept-language": locale }),
        ...(cloudAdminTab === undefined ? {} : { "X-Waitron-Setup-Cloud-Tab": cloudAdminTab }),
      },
    );
  }

  inspectFirstSetupResolution(): Promise<FirstSetupInspection> {
    return this.#request("/setup-api/first-setup/resolution", "GET");
  }

  startAgainSummary(snapshot: FirstSetupResolutionSnapshot): Promise<StartAgainSummary> {
    return this.#request("/setup-api/first-setup/resolution/start-again/summary", "POST", snapshot);
  }

  stopFirstSetup(snapshot: FirstSetupResolutionSnapshot): Promise<{ restarting: true }> {
    return this.#request("/setup-api/first-setup/resolution/stop", "POST", snapshot);
  }

  startAgainFirstSetup(
    snapshot: FirstSetupResolutionSnapshot,
    confirm: StartAgainConfirm = {},
  ): Promise<{ restarting: true }> {
    return this.#request("/setup-api/first-setup/resolution/start-again", "POST", {
      ...snapshot,
      ...confirm,
    });
  }

  reconfirmFirstSetup(
    owner: FirstSetupOwner,
    password: string,
    purpose: "block-use" | "activation",
  ): Promise<{ reconfirmation: string }> {
    return this.#request(
      "/setup-api/first-setup/reconfirm",
      "POST",
      { password, purpose },
      firstSetupHeaders(owner),
    );
  }

  firstSetupPreparation(
    owner: FirstSetupOwner,
    module: string,
    proposal: unknown,
  ): Promise<{ state: FirstSetupState; preparation: unknown }> {
    return this.#request(
      "/setup-api/first-setup/preparation",
      "POST",
      { module, proposal },
      firstSetupHeaders(owner),
    );
  }

  firstSetupCandidates(
    owner: FirstSetupOwner,
    module: string,
    proposal: unknown,
    reconfirmation: string,
  ): Promise<FirstSetupUpdate & { preparation?: unknown }> {
    return this.#request(
      "/setup-api/first-setup/candidates",
      "POST",
      { module, proposal, reconfirmation },
      firstSetupHeaders(owner),
    );
  }

  reissueFirstSetupNodeKey(
    owner: FirstSetupOwner,
    password: string,
  ): Promise<import("@waitron/module/src/setup-contract.js").InitialSetupNodeKey> {
    return this.#request(
      "/setup-api/first-setup/node-key-reissue",
      "POST",
      { password },
      firstSetupHeaders(owner),
    );
  }

  firstSetupNodeKey(
    owner: FirstSetupOwner,
    reconfirmation: string,
  ): Promise<import("@waitron/module/src/setup-contract.js").InitialSetupNodeKey> {
    return this.#request(
      "/setup-api/first-setup/node-key",
      "POST",
      { reconfirmation },
      firstSetupHeaders(owner),
    );
  }
  firstSetupRecoveryDocument(
    owner: FirstSetupOwner,
    module: string,
    reference: import("@waitron/module/src/setup-contract.js").InitialSetupRecoveryReference & {
      statement: unknown;
    },
  ): Promise<{ accepted: true }> {
    return this.#request(
      "/setup-api/first-setup/recovery-document",
      "POST",
      { ...reference, module },
      firstSetupHeaders(owner),
    );
  }
  firstSetupRecoveryDocumentKept(
    owner: FirstSetupOwner,
    module: string,
    reference: import("@waitron/module/src/setup-contract.js").InitialSetupRecoveryReference,
    reconfirmation: string,
  ): Promise<{ accepted: true }> {
    return this.#request(
      "/setup-api/first-setup/recovery-document-kept",
      "POST",
      { ...reference, module, kept: true, reconfirmation },
      firstSetupHeaders(owner),
    );
  }
  firstSetupRequest(owner: FirstSetupOwner): Promise<FirstSetupPublicRequest> {
    return this.#request(
      "/setup-api/first-setup/request",
      "GET",
      undefined,
      firstSetupHeaders(owner),
    );
  }

  firstSetupImport(
    owner: FirstSetupOwner,
    module: string,
    input: unknown,
  ): Promise<FirstSetupUpdate> {
    return this.#request(
      "/setup-api/first-setup/input",
      "POST",
      { module, input },
      firstSetupHeaders(owner),
    );
  }

  firstSetupEnrol(
    owner: FirstSetupOwner,
    module: string,
    publicKey: unknown,
    comparison: unknown,
  ): Promise<FirstSetupUpdate> {
    return this.#request(
      "/setup-api/first-setup/enrol",
      "POST",
      { module, publicKey, comparison },
      firstSetupHeaders(owner),
    );
  }

  firstSetupConfirm(
    owner: FirstSetupOwner,
    module: string,
    statement: unknown,
    reconfirmation: string,
  ): Promise<FirstSetupUpdate> {
    return this.#request(
      "/setup-api/first-setup/current-master",
      "POST",
      { module, statement, reconfirmation },
      firstSetupHeaders(owner),
    );
  }

  abandonFirstSetup(owner: FirstSetupOwner): Promise<FirstSetupUpdate> {
    return this.#request("/setup-api/first-setup/abandon", "POST", {}, firstSetupHeaders(owner));
  }

  runFirstSetupEmailTest(
    owner: FirstSetupOwner,
    email: EmailSettingsDraft,
  ): Promise<EmailTestResult> {
    return this.#request("/setup-api/email-test", "POST", { email }, firstSetupHeaders(owner));
  }

  runFirstSetupFiscalTest(
    owner: FirstSetupOwner,
    body: FirstSetupProvisionBody,
  ): Promise<FiscalReadinessResult> {
    return this.#request("/setup-api/fiscal-test", "POST", body, firstSetupHeaders(owner));
  }

  provisionFirstSetup(
    owner: FirstSetupOwner,
    body: FirstSetupProvisionBody,
    locale?: string,
    cloudSignInTab?: string,
  ): Promise<ProvisionResult> {
    return this.#request("/setup-api/provision", "POST", body, {
      ...firstSetupHeaders(owner),
      ...(locale === undefined ? {} : { "accept-language": locale }),
      ...(cloudSignInTab === undefined ? {} : { "X-Waitron-Setup-Cloud-Tab": cloudSignInTab }),
    });
  }

  async #request<T>(
    path: string,
    method: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const fetchImpl = this.#fetchImpl;
    const init: RequestInit =
      body === undefined
        ? {
            method,
            credentials: "include",
            ...(Object.keys(headers).length === 0 ? {} : { headers }),
          }
        : {
            method,
            credentials: "include",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(body),
          };
    const res = await fetchImpl(this.#baseUrl + path, init);
    if (!res.ok) throw await apiError(res);
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }
}
