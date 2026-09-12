import Stripe from "stripe";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { getCredential } from "@waitron/credentials";
import type { KeyRing } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type {
  AddReaderResult,
  CardProviderBuildDeps,
  CardProviderContribution,
  CardProviderRuntimeDeps,
  ConnectResult,
  PaymentProvider,
  ReaderStatus,
} from "@waitron/payments";
import type { StripeClient } from "./client.js";
import { stripeClient } from "./stripe-client.js";
import { StripeTerminalProvider } from "./provider.js";
// Registers `payment.credential_environment_mismatch` on the shared `ErrorParams` registry — the
// Stripe-key-environment code this seat throws. `payment.provider_credential_rejected` is declared
// in `@waitron/payments` (both provider seats throw it) and reachable through that package's barrel.
import "./errors.js";

const PROVIDER_ID = "stripe";
const CREDENTIAL_PURPOSE = "payments.stripe";

type DeploymentEnvironment = "preproduction" | "production";

/** The five `StripeClient` methods, listed once so `deferredStripeClient` can build a lazy wrapper
 * without repeating a per-method arrow (which would each read as a separate uncovered function). */
const CLIENT_METHODS = [
  "createPaymentIntent",
  "processPaymentIntent",
  "readerOutcome",
  "cancelReaderAction",
  "refund",
] as const;

/** The seam every path here builds its SDK client through: injected in tests so nothing reaches the
 * network, `defaultMakeStripe` in production. Mirrors `apps/server`'s `StripeAccountDeps.makeStripe`,
 * replicated here rather than imported so the seat imports no `apps/*` code. */
export type MakeStripe = (secretKey: string) => Stripe;

export function defaultMakeStripe(secretKey: string): Stripe {
  return new Stripe(secretKey);
}

/** Which environment a Stripe secret key belongs to, or `null` when we cannot tell. `null` is not a
 * failure: Stripe issues restricted keys (`rk_…`) and may add prefixes we do not know, and refusing
 * an unrecognised key would break a working deployment to enforce a check we cannot perform. The
 * pure replica of `apps/server`'s `keyEnvironmentOf` (kept out of this package to keep it pure). */
function keyEnvironmentOf(secretKey: string): DeploymentEnvironment | null {
  if (secretKey.startsWith("sk_live_")) return "production";
  if (secretKey.startsWith("sk_test_")) return "preproduction";
  return null;
}

/** Refuse a key whose environment prefix contradicts this host's, before it is sealed or used — a
 * test key on a production host takes payments that never settle. Skipped when `environment` is
 * unknown (a caller that cannot supply it) or the key's environment is unclassifiable. */
function assertKeyEnvironment(
  secretKey: string,
  tenantId: TenantId,
  environment: DeploymentEnvironment | undefined,
): void {
  if (environment === undefined) return;
  const keyEnvironment = keyEnvironmentOf(secretKey);
  if (keyEnvironment !== null && keyEnvironment !== environment) {
    throw new AppError("payment.credential_environment_mismatch", {
      tenantId,
      keyEnvironment,
      hostEnvironment: environment,
    });
  }
}

/** Read-site validation of a decrypted `payments.stripe` payload — the pure counterpart of
 * `apps/server`'s `stripeSecretKeyFrom`. A payload missing `secretKey` cannot build a client, so it
 * is rejected here rather than reaching the SDK with an undefined key; the environment-prefix guard
 * runs when `environment` is supplied. */
export function secretKeyFromSealed(
  payload: Record<string, string>,
  tenantId: TenantId,
  environment?: DeploymentEnvironment,
): string {
  const secretKey = payload.secretKey;
  if (secretKey === undefined || secretKey === "")
    throw new AppError("payment.provider_credential_rejected", { providerId: PROVIDER_ID });
  assertKeyEnvironment(secretKey, tenantId, environment);
  return secretKey;
}

/** Read the tenant's sealed `payments.stripe` credential and validate/decrypt it into a secret key.
 * The read happens on each call so provisioning and rotation take effect without a restart. */
async function secretKeyForTenant(deps: {
  db: Database;
  ring: KeyRing;
  tenantId: TenantId;
  environment?: DeploymentEnvironment;
}): Promise<string> {
  const payload = await withTenant(deps.db, deps.tenantId, (tx) =>
    getCredential(tx, deps.ring, { tenantId: deps.tenantId, purpose: CREDENTIAL_PURPOSE }),
  );
  return secretKeyFromSealed(payload, deps.tenantId, deps.environment);
}

/** A `StripeClient` that resolves the real client (from the sealed credential) on first use. `build`
 * must return synchronously, but reading the credential is asynchronous; every `StripeClient` method
 * is async, so deferring the read to the first call is transparent to `StripeTerminalProvider`. The
 * resolved client is cached for the provider's lifetime, and a failed read is not cached, so a
 * transient database error is retried on the next sale rather than bricking the provider. Mirrors
 * payments-sumup's `deferredClient`. */
export function deferredStripeClient(deps: {
  db: Database;
  ring: KeyRing;
  tenantId: TenantId;
  environment?: DeploymentEnvironment;
  makeStripe: MakeStripe;
}): StripeClient {
  let cached: Promise<StripeClient> | undefined;
  const client = (): Promise<StripeClient> =>
    (cached ??= secretKeyForTenant(deps)
      .then((secretKey) => stripeClient(deps.makeStripe(secretKey)))
      .catch((error: unknown) => {
        cached = undefined;
        throw error;
      }));
  const wrapped = Object.fromEntries(
    CLIENT_METHODS.map((method) => [
      method,
      (...args: unknown[]) =>
        client().then((c) => (c[method] as (...a: unknown[]) => unknown)(...args)),
    ]),
  );
  return wrapped as unknown as StripeClient;
}

