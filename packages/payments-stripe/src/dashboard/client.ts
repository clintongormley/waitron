import type { DashboardRequest } from "@waitron/dashboard-kit";

// The Stripe panel's HTTP face over the generic payments routes (`apps/server/src/payments-api.ts`).
// LOCAL copies of the routes' JSON shapes, never imported from the server (a browser bundle must not
// drag `@waitron/db` and Node builtins in). The secret key never reaches the browser after connect.

/** The connect response — only the merchant name to confirm, NEVER a secret (the route strips them). */
export interface ConnectResult {
  merchantName: string;
}

/** The `POST /management-api/payments/readers` response for Stripe: the new row id; Stripe verifies
 * the reader once at add, so it comes back `paired`. */
export interface AddReaderResult {
  id: string;
  status: "paired" | "processing";
}

/** The Stripe connect-form payload: the secret key, the webhook signing secret, and the hosted-checkout
 * return URLs. All four are the `payments.stripe` credential fields the server seat seals verbatim. */
export interface StripeConnectPayload {
  secretKey: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
}

/** The Stripe routes as a small class over an injected {@link DashboardRequest}. */
export class StripePaymentsClient {
  readonly #request: DashboardRequest;

  constructor(request: DashboardRequest) {
    this.#request = request;
  }

  /** `POST /management-api/payments/providers/stripe/connect` — verify the key, seal it, return the
   * merchant name. */
  connect(payload: StripeConnectPayload): Promise<ConnectResult> {
    return this.#request<ConnectResult>(
      "/management-api/payments/providers/stripe/connect",
      "POST",
      payload,
    );
  }

  /** `POST /management-api/payments/readers` — add a Terminal reader by its Stripe reference id. */
  addReader(input: { name: string; reference: string }): Promise<AddReaderResult> {
    return this.#request<AddReaderResult>("/management-api/payments/readers", "POST", {
      providerId: "stripe",
      ...input,
    });
  }
}
