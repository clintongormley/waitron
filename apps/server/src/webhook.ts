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
 * The AppError codes the route answers **400** to — PERMANENT client errors a retry can never fix,
 * which deliberately break the endpoint's otherwise-5xx "never drop a settlement" bias:
 *
 * - `payment.webhook_signature_invalid` — the signature check, this route's one gate.
 * - `payment.credential_environment_mismatch` — a live key on a pre-production host (or vice versa):
 *   a provisioning MISTAKE, not a transient state, so retrying forever changes nothing.
 *
 * `shared.invalid_id` used to be the third entry, for a malformed `:tenantId` path segment. The route
 * has no path segment and constructs no branded id from request input any more, so nothing here can
 * throw it; a future route that DOES construct one from the request has to put it back deliberately,
 * because anything absent from this set is answered 5xx.
 *
 * Everything else stays 5xx so Stripe retries: `server.credential_unusable` (a missing field can be a
 * transient mid-provisioning state), `credentials.missing` (a credential not yet provisioned), and any DB
 * fault are all recoverable on retry — and dropping a real settlement is the costlier failure.
 */
const CLIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "payment.webhook_signature_invalid",
  "payment.credential_environment_mismatch",
]);

export interface WebhookDeps {
  db: Database;
  ring: KeyRing;
  /** This node's id (`config.till.nodeId`), carried on the uniform write-path deps shape; it no
   * longer stamps a capture origin (the application outbox and its capture triggers were removed). */
  nodeId: string;
  /** This host's own deployment environment, checked against the stored secret key exactly as
   * `stripeAccountResolver` does — see `stripeSecretKeyFrom`. */
  environment: DeploymentEnvironment;
  /** Injected exactly as `StripeAccountDeps.makeStripe` is, so a test never constructs a real SDK
   * and the KEY it was given is observable. Webhook verification is local HMAC; no network call is
   * made through the returned client on this path. */
  makeStripe: (secretKey: string) => Stripe;
}

/** What one verified webhook did — every outcome the route acknowledges with an empty 2xx. `settled`
 * advanced `initiated → captured`; `expired` advanced `initiated → failed`; `redelivery` matched a
 * row already past `initiated` (at-least-once delivery, idempotent no-op); `ignored` was a verified
 * event type we do not act on; `unresolved` had no local `initiated` row at all. */
export type WebhookOutcome = "settled" | "expired" | "redelivery" | "ignored" | "unresolved";

/**
 * Validates `webhookSecret` at the READ site, mirroring `stripeSecretKeyFrom`: a credential row
 * sealed before the field was required decrypts without it, and passing `undefined` into the SDK
 * would fail far away with nothing naming the field. `webhookSecret` has been declared
 * on the `payments.stripe` purpose since it existed, so a stale row lacking it is unlikely — checked
 * rather than assumed, the same read-site discipline `stripe-account.ts` establishes.
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
 * The receiving half of Mode 3, security path only (design §5 steps 2–6). It reads the database's
 * `payments.stripe` signing secret, verifies the raw event as the SOLE gate, and advances the payment
 * state under `withTransaction`.
 *
 * The signature is the whole of the authorisation. The route carries no path segment naming the
 * taxpayer: the database holds one, and the segment that used to be there was attacker-controlled
 * and selected nothing.
 *
 * DEFERRED, by design: the `recordSale` + `associatePaymentWithSale` sale-chaining the wiring
 * capstone (`packages/payments/src/async.wiring.test.ts`) proves is NOT done here — it is blocked on
 * the till/working-orders model and the `server_id` rekey, neither of which exists yet. A payment
 * settled here therefore has no associated sale, which is exactly the `captured`-with-null-`sale_id`
 * state `reconcile`'s `missing_local`/orphan classes already model.
 */
export async function settleWebhook(
  deps: WebhookDeps,
  rawBody: string,
  signature: string,
  log: Logger,
): Promise<WebhookOutcome> {
  const ref = { purpose: PURPOSE };
  // Secret selection: the database's one credential for this purpose. The signature check below is
  // the gate.
  const payload = await readCredential(deps.db, deps.ring, PURPOSE);
  const secretKey = stripeSecretKeyFrom(payload, ref, deps.environment);
  const webhookSecret = hostedWebhookSecretFrom(payload, ref);
  // `successUrl`/`cancelUrl` are carried through but never READ on this path — they belong to
  // `createCheckoutSession`, which the webhook never calls — so they are passed straight from the
  // payload and, like `stripe-account.ts`, not validated here (only fields this path uses are).
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
    // The sole gate. Any failure to verify+parse the raw event is a request we refuse — 400 at the
    // route, logged there, never carrying the body or the secret. (This also catches the hosted
    // provider's documented-unreachable "settled event with no amount_total" guard, which for a
    // `mode: "payment"` session cannot fire — noted so a reader does not read this as ONLY a
    // signature check.)
    throw new AppError("payment.webhook_signature_invalid", {});
  }
  if (parsed === null) return "ignored"; // a verified event type we do not act on
  const event = parsed;

  // Runs on a plain handle, before the settle transaction opens.
  if (!(await hasPaymentWithExternalRef(deps.db, event.provider, event.externalRef))) {
    // No local `initiated` row: a session minted-then-crashed before its row was written, or one
    // this host never minted. Ack 2xx and let `reconcile`'s `missing_local` backstop it — never a
    // 400 that would make Stripe retry a settlement it can never place locally.
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
 * Registers `POST /webhooks/stripe` on an existing Hono app — the webhook cycle "attaches
 * to this app rather than creating a second one" (`health.ts`'s own note). The raw body is read via
 * `c.req.text()`; no JSON parser sits in front of this route, because a re-serialised body would
 * break the HMAC the signature is computed over.
 *
 * Status contract: a returned `WebhookOutcome` — verified-and-processed, redelivery, ignored,
 * unresolved — is a uniform empty 2xx, so no existence oracle distinguishes the no-ops. A signature
 * failure is a 400 (misconfiguration/abuse, not transient — a retry cannot fix it). Anything else —
 * a missing/unusable credential, a decrypt failure, a transient DB fault — is a 5xx so Stripe
 * retries: a provisioning race then resolves itself, and no settlement is lost. Only the error CODE is ever logged, never a caught value's message.
 */
export function mountWebhook(app: Hono, deps: WebhookDeps, log: Logger): void {
  app.post("/webhooks/stripe", async (c) => {
    try {
      // Read INSIDE the try: `c.req.text()` can reject on an aborted or mis-encoded body, and a read
      // that threw above the try would escape to Hono's default 500 — bypassing this route's
      // structured `webhook.failed` log and its status mapping. Guarding the reads routes such a
      // failure through the same 5xx-with-logging path as any other non-client error, so Stripe
      // retries and the failure is logged.
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