/**
 * The Stripe fill of the generic `CardProviderContribution` seat, built over an injectable
 * `makeStripe` so tests never construct a real SDK client. It keeps the Stripe name inside this
 * package: the generic connect route, provider registry and pool reach Stripe only through this
 * value. `connect` verifies the secret key with one account read and assembles the four-field
 * `payments.stripe` payload; `build` turns the sealed credential into a live server-driven
 * `StripeTerminalProvider`; `readers.*` verify and report the merchant's Terminal readers by id.
 *
 * The `stripe_on_device` (Tap-to-Pay) phone path is NOT a reader and is out of this seat.
 */
export function createStripeCardProvider(
  makeStripe: MakeStripe = defaultMakeStripe,
): CardProviderContribution {
  return {
    providerId: PROVIDER_ID,
    credentialPurpose: CREDENTIAL_PURPOSE,
    credentialFields: [
      { name: "secretKey", labelKey: "payments.stripe.secret_key", secret: true },
      { name: "webhookSecret", labelKey: "payments.stripe.webhook_secret", secret: true },
      { name: "successUrl", labelKey: "payments.stripe.success_url", secret: false },
      { name: "cancelUrl", labelKey: "payments.stripe.cancel_url", secret: false },
    ],
    readerAdd: { kind: "reference", refLabelKey: "payments.stripe.reader_id" },

    async connect(deps, payload): Promise<ConnectResult> {
      const secretKey = payload.secretKey;
      if (secretKey === undefined || secretKey === "")
        throw new AppError("payment.provider_credential_rejected", { providerId: PROVIDER_ID });

      // The prefix/environment guard runs BEFORE the network call: a mis-copied live/test key is a
      // provisioning mistake, and Stripe would accept the (valid, wrong-environment) key otherwise.
      if (deps.tenantId !== undefined)
        assertKeyEnvironment(secretKey, deps.tenantId, deps.environment);

      const stripe = makeStripe(secretKey);
      let account: Stripe.Account;
      try {
        // `retrieve(null)` returns the account the key belongs to; a bad key answers with an error,
        // which is exactly the rejected-credential signal.
        account = await stripe.accounts.retrieve(null);
      } catch {
        throw new AppError("payment.provider_credential_rejected", { providerId: PROVIDER_ID });
      }

      return {
        merchantName: account.settings?.dashboard?.display_name ?? account.id,
        sealedPayload: {
          secretKey,
          webhookSecret: payload.webhookSecret,
          successUrl: payload.successUrl,
          cancelUrl: payload.cancelUrl,
        },
      };
    },

    build(deps: CardProviderBuildDeps): PaymentProvider {
      return new StripeTerminalProvider({
        client: deferredStripeClient({
          db: deps.db,
          ring: deps.ring,
          tenantId: deps.tenantId,
          environment: deps.environment,
          makeStripe,
        }),
        db: deps.db,
        tenantId: deps.tenantId,
        nodeId: deps.nodeId,
      });
    },

    readers: {
      async add(deps: CardProviderRuntimeDeps, input): Promise<AddReaderResult> {
        // Stripe's reader-add mode is `reference`, so the route always supplies a reader id; its
        // absence is a caller-contract violation, not a runtime condition an operator can act on.
        if (input.reference === undefined)
          throw new Error("stripe readers.add requires a reader reference");
        const secretKey = await secretKeyForTenant(deps);
        // One retrieve verifies the id exists (and that this account owns it); a bad id throws.
        await makeStripe(secretKey).terminal.readers.retrieve(input.reference);
        return { providerRef: input.reference, status: "paired" };
      },

      async status(deps: CardProviderRuntimeDeps, providerRef: string): Promise<ReaderStatus> {
        try {
          const secretKey = await secretKeyForTenant(deps);
          const reader = await makeStripe(secretKey).terminal.readers.retrieve(providerRef);
          // `retrieve` types as `Reader | DeletedReader`; only `Reader` carries `status`/`device_type`.
          const online = "status" in reader && reader.status === "online";
          const detail = "device_type" in reader ? reader.device_type : undefined;
          // A Stripe reference reader is paired the instant it is added (verified by one retrieve), so
          // there is nothing to poll for pairing — it is always `"paired"` once it resolves. Reported
          // for contract consistency; the Stripe add flow never polls.
          return { online, pairingStatus: "paired", ...(detail !== undefined ? { detail } : {}) };
        } catch {
          // A reader page must render an unreadable status as offline, never crash — an unknown or
          // removed reader, or a Stripe outage, is reported, not rethrown.
          return { online: false, detail: "unreachable" };
        }
      },

      async remove(): Promise<void> {
        // No vendor call: a Stripe Terminal reader stays registered at Stripe. Removing the local
        // `card_readers` row is the route's job; there is nothing to unpair on the vendor side.
      },
    },
  };
}

/** The Stripe seat wired with the real SDK. Tests build their own via `createStripeCardProvider`
 * with an injected `makeStripe`. */
export const STRIPE_CARD_PROVIDER: CardProviderContribution = createStripeCardProvider();
