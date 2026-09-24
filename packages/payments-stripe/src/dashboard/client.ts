import type { DashboardRequest } from "@waitron/dashboard-kit";

// LOCAL copies of the route shapes in `apps/server/src/payments-api.ts`: a browser bundle must not
// import server code.

export interface ConnectResult {
  merchantName: string;
}

/** The `POST /management-api/payments/readers` response for Stripe: the new row id; Stripe verifies
 * the reader once at add, so it comes back `paired`. */
export interface AddReaderResult {
  id: string;
  status: "paired" | "processing";
}

export interface StripeConnectPayload {
  secretKey: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
}

export class StripePaymentsClient {
  readonly #request: DashboardRequest;

  constructor(request: DashboardRequest) {
    this.#request = request;
  }

  connect(payload: StripeConnectPayload): Promise<ConnectResult> {
    return this.#request<ConnectResult>(
      "/management-api/payments/providers/stripe/connect",
      "POST",
      payload,
    );
  }

  addReader(input: { name: string; reference: string }): Promise<AddReaderResult> {
    return this.#request<AddReaderResult>("/management-api/payments/readers", "POST", {
      providerId: "stripe",
      ...input,
    });
  }
}
