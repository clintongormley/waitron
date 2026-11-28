import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { ReportDialogCloud } from "@waitron/ui/src/components/wt-report-dialog.js";
import { OrdersApi } from "./orders-api.js";

interface CloudInstallation {
  revision: number;
  lastContactAt: string | null;
  leaseExpiresAt: string | null;
  services: {
    service: "remote_access" | "continuous_backup" | "retained_snapshots" | "content_translation";
    state: "unconfigured" | "provisioning" | "ready" | "failed";
    health: "unknown" | "healthy" | "degraded" | "failed";
    failure: string | null;
    observedAt: string | null;
  }[];
}

export interface CloudConnectionStatus {
  errorReportsEnabled?: boolean;
  sameTabSignIn?: boolean;
  isRemote?: boolean;
  remoteAccessEnabled?: boolean;
  remoteAccessPlanRequired?: true;
  replacementEligible?: boolean;
  replacementPending?: boolean;
  replacementError?: string | null;
  replacementApproval?: null | { requestId: string; code: string; openCloudUrl: string };
  replacement?: null | {
    requestId: string;
    pointId: string;
    venueId: string;
    oldInstallationId: string;
    nodeId: string;
    environment: "test";
    publicKey: string;
    peerPublicKey: string;
    state: "awaiting_owner" | "complete";
    expiresAt: string;
    organisationName: string;
    legalBusinessName: string;
    registration: CloudConnectionStatus["registration"] | null;
  };
  installation?: CloudInstallation &
    ({ state: "pending" | "active" | "unavailable" } | { state: "revoked" });
  configured: boolean;
  isPrimary: boolean;
  state: "not_connected" | "awaiting_cloud" | "awaiting_local" | "complete";
  code: string;
  openCloudUrl?: string;
  requestId?: string;
  expiresAt?: string;
  venueId?: string;
  environment?: "test" | "production";
  organisationId?: string;
  legalBusinessId?: string;
  organisationName?: string;
  legalBusinessName?: string;
  registration?: {
    venueId: string;
    installationId: string;
    organisationId: string;
    legalBusinessId: string;
  };
  /** Configured Cloud origin + `/signup`, while the venue is not connected. */
  signupUrl?: string;
  /** Configured Cloud origin + `/account`, while connected and Cloud access has not been stopped. */
  accountUrl?: string;
}

export interface CloudOwnerRecoveryRequest {
  requestId: string;
  accountId: string;
  email: string;
  organisationId: string;
  legalBusinessId: string;
  venueId: string;
  installationId: string;
  publicKey: string;
  environment: "test" | "production";
  countryCode: "ES";
  expiresAt: string;
}

export interface CloudEmergency {
  asOf: string;
  stale: boolean;
  emergency:
    | {
        status: "ready";
        open: boolean;
        closedReason:
          null | "setting_off" | "level_inactive" | "no_payment_method" | "not_provisioned";
        address: string | null;
      }
    | { status: "unavailable"; reason: "state_not_ready" };
  prices: CloudBilling["prices"];
}

export interface CloudEmergencyPerson {
  personId: string;
  displayName: string;
  hasAuthenticator: boolean;
}
type CloudLevel = "registered" | "connected" | "hosted";
/** `GET /management-api/cloud/billing`: Cloud's "Venue billing display, version 1", checked by
 * the server (`apps/server/src/cloud-billing.ts`). Display only. */
export interface CloudBilling {
  asOf: string;
  calendarTimeZone: string;
  billing:
    | {
        status: "ready";
        level: CloudLevel;
        state: "trial" | "active" | "payment_failing" | "lapsed";
        period: null | {
          kind: "trial" | "paid";
          level: Exclude<CloudLevel, "registered">;
          from: string;
          /** The first day the period excludes. */
          until: string;
          coversAsOf: boolean;
        };
      }
    | { status: "unavailable"; reason: "state_not_ready" };
  prices:
    | {
        status: "published";
        revision: number;
        effectiveFrom: string;
        currency: "EUR";
        taxExclusive: true;
        vatRateBasisPoints: number;
        registeredMonthlyCents: 0;
        connectedMonthlyCents: number;
        hostedMonthlyCents: number;
        hostedDayDivisor: 30;
      }
    | { status: "unavailable"; reason: "not_published" };
  accountUrl: string;
}

