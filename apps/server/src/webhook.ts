import type { Hono } from "hono";
import type Stripe from "stripe";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { StripeHostedProvider, stripeHostedClient } from "@waitron/payments-stripe";
import { expireInitiated, hasPaymentWithExternalRef, settleInitiated } from "@waitron/payments";
import type { InboundSettlement } from "@waitron/payments";
import { AppError, isAppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import { readCredential } from "./credentials.js";
import { stripeSecretKeyFrom } from "./stripe-account.js";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

const PURPOSE = "payments.stripe";

/**
 * The AppError codes answered 400: permanent errors a retry can never fix. Everything else is 5xx
 * so Stripe retries: a missing or incomplete credential can be a transient provisioning state, and
 * dropping a real settlement is the costlier failure.
 */
const CLIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "payment.webhook_signature_invalid",
  "payment.credential_environment_mismatch",
]);

export interface WebhookDeps {
  db: Database;
  ring: KeyRing;
  nodeId: string;
  environment: DeploymentEnvironment;
  /** Injected so a test never constructs a real SDK and the key it was given is observable. */
  makeStripe: (secretKey: string) => Stripe;
}

/** What one verified webhook did; the route acknowledges every outcome with an empty 2xx. */
export type WebhookOutcome = "settled" | "expired" | "redelivery" | "ignored" | "unresolved";

/**
 * Checked at the read site, as `stripeSecretKeyFrom` does: passing `undefined` into the SDK would
 * fail far away with nothing naming the field.
 */
export function hostedWebhookSecretFrom(
  payload: Record<string, string | undefined>,
  ref: { purpose: string },
): string {
  const webhookSecret = payload.webhookSecret;
  if (webhookSecret === undefined) {
    throw new AppError("server.credential_unusable", { ...ref, field: "webhookSecret" });
  }
  return webhookSecret;
}

/**
 * The signature is the whole of the authorisation. No sale is recorded here, so a payment settled
 * by this route has no associated sale (the `recordSale` hand-off is open in `docs/backlog.md`).
 */
export async function settleWebhook(
  deps: WebhookDeps,
  rawBody: string,
  signature: string,
  log: Logger,
): Promise<WebhookOutcome> {
  const ref = { purpose: PURPOSE };
  const payload = await readCredential(deps.db, deps.ring, PURPOSE);
  const secretKey = stripeSecretKeyFrom(payload, ref, deps.environment);
  const webhookSecret = hostedWebhookSecretFrom(payload, ref);
  // `successUrl`/`cancelUrl` are not validated: only `createCheckoutSession` reads them, and the
  // webhook never calls it.
  const provider = new StripeHostedProvider({
    client: stripeHostedClient(deps.makeStripe(secretKey), {
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      webhookSecret,
    }),
    db: deps.db,
  });

  let parsed: InboundSettlement | null;
  try {
    parsed = provider.verifyAndParse(rawBody, signature);
  } catch {
    // Any failure to verify or parse is refused, carrying neither the body nor the secret.
    throw new AppError("payment.webhook_signature_invalid", {});
  }
  if (parsed === null) return "ignored"; // a verified event type we do not act on
  const event = parsed;

  if (!(await hasPaymentWithExternalRef(deps.db, event.provider, event.externalRef))) {
    // No local row: acknowledge and let `reconcile`'s `missing_local` backstop it, rather than have
    // Stripe retry a settlement that can never be placed locally.
    log("warn", "payment.webhook_unresolved", {
      provider: event.provider,
      externalRef: event.externalRef,
    });
    return "unresolved";
  }

  return withTransaction(deps.db, async (tx) => {
    if (event.outcome === "expired") {
      await expireInitiated(tx, { provider: event.provider, externalRef: event.externalRef });
      return "expired";
    }
    const row = await settleInitiated(tx, {
      provider: event.provider,
      externalRef: event.externalRef,
      settledAt: event.settledAt,
    });
    // null = an at-least-once redelivery already advanced past `initiated`; do nothing.
    return row === null ? "redelivery" : "settled";
  });
}

/**
 * The raw body is read as text: a re-serialised body would break the HMAC the signature covers.
 * Every `WebhookOutcome` is the same empty 2xx, so no existence oracle distinguishes the no-ops.
 * Only the error code of an unexpected failure is logged, never its message.
 */
export function mountWebhook(app: Hono, deps: WebhookDeps, log: Logger): void {
  app.post("/webhooks/stripe", async (c) => {
    try {
      // Inside the try: `c.req.text()` can reject on an aborted body, which must still be logged.
      const signature = c.req.header("stripe-signature") ?? "";
      const rawBody = await c.req.text();
      await settleWebhook(deps, rawBody, signature, log);
      return c.body(null, 200);
    } catch (cause) {
      if (isAppError(cause) && CLIENT_ERROR_CODES.has(cause.code)) {
        log("warn", cause.code, cause.params);
        return c.body(null, 400);
      }
      log("error", "webhook.failed", { errorCode: codeOf(cause) });
      return c.body(null, 500);
    }
  });
}
