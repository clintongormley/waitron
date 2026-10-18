import { firstSetupHeaders } from "./first-setup-types.js";
import type {
  FirstSetupOwner,
  FirstSetupState,
  FirstSetupOwnership,
  FirstSetupStatus,
  FirstSetupUpdate,
  FirstSetupPublicRequest,
  FirstSetupProvisionBody,
} from "./first-setup-types.js";

// Local copies of the server's JSON shapes: a runtime import of `@waitron/provisioning` would pull
// its barrel, and `@waitron/db` through it, into the browser bundle.

export type FetchLike = typeof fetch;

export type VenueDefaults = Readonly<Record<string, { readonly operationDescription: string }>>;

export interface SetupStatus {
  provisioned: boolean;
  environment: "production" | "preproduction";
  developmentMode?: boolean;
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

export interface LocationDraft {
  name: string;
  fiscalTerritory: string;
  invoiceLocales: string[];
  operationDescription: string;
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

export type EmailTestResult =
  { accepted: true } | { accepted: false; code: "email.test_refused" | "email.test_timeout" };

export interface ProvisionBody {
  mode: "demo" | "prepare" | "live";
  firstSetup?: { attemptId: string; revision: number };
  configurationImport?: boolean;
  /** Only with `configurationImport`: the venue takes a different tax ID from the export's. */
  newTaxpayer?: boolean;
  venue: {
    country: string;
    taxId: string;
    legalName: string;
    taxpayerDomicile: string | null;
    location: LocationDraft;
    seriesCode: string;
    fullSeriesCode: string;
    rectificativeSeriesCode: string;
    admin: AdminDraft;
  };
  /** Omitted, not `null`, when no certificate is expected: the server refuses any value it is sent. */
  aeatCert?: AeatCertDraft;
  email?: EmailSettingsDraft;
}

export interface ProvisionResult {
  provisioned: true;
  restarting: true;
  openingHours?: { departmentId: string };
}

export interface AdoptBody {
  primaryUrl: string;
  /** `totp` is omitted, not `""`, when blank: the server refuses an empty string. */
  credential: { personId: string; password: string; totp?: string };
}

export interface AdoptOutcome {
  adopted: true;
  /** The offline promote fallback. The server returns it once, so the wizard must show it before
   * the box restarts. */
  breakGlassSecret: string;
  breakGlassKeyName?: string;
  restarting: true;
}

/** The admin login used on the connect screen for the join that stopped partway. */
export interface ResetCredential {
  personId: string;
  password: string;
}

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

export interface BucketRestoreBody {
  /** The recovery kit as pasted or read from its file; as sensitive as the recovery key. */
  kit: string;
  environment: "production" | "preproduction";
  oldBoxGone: boolean;
  venueConfirmed: string | null;
  recoveryOperation?: RecoveryRestoreCredentials["recoveryOperation"];
  nodeRecoverySecret?: string;
  recoveryContext?: RecoveryRestoreCredentials["recoveryContext"];
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
  readonly activationSourceId?: string;
  sourceId: string;
  createdAt: string;
  environment: "production" | "preproduction";
  nodeId: string;
  nodeRecoveryKeyName: string | null;
  taxpayer: { legalName: string; taxId: string };
  locationName: string;
}

export interface ConfigurationPreview {
  venue: Omit<ProvisionBody["venue"], "admin"> & {
    location: ProvisionBody["venue"]["location"] & { id: string };
  };
  counts: Record<string, number>;
  reconnect: string[];
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
  /** `setup.request_invalid` names the refused field in `params.field`. */
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

  getDiscovery(): Promise<{ caDownloadAvailable: boolean }> {
    return this.#request("/setup-api/discovery", "GET");
  }

  getVenueDefaults(): Promise<VenueDefaults> {
    return this.#request<VenueDefaults>("/setup-api/venue-defaults", "GET");
  }

  getStatus(): Promise<SetupStatus> {
    return this.#request<SetupStatus>("/setup-api/status", "GET");
  }

