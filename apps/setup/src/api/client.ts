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

export interface ProvisionBody {
  mode: "demo" | "prepare" | "live";
  configurationImport?: boolean;
  venue: {
    country: string;
    taxId: string;
    legalName: string;
    location: LocationDraft;
    tillName: string;
    seriesCode: string;
    rectificativeSeriesCode: string;
    admin: AdminDraft;
  };
  /** Omitted, not `null`, when no certificate is expected: the server refuses any value it is sent. */
  aeatCert?: AeatCertDraft;
}

export interface ProvisionResult {
  provisioned: true;
  restarting: true;
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
  restarting: true;
}

export interface RestoreOutcome {
  restoreStaged: true;
  restarting: true;
}

export interface BucketRestoreBody {
  /** The recovery kit as pasted or read from its file; as sensitive as the recovery key. */
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

export interface ConfigurationPreview {
  venue: Omit<ProvisionBody["venue"], "admin"> & {
    location: ProvisionBody["venue"]["location"] & { id: string };
  };
  counts: Record<string, number>;
  reconnect: string[];
}

export type FiscalReadinessResult =
  | { status: "accepted" | "rejected" | "uncertain"; testedAt?: string }
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

  provision(body: ProvisionBody): Promise<ProvisionResult> {
    return this.#request<ProvisionResult>("/setup-api/provision", "POST", body);
  }

  adopt(body: AdoptBody): Promise<AdoptOutcome> {
    return this.#request<AdoptOutcome>("/setup-api/adopt", "POST", body);
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
  restoreFromCloud(pointId: string, oldBoxGone = false): Promise<RestoreOutcome> {
    return this.#request(
      "/setup-api/cloud-recovery/restore",
      "POST",
      oldBoxGone ? { pointId, oldBoxGone } : { pointId },
    );
  }

  /** `oldBoxGone` answers `restore.stream_source_live`/`restore.stream_source_unchecked`. */
  async restore(
    artifact: Blob,
    recoveryKey: string,
    environment: "production" | "preproduction",
    oldBoxGone = false,
  ): Promise<RestoreOutcome> {
    const fetchImpl = this.#fetchImpl;
    const res = await fetchImpl(this.#baseUrl + "/setup-api/restore", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-recovery-key": recoveryKey,
        "x-waitron-restore-environment": environment,
        ...(oldBoxGone ? { "x-waitron-old-box-gone": "1" } : {}),
      },
      body: artifact,
    });
    if (!res.ok) throw await apiError(res);
    return JSON.parse(await res.text()) as RestoreOutcome;
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

  runFiscalTest(body: ProvisionBody): Promise<FiscalReadinessResult> {
    return this.#request<FiscalReadinessResult>("/setup-api/fiscal-test", "POST", body);
  }

  async #request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const fetchImpl = this.#fetchImpl;
    const init: RequestInit =
      body === undefined
        ? { method, credentials: "include" }
        : {
            method,
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const res = await fetchImpl(this.#baseUrl + path, init);
    if (!res.ok) throw await apiError(res);
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }
}
