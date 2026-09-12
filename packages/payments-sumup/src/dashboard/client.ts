import type { DashboardRequest } from "@waitron/dashboard-kit";

// The SumUp panel's HTTP face over the generic payments routes (`apps/server/src/payments-api.ts`).
// These are LOCAL copies of the routes' JSON shapes, never imported from the server (a browser bundle
// must not drag `@waitron/db` and Node builtins in). The API key never reaches the browser — every
// pairing call goes through the server, which reads the sealed credential itself.

/** The connect response — only the merchant name to confirm, NEVER a secret (the route strips them). */
export interface ConnectResult {
  merchantName: string;
}

/** One pickable merchant from a `payment.provider_merchant_ambiguous` rejection — code and name are
 * not secrets, so the form offers a picker and re-submits with the chosen `merchantCode`. */
export interface AmbiguousMerchant {
  code: string;
  name: string;
}

/** The `POST /management-api/payments/readers` response for SumUp: the new row id and whether the
 * device already confirmed (`paired`) or the screen must poll (`processing`). */
export interface AddReaderResult {
  id: string;
  status: "paired" | "processing";
}

/** A reader's live status as `GET /management-api/payments/readers/:id/status` returns it. The panel
 * waits on `pairingStatus` reaching `"paired"` — pairing completion, DISTINCT from device connectivity
 * (`online`): a reader can pair and then be briefly offline within the code's window. */
export interface ReaderStatus {
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

/** The SumUp connect-form payload: the API key plus the optional affiliate pair, and (on the
 * multi-merchant re-submit) the chosen merchant code. */
export interface SumUpConnectPayload {
  apiKey: string;
  affiliateAppId?: string;
  affiliateKey?: string;
  merchantCode?: string;
}

/** The SumUp routes as a small class over an injected {@link DashboardRequest}. The panel builds one
 * from the screen's `request` and hands it to the connect form and add-reader dialog. */
export class SumUpPaymentsClient {
  readonly #request: DashboardRequest;

  constructor(request: DashboardRequest) {
    this.#request = request;
  }

  /** `POST /management-api/payments/providers/sumup/connect` — verify the key, seal it, return the
   * merchant name. Rejects with `payment.provider_merchant_ambiguous` (carrying `{ merchants }`) when
   * the key spans several merchants and `merchantCode` is absent. */
  connect(payload: SumUpConnectPayload): Promise<ConnectResult> {
    return this.#request<ConnectResult>(
      "/management-api/payments/providers/sumup/connect",
      "POST",
      payload,
    );
  }

  /** `POST /management-api/payments/readers` — pair a reader by its on-device code. */
  addReader(input: { name: string; code: string }): Promise<AddReaderResult> {
    return this.#request<AddReaderResult>("/management-api/payments/readers", "POST", {
      providerId: "sumup",
      ...input,
    });
  }

  /** `GET /management-api/payments/readers/:id/status` — the reader's live status (online + pairing). */
  readerStatus(id: string): Promise<ReaderStatus> {
    return this.#request<ReaderStatus>(`/management-api/payments/readers/${id}/status`, "GET");
  }

  /** `POST /management-api/payments/readers/:id/unpair` — unpair the reader row. The dialog calls this
   * to clean up the `processing` row it created when a pairing attempt expires or fails without ever
   * reaching `paired`, so no un-paired orphan lingers to be picked as a device default. */
  unpairReader(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}/unpair`, "POST");
  }
}

/** Read the pickable merchant list off a `payment.provider_merchant_ambiguous` rejection (the request
 * primitive carries the envelope's `params` through). Returns `[]` when the shape is unexpected. */
export function ambiguousMerchants(error: unknown): AmbiguousMerchant[] {
  const params = (error as { params?: { merchants?: AmbiguousMerchant[] } }).params;
  return params?.merchants ?? [];
}