  /**
   * The server takes the admin account's language from `Accept-Language`, so `locale` is sent there
   * only when the operator chose one; otherwise the browser's own header stands.
   */
  provision(body: ProvisionBody, locale?: string): Promise<ProvisionResult> {
    return this.#request<ProvisionResult>(
      "/setup-api/provision",
      "POST",
      body,
      locale === undefined ? {} : { "accept-language": locale },
    );
  }

  adopt(body: AdoptBody): Promise<AdoptOutcome> {
    return this.#request<AdoptOutcome>("/setup-api/adopt", "POST", body);
  }

  resetIncompleteAdopt(credential: ResetCredential): Promise<ResetOutcome> {
    return this.#request<ResetOutcome>("/setup-api/reset-incomplete-adopt", "POST", credential);
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
    oldBoxGone = false,
    recovery?: RecoveryRestoreCredentials,
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
    oldBoxGone = false,
    recovery?: RecoveryRestoreCredentials,
  ): Promise<RestoreOutcome> {
    const fetchImpl = this.#fetchImpl;
    let body: Blob | FormData = artifact;
    if (recovery !== undefined) {
      const form = new FormData();
      form.set("artifact", artifact, "backup.waitron");
      form.set("recoveryKey", recoveryKey);
      form.set("environment", environment);
      form.set("oldBoxGone", oldBoxGone ? "1" : "0");
      form.set("recoveryOperation", JSON.stringify(recovery.recoveryOperation));
      form.set("nodeRecoverySecret", recovery.nodeRecoverySecret);
      if (recovery.recoveryContext !== undefined)
        form.set("recoveryContext", JSON.stringify(recovery.recoveryContext));
      body = form;
    }
    const res = await fetchImpl(this.#baseUrl + "/setup-api/restore", {
      method: "POST",
      credentials: "include",
      ...(recovery === undefined
        ? {
            headers: {
              "content-type": "application/octet-stream",
              "x-waitron-recovery-key": recoveryKey,
              "x-waitron-restore-environment": environment,
              ...(oldBoxGone ? { "x-waitron-old-box-gone": "1" } : {}),
            },
          }
        : {}),
      body,
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
  previewCloudRestore(pointId: string): Promise<RecoveryBackupPreview> {
    return this.#request("/setup-api/cloud-recovery/preview", "POST", { pointId });
  }

  async previewRestore(
    artifact: Blob,
    recoveryKey: string,
    environment: "production" | "preproduction",
  ): Promise<RecoveryBackupPreview> {
    const fetchImpl = this.#fetchImpl;
    const response = await fetchImpl(this.#baseUrl + "/setup-api/restore/preview", {
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

  runEmailTest(email: EmailSettingsDraft, adminEmail: string): Promise<EmailTestResult> {
    return this.#request<EmailTestResult>("/setup-api/email-test", "POST", {
      mode: "live",
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
    clientClaimNonce: string,
    venue: ProvisionBody["venue"],
    locale?: string,
    intent?: Pick<ProvisionBody, "configurationImport" | "newTaxpayer">,
  ): Promise<FirstSetupOwnership> {
    return this.#request(
      "/setup-api/first-setup/claim",
      "POST",
      { clientClaimNonce, venue, ...intent },
      locale === undefined ? {} : { "accept-language": locale },
    );
  }

  resumeFirstSetup(clientClaimNonce: string, password: string): Promise<FirstSetupOwnership> {
    return this.#request("/setup-api/first-setup/resume", "POST", { clientClaimNonce, password });
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
  ): Promise<FirstSetupUpdate> {
    return this.#request(
      "/setup-api/first-setup/candidates",
      "POST",
      { module, proposal, reconfirmation },
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
  ): Promise<ProvisionResult> {
    return this.#request("/setup-api/provision", "POST", body, {
      ...firstSetupHeaders(owner),
      ...(locale === undefined ? {} : { "accept-language": locale }),
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
