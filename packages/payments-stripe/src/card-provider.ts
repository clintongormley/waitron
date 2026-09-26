import Stripe from "stripe";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { getCredential } from "@waitron/credentials";
import type { KeyRing } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
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
import "./errors.js";

const PROVIDER_ID = "stripe";
const CREDENTIAL_PURPOSE = "payments.stripe";

type DeploymentEnvironment = "preproduction" | "production";

const CLIENT_METHODS = [
  "createPaymentIntent",
  "processPaymentIntent",
  "readerOutcome",
  "cancelReaderAction",
  "retrievePaymentIntent",
  "cancelPaymentIntent",
  "refund",
] as const;

// `deferredStripeClient` casts its wrapper to `StripeClient`, so a method missing from the list
// above would typecheck and fail only when called; this line fails the typecheck instead.
const everyClientMethodListed: Exclude<
  keyof StripeClient,
  (typeof CLIENT_METHODS)[number]
> extends never
  ? true
  : never = true;
void everyClientMethodListed;

export type MakeStripe = (secretKey: string) => Stripe;

export function defaultMakeStripe(secretKey: string): Stripe {
  return new Stripe(secretKey);
}

/** `null` is not a failure: Stripe issues restricted keys (`rk_…`) and may add prefixes we do not
 * know, and refusing one would break a working deployment. A replica of `apps/server`'s
 * `keyEnvironmentOf`. */
function keyEnvironmentOf(secretKey: string): DeploymentEnvironment | null {
  if (secretKey.startsWith("sk_live_")) return "production";
  if (secretKey.startsWith("sk_test_")) return "preproduction";
  return null;
}

/** A test key on a production host takes payments that never settle. */
function assertKeyEnvironment(
  secretKey: string,
  environment: DeploymentEnvironment | undefined,
): void {
  if (environment === undefined) return;
  const keyEnvironment = keyEnvironmentOf(secretKey);
  if (keyEnvironment !== null && keyEnvironment !== environment) {
    throw new AppError("payment.credential_environment_mismatch", {
      keyEnvironment,
      hostEnvironment: environment,
    });
  }
}

export function secretKeyFromSealed(
  payload: Record<string, string>,
  environment?: DeploymentEnvironment,
): string {
  const secretKey = payload.secretKey;
  if (secretKey === undefined || secretKey === "")
    throw new AppError("payment.provider_credential_rejected", { providerId: PROVIDER_ID });
  assertKeyEnvironment(secretKey, environment);
  return secretKey;
}

/** Read on each call, so provisioning and rotation take effect without a restart. */
async function sealedSecretKey(deps: {
  db: Database;
  ring: KeyRing;
  environment?: DeploymentEnvironment;
}): Promise<string> {
  const payload = await withTransaction(deps.db, (tx) =>
    getCredential(tx, deps.ring, { purpose: CREDENTIAL_PURPOSE }),
  );
  return secretKeyFromSealed(payload, deps.environment);
}

/** Resolves the real client on first use, because `build` must return synchronously and reading the
 * credential is not. A failed read is not cached, so a transient error is retried on the next call
 * rather than bricking the provider. */
export function deferredStripeClient(deps: {
  db: Database;
  ring: KeyRing;
  environment?: DeploymentEnvironment;
  makeStripe: MakeStripe;
}): StripeClient {
  let cached: Promise<StripeClient> | undefined;
  const client = (): Promise<StripeClient> =>
    (cached ??= sealedSecretKey(deps)
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

/** The `stripe_on_device` (Tap-to-Pay) phone path is NOT a reader and is outside this seat. */
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

      // Before the network call: Stripe would accept a valid key from the wrong environment.
      assertKeyEnvironment(secretKey, deps.environment);

      const stripe = makeStripe(secretKey);
      let account: Stripe.Account;
      try {
        // `retrieve(null)` returns the account the key belongs to.
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
          environment: deps.environment,
          makeStripe,
        }),
        db: deps.db,
        nodeId: deps.nodeId,
      });
    },

    readers: {
      canUnpair: false,
      async list(deps) {
        const secretKey = await sealedSecretKey(deps);
        // The default account page only; this does not enumerate subsequent pages.
        const page = await makeStripe(secretKey).terminal.readers.list();
        return page.data.map((reader) => ({
          providerRef: reader.id,
          name: reader.label,
          model: reader.device_type,
          serial: reader.serial_number,
        }));
      },
      async add(deps: CardProviderRuntimeDeps, input): Promise<AddReaderResult> {
        if (input.reference === undefined)
          throw new Error("stripe readers.add requires a reader reference");
        const secretKey = await sealedSecretKey(deps);
        await makeStripe(secretKey).terminal.readers.retrieve(input.reference);
        return { providerRef: input.reference, status: "paired" };
      },

      async status(deps: CardProviderRuntimeDeps, providerRef: string): Promise<ReaderStatus> {
        try {
          const secretKey = await sealedSecretKey(deps);
          const reader = await makeStripe(secretKey).terminal.readers.retrieve(providerRef);
          if (!("status" in reader)) return { online: false, unreachable: true };
          return {
            online: reader.status === "online",
            pairingStatus: "paired",
            model: reader.device_type,
            ...(reader.serial_number != null ? { serial: reader.serial_number } : {}),
            ...(reader.device_sw_version != null
              ? { firmwareVersion: reader.device_sw_version }
              : {}),
            ...(reader.ip_address != null ? { connection: reader.ip_address } : {}),
            // Stripe's last_seen_at and JavaScript Date both use milliseconds.
            ...(reader.last_seen_at != null
              ? { lastSeenAt: new Date(reader.last_seen_at).toISOString() }
              : {}),
          };
        } catch {
          return { online: false, unreachable: true };
        }
      },

      async remove(): Promise<void> {
        // No vendor call: a Stripe Terminal reader stays registered at Stripe.
      },
    },
  };
}

export const STRIPE_CARD_PROVIDER: CardProviderContribution = createStripeCardProvider();