export type CustomerMenuCloudStatus =
  | { status: "ready"; origin: string }
  | { status: "disconnected" | "remote_off" | "plan_required" | "waiting" | "unavailable" };

export class CloudApi extends OrdersApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  previewProblemReport(signal: AbortSignal): ReturnType<ReportDialogCloud["previewProblemReport"]> {
    return this.#request("/management-api/problem-reports/preview", "GET", undefined, {
      passive: true,
      signal,
    });
  }
  sendProblemReport(
    id: string,
    signal: AbortSignal,
    description?: string,
  ): ReturnType<ReportDialogCloud["sendProblemReport"]> {
    return this.#request(
      `/management-api/problem-reports/${encodeURIComponent(id)}/send`,
      "POST",
      description === undefined ? undefined : { description },
      { signal },
    );
  }
  getProblemDescriptions(
    signal?: AbortSignal,
  ): Promise<{ reportId: string; description: string; time: number }[]> {
    return this.#request("/management-api/problem-reports/descriptions", "GET", undefined, {
      passive: true,
      signal,
    });
  }
  decideProblemDescription(id: string, decision: "send" | "discard"): Promise<void> {
    return this.#request(
      `/management-api/problem-reports/descriptions/${encodeURIComponent(id)}/${decision}`,
      "POST",
    );
  }
  // ── Backup admin ──────────────────────────────────────────────────────────────────────────────────

  refreshCloudConnection(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/refresh", "POST", {});
  }
  setCloudErrorReports(enabled: boolean): Promise<{ enabled: boolean }> {
    return this.#request("/management-api/cloud/error-reports", "POST", { enabled });
  }
  setCloudRemoteAccess(enabled: boolean): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/remote-access", "POST", { enabled });
  }
  revokeCloudConnection(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/revoke", "POST", {});
  }
  readCloudOwnerRecovery(): Promise<{ requests: CloudOwnerRecoveryRequest[] }> {
    return this.#request("/management-api/cloud/owner-recovery/read", "POST", {});
  }
  decideCloudOwnerRecovery(
    action: "approve" | "refuse",
    request: CloudOwnerRecoveryRequest,
  ): Promise<{ requestId: string; state: "approved" | "refused" }> {
    return this.#request(`/management-api/cloud/owner-recovery/${action}`, "POST", { request });
  }
  getCustomerMenuCloudStatus(): Promise<CustomerMenuCloudStatus> {
    return this.#request("/management-api/cloud/customer-menu", "GET", undefined, {
      passive: true,
    });
  }
  getCloudStatus(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/status", "GET");
  }
  getCloudEmergency(): Promise<CloudEmergency> {
    return this.#request("/management-api/cloud/emergency", "GET");
  }
  getCloudEmergencyPeople(): Promise<CloudEmergencyPerson[]> {
    return this.#request("/management-api/cloud/emergency/people", "GET");
  }
  getCloudBilling(): Promise<CloudBilling> {
    return this.#request("/management-api/cloud/billing", "GET");
  }
  startCloudSignIn(tab: string): Promise<{ authorizationUrl?: string }> {
    return this.#request("/management-api/cloud/sign-in/start", "POST", { tab });
  }
  startCloudConnection(restart = false): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/start", "POST", { restart });
  }
  reconnectCloudConnection(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/start", "POST", { reconnect: true });
  }
  checkCloudConnection(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/check", "POST", {});
  }
  prepareCloudReplacement(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/replacement/prepare", "POST", {});
  }
  reissueCloudReplacement(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/replacement/reissue", "POST", {});
  }
  checkCloudReplacement(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/replacement/check", "POST", {});
  }
  completeCloudConnection(choice: {
    requestId: string;
    organisationId: string;
    legalBusinessId: string;
  }): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/complete", "POST", choice);
  }
}
