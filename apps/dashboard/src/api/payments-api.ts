import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import type { EquipmentHolder, ProfileReaderList } from "./devices-api.js";
import { ServersApi } from "./servers-api.js";
import type { StuckTenderRefundRow, TenderRefundView } from "./tender-refund-types.js";

export interface PaymentSettingsEdit {
  tipsEnabled: boolean;
  testProviders: boolean;
  revision: number;
}

export interface PaymentSettingsView extends PaymentSettingsEdit {
  testProvidersAvailable: boolean;
}

export interface PaymentProviderRow {
  providerId: string;
  state: "connected" | "not_connected";
  canUnpair: boolean;
}

export interface ReaderRow {
  printsOwnSlipAutomatically: boolean;
  id: string;
  provider: string;
  name: string;
  active: boolean;
  canEnable: boolean;
  deviceCount: number;
  deviceNames: string[];
}
/** A reader some device holds or has a payment in progress on. */
export interface ReaderHolderRow {
  readerId: string;
  holder: EquipmentHolder | null;
  paymentInProgressDeviceIds: string[];
}

export interface AvailableReader {
  providerRef: string;
  name: string;
  model?: string;
  serial?: string;
  registeredAt?: string;
  status: "available" | "disabled" | "added";
}

export interface ReaderStatusView {
  printsOwnSlipAutomatically: boolean;
  online: boolean;
  batteryPercent?: number;
  connection?: string;
  activity?: string;
  firmwareVersion?: string;
  lastSeenAt?: string;
  model?: string;
  serial?: string;
  unreachable?: boolean;
  pairingStatus?: "processing" | "paired";
}

export interface AbandonedRefundOutcome {
  paymentRef: string;
  workingOrderId: string;
  externalRef: string | null;
  amount: string;
  claimedAt: string;
  settledAt: string | null;
  outcome: "confirmed" | "unconfirmed";
}

export interface RetainedAllocation {
  remaining: string;
  applied: string;
  tip: string;
  outstanding: string;
}

export interface PartialRefundView {
  paymentId: string;
  captured: string;
  refunded: string;
  remaining: string;
}

export interface StuckBillPaymentRow {
  billState?: "pending" | "failed";
  partialRefund?: PartialRefundView;
  retention?: RetainedAllocation;
  billPaymentId: string;
  workingOrderId: string;
  orderNumber: number;
  label: string | null;
  /** The device that started it, or the job source that did; the name outlives a revocation. */
  source: string;
  deviceId: string | null;
  deviceName: string | null;
  method: "card";
  applied: string;
  tip: string;
  startedAt: string;
  provider: string | null;
  providerState: string | null;
}
/** A card payment the provider paid out at a different amount, held until a manager records what
 * was done with it. */
export interface HeldPaymentRow {
  paymentId: string;
  paymentRef: string;
  provider: string;
  orderNumber: number;
  /** Absent when the order has no label. */
  label?: string;
  settledAt: string | null;
  amount: string;
  providerAmount: string;
}

export type HeldOutcome = "refunded_at_provider" | "put_on_bill";

export interface StuckBillRefundRow {
  refundId: string;
  billPaymentId: string;
  workingOrderId: string;
  orderNumber: number;
  label: string | null;
  /** The device that started it, or the job source that did; the name outlives a revocation. */
  source: string;
  deviceId: string | null;
  deviceName: string | null;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  requestedAt: string;
  sentAt: string | null;
  sendCount: number;
  provider: string | null;
}

export type BillRecoveryOutcome =
  | { outcome: "received"; invoiceNumber?: string }
  | { outcome: "not_charged" }
  | { outcome: "completed" }
  | { outcome: "failed" };
/** Above SumUp's two sequential 20-second status calls. */
const CARD_PROVIDER_READ_LIMIT_MS = 50_000;

