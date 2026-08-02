import type { Hono } from "hono";
import type Stripe from "stripe";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { StripeHostedProvider, stripeHostedClient } from "@waitron/payments-stripe";
import { expireInitiated, resolvePaymentTenant, settleInitiated } from "@waitron/payments";
import type { InboundSettlement } from "@waitron/payments";
import { AppError, isAppError, tenantId as brandTenantId } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import { readCredential } from "./credentials.js";
import { stripeSecretKeyFrom } from "./stripe-account.js";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
import "./errors.js";

const PURPOSE = "payments.stripe";

/**
 * The AppError codes the route answers **400** to — PERMANENT client errors a retry can never fix,
 * which deliberately break the endpoint's otherwise-5xx "never drop a settlement" bias:
 *
 * - `payment.webhook_signature_invalid` / `payment.webhook_tenant_mismatch` — this file's own gate.
 * - `shared.invalid_id` — a malformed `:tenantId` path segment (`brandTenantId` throws it before any
 *   database access); the request is unroutable, not merely unlucky.
 * - `payment.credential_environment_mismatch` — a live key on a pre-production host (or vice versa):
 *   a provisioning MISTAKE, not a transient state, so retrying forever changes nothing.
 *
 * Everything else stays 5xx so Stripe retries: `server.credential_unusable` (a missing field can be a
 * transient mid-provisioning state), `credentials.missing` (a tenant not yet provisioned), and any DB
 * fault are all recoverable on retry — and dropping a real settlement is the costlier failure.
 */
const CLIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "payment.webhook_signature_invalid",
  "payment.webhook_tenant_mismatch",
  "shared.invalid_id",
  "payment.credential_environment_mismatch",
]);

export interface WebhookDeps {
  db: Database;
  ring: KeyRing;
  /** This host's own deployment environment, checked against the tenant's secret key exactly as
   * `stripeAccountResolver` does — see `stripeSecretKeyFrom`. */
  environment: DeploymentEnvironment;
  /** Injected exactly as `StripeAccountDeps.makeStripe` is, so a test never constructs a real SDK
   * and the KEY selected per tenant is observable. Webhook verification is local HMAC; no network
   * call is made through the returned client on this path. */
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
 * would fail far away with nothing naming the tenant or the field. `webhookSecret` has been declared
 * on the `payments.stripe` purpose since it existed, so a stale row lacking it is unlikely — checked
 * rather than assumed, the same read-site discipline `stripe-account.ts` establishes.
 */
export function hostedWebhookSecretFrom(
  payload: Record<string, string | undefined>,
  ref: { tenantId: string; purpose: string },
): string {
  const webhookSecret = payload.webhookSecret;
  if (webhookSecret === undefined) {
    throw new AppError("server.credential_unusable", { ...ref, field: "webhookSecret" });
  }
  return webhookSecret;
}

/**
 * The receiving half of Mode 3, security path only (design §5 steps 2–6). It selects the PATH
 * tenant's own signing secret, verifies the raw event as the SOLE gate, cross-checks the resolved
 * tenant against the path, and advances the payment state under `withTenant`.
 *
 * The signature is the whole of the authorisation: the path `:tenantId` is attacker-controllable, so
 * nothing acts on it until that tenant's real `webhookSecret` verifies the raw bytes. Naming a tenant
 * therefore buys an attacker nothing.
 *
 * DEFERRED, by design: the `recordSale` + `associatePaymentWithSale` sale-chaining the wiring
 * capstone (`packages/payments/src/async.wiring.test.ts`) proves is NOT done here — it is blocked on
 * the till/working-orders model and the `server_id` rekey, neither of which exists yet. A payment
 * settled here therefore has no associated sale, which is exactly the `captured`-with-null-`sale_id`
 * state `reconcile`'s `missing_local`/orphan classes already model per tenant.
 */
export async function settleWebhook(
  deps: WebhookDeps,
  pathTenantId: string,
  rawBody: string,
  signature: string,
  log: Logger,
): Promise<WebhookOutcome> {
  const tenant = brandTenantId(pathTenantId);
  const ref = { tenantId: pathTenantId, purpose: PURPOSE };
  // Per-tenant secret selection. `readCredential` is itself tenant-scoped (it opens `withTenant`),
  // so the secret this request is verified against belongs to the path tenant and no other — the
  // guard the cross-secret test proves by deletion.
  const payload = await readCredential(deps.db, deps.ring, tenant, PURPOSE);
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
    throw new AppError("payment.webhook_signature_invalid", { tenantId: pathTenantId });
  }
  if (parsed === null) return "ignored"; // a verified event type we do not act on
  const event = parsed;