export class PaymentsApi extends ServersApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  getPaymentSettings(): Promise<PaymentSettingsView> {
    return this.#request("/management-api/payments/settings", "GET");
  }
  savePaymentSettings(edit: PaymentSettingsEdit): Promise<PaymentSettingsView> {
    return this.#request("/management-api/payments/settings", "PUT", edit);
  }
  listPaymentProviders(): Promise<PaymentProviderRow[]> {
    return this.#request<PaymentProviderRow[]>("/management-api/payments/providers", "GET");
  }
  setPaymentProviderState(
    id: string,
    enabled: boolean,
    revision: number,
  ): Promise<{ enabled: boolean; revision: number }> {
    return this.#request(`/management-api/payments/providers/${id}/state`, "PUT", {
      enabled,
      revision,
    });
  }
  disconnectPaymentProvider(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/providers/${id}/disconnect`, "POST");
  }
  listReaders(): Promise<ReaderRow[]> {
    return this.#request<ReaderRow[]>("/management-api/payments/readers", "GET");
  }
  readerStatus(id: string): Promise<ReaderStatusView> {
    return this.#request<ReaderStatusView>(
      `/management-api/payments/readers/${id}/status`,
      "GET",
      undefined,
      { timeLimitMs: CARD_PROVIDER_READ_LIMIT_MS },
    );
  }
  availableReaders(providerId: string): Promise<AvailableReader[]> {
    return this.#request<AvailableReader[]>(
      `/management-api/payments/providers/${encodeURIComponent(providerId)}/available-readers`,
      "GET",
      undefined,
      { timeLimitMs: CARD_PROVIDER_READ_LIMIT_MS },
    );
  }
  adoptReader(input: {
    providerId: string;
    providerRef: string;
    name: string;
  }): Promise<{ id: string; status: "paired"; outcome: "created" | "restored" | "enabled" }> {
    return this.#request("/management-api/payments/readers/adopt", "POST", input);
  }
  listReaderProfileChoices(): Promise<{ id: string; name: string; eligible: boolean }[]> {
    return this.#request("/management-api/payments/reader-profile-choices", "GET");
  }
  assignReaderProfiles(id: string, profileIds: string[]): Promise<void> {
    return this.#request(`/management-api/payments/readers/${id}/profiles`, "PUT", { profileIds });
  }
  saveReader(
    id: string,
    input: { name: string; printsOwnSlipAutomatically: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}`, "PATCH", input);
  }
  renameReader(id: string, name: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}`, "PATCH", { name });
  }
  unpairReader(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}/unpair`, "POST");
  }
  getReaderDeleteImpact(id: string): Promise<DeleteImpact> {
    return this.#request(`/management-api/payments/readers/${id}/delete-impact`, "GET");
  }
  /** With `acceptRegistrationKept`, the confirmation showed that the reader stays registered at
   *  its provider, which is not connected. */
  deleteReader(id: string, options?: { acceptRegistrationKept: true }): Promise<DeleteImpact> {
    return this.#request(
      `/management-api/payments/readers/${id}${options?.acceptRegistrationKept ? "?acceptRegistrationKept=true" : ""}`,
      "DELETE",
    );
  }
  getDeviceReader(id: string): Promise<{ readerId: string | null }> {
    return this.#request<{ readerId: string | null }>(
      `/management-api/payments/devices/${id}/reader`,
      "GET",
    );
  }
  /** Null puts the device on its profile's default reader. */
  setDeviceReader(id: string, readerId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/payments/devices/${id}/reader`, "PUT", {
      readerId,
    });
  }
  listReaderHolders(): Promise<ReaderHolderRow[]> {
    return this.#request<ReaderHolderRow[]>("/management-api/payments/reader-holders", "GET");
  }
  getProfileReaders(profileId: string): Promise<ProfileReaderList> {
    return this.#request<ProfileReaderList>(
      `/management-api/payments/device-profiles/${profileId}/readers`,
      "GET",
    );
  }
  setProfileReaders(profileId: string, list: ProfileReaderList): Promise<ProfileReaderList> {
    return this.#request<ProfileReaderList>(
      `/management-api/payments/device-profiles/${profileId}/readers`,
      "PUT",
      list,
    );
  }
  listAbandonedRefunds(): Promise<AbandonedRefundOutcome[]> {
    return this.#request("/management-api/payments/abandoned-refunds", "GET");
  }
  releasePartialRefund(paymentId: string): Promise<{ outcome: "released" }> {
    return this.#request(
      `/management-api/payments/partial-refunds/${encodeURIComponent(paymentId)}/release`,
      "POST",
    );
  }
  retainPartialRefund(
    paymentId: string,
    allocation: Pick<RetainedAllocation, "remaining" | "applied" | "tip">,
  ): Promise<{ outcome: "retained" } & RetainedAllocation> {
    return this.#request(
      `/management-api/payments/partial-refunds/${encodeURIComponent(paymentId)}/retain`,
      "POST",
      allocation,
    );
  }
  listStuckTenderRefunds(): Promise<StuckTenderRefundRow[]> {
    return this.#request("/management-api/payments/tender-refunds", "GET");
  }
  resolveStuckTenderRefund(id: string): Promise<{ outcome: TenderRefundView["state"] }> {
    return this.#request(
      `/management-api/payments/tender-refunds/${encodeURIComponent(id)}/resolve`,
      "POST",
    );
  }
  attestStuckTenderRefund(
    id: string,
    body: { outcome: "completed" | "failed"; note: string; pin: string },
  ): Promise<{ outcome: TenderRefundView["state"] }> {
    return this.#request(
      `/management-api/payments/tender-refunds/${encodeURIComponent(id)}/attest`,
      "POST",
      body,
    );
  }
  listStuckBillPayments(): Promise<StuckBillPaymentRow[]> {
    return this.#request<StuckBillPaymentRow[]>("/management-api/payments/bill-payments", "GET");
  }
  listHeldPayments(): Promise<HeldPaymentRow[]> {
    return this.#request<HeldPaymentRow[]>("/management-api/payments/held", "GET");
  }
  /** `note` is left out when there is none: the server refuses an explicit null. */
  recordHeldOutcome(
    id: string,
    body: { outcome: HeldOutcome; note?: string; pin: string },
  ): Promise<{ outcome: HeldOutcome }> {
    return this.#request<{ outcome: HeldOutcome }>(
      `/management-api/payments/held/${encodeURIComponent(id)}/outcome`,
      "POST",
      body,
    );
  }
  listStuckBillRefunds(): Promise<StuckBillRefundRow[]> {
    return this.#request<StuckBillRefundRow[]>("/management-api/payments/bill-refunds", "GET");
  }
  resolveStuckBillPayment(id: string): Promise<BillRecoveryOutcome> {
    return this.#request<BillRecoveryOutcome>(
      `/management-api/payments/bill-payments/${id}/resolve`,
      "POST",
    );
  }
  attestStuckBillPayment(
    id: string,
    body: { outcome: "received" | "failed"; note: string; pin: string },
  ): Promise<BillRecoveryOutcome> {
    return this.#request<BillRecoveryOutcome>(
      `/management-api/payments/bill-payments/${id}/attest`,
      "POST",
      body,
    );
  }
  resolveStuckBillRefund(id: string): Promise<BillRecoveryOutcome> {
    return this.#request<BillRecoveryOutcome>(
      `/management-api/payments/bill-refunds/${id}/resolve`,
      "POST",
    );
  }
  attestStuckBillRefund(
    id: string,
    body: { outcome: "completed" | "failed"; note: string; pin: string },
  ): Promise<BillRecoveryOutcome> {
    return this.#request<BillRecoveryOutcome>(
      `/management-api/payments/bill-refunds/${id}/attest`,
      "POST",
      body,
    );
  }
}