  // Cross-check the #26 seam: the resolved owner must be the path tenant. `resolvePaymentTenant`
  // runs on a plain handle OUTSIDE any tenant scope — its SECURITY DEFINER function is the single
  // controlled RLS bypass, returning only `tenant_id`.
  const resolved = await resolvePaymentTenant(deps.db, event.provider, event.externalRef);
  if (resolved === null) {
    // No local `initiated` row: a session minted-then-crashed before its row was written, or one
    // this host never minted. Ack 2xx and let `reconcile`'s `missing_local` backstop it — never a
    // 400 that would make Stripe retry a settlement it can never place locally.
    log("warn", "payment.webhook_unresolved", {
      provider: event.provider,
      externalRef: event.externalRef,
    });
    return "unresolved";
  }
  // uuid comparison is case-insensitive in Postgres, so compare case-folded — a path whose casing
  // differs from the stored uuid is the same tenant, not a mismatch.
  if (resolved.toLowerCase() !== pathTenantId.toLowerCase()) {
    throw new AppError("payment.webhook_tenant_mismatch", {
      pathTenantId,
      resolvedTenantId: resolved,
      externalRef: event.externalRef,
    });
  }

  return withTenant(deps.db, tenant, async (tx) => {
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
 * Registers `POST /webhooks/stripe/:tenantId` on an existing Hono app — the webhook cycle "attaches
 * to this app rather than creating a second one" (`health.ts`'s own note). The raw body is read via
 * `c.req.text()`; no JSON parser sits in front of this route, because a re-serialised body would
 * break the HMAC the signature is computed over.
 *
 * Status contract: a returned `WebhookOutcome` — verified-and-processed, redelivery, ignored,
 * unresolved — is a uniform empty 2xx, so no existence oracle distinguishes the no-ops. A signature
 * failure or a tenant cross-check disagreement is a 400 (misconfiguration/abuse, not transient — a
 * retry cannot fix it). Anything else — a missing/unusable credential, a decrypt failure, a
 * transient DB fault — is a 5xx so Stripe retries: a provisioning race then resolves itself, and no
 * settlement is lost. Only the error CODE is ever logged, never a caught value's message.
 */
export function mountWebhook(app: Hono, deps: WebhookDeps, log: Logger): void {
  app.post("/webhooks/stripe/:tenantId", async (c) => {
    const pathTenantId = c.req.param("tenantId");
    try {
      // Read INSIDE the try: `c.req.text()` can reject on an aborted or mis-encoded body, and a read
      // that threw above the try would escape to Hono's default 500 — bypassing this route's
      // structured `webhook.failed` log and its status mapping. Guarding the reads routes such a
      // failure through the same 5xx-with-logging path as any other non-client error, so Stripe
      // retries and the tenant is named in the log. `pathTenantId` stays out so the catch can name it.
      const signature = c.req.header("stripe-signature") ?? "";
      const rawBody = await c.req.text();
      await settleWebhook(deps, pathTenantId, rawBody, signature, log);
      return c.body(null, 200);
    } catch (cause) {
      if (isAppError(cause) && CLIENT_ERROR_CODES.has(cause.code)) {
        log("warn", cause.code, cause.params);
        return c.body(null, 400);
      }
      log("error", "webhook.failed", { tenantId: pathTenantId, errorCode: codeOf(cause) });
      return c.body(null, 500);
    }
  });
}
