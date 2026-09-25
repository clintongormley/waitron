import Stripe from "stripe";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import { stripeClient, stripeReportClient } from "@waitron/payments-stripe";
import type { StripeReconcileAccount } from "@waitron/payments-stripe";
import type { DeploymentEnvironment } from "./config.js";
import { readCredential } from "./credentials.js";
import "./errors.js";

export interface StripeAccountDeps {
  db: Database;
  ring: KeyRing;
  /** This host's own deployment environment, checked against every resolved key's prefix — see
   * `stripeSecretKeyFrom`. */
  environment: DeploymentEnvironment;
  /** Injected so a test never constructs a real SDK client, and so the KEY this host passes is
   * observable. */
  makeStripe: (secretKey: string) => Stripe;
}

/**
 * Which environment a Stripe secret key belongs to, or `null` when we cannot tell.
 *
 * `null` is not a failure. Stripe issues restricted keys (`rk_…`) and may add prefixes we do not
 * know; refusing an unrecognised key would break a working deployment in order to enforce a check
 * we cannot actually perform. The known prefixes are the ones worth guarding, because they are the
 * ones an operator copies from the wrong dashboard tab.
 */
function keyEnvironmentOf(secretKey: string): DeploymentEnvironment | null {
  if (secretKey.startsWith("sk_live_")) return "production";
  if (secretKey.startsWith("sk_test_")) return "preproduction";
  return null;
}

export function defaultMakeStripe(secretKey: string): Stripe {
  return new Stripe(secretKey);
}

/**
 * Validates the decrypted payload at the READ site, because reads do not validate: a row sealed
 * under an older field list decrypts to a payload missing a field, and `undefined` passed into the
 * Stripe SDK would fail far away with nothing naming the field. Exported so a stale payload can be
 * driven directly. `validatePayload` (`packages/credentials/src/purposes.ts`) refuses an empty
 * required field at write, so this checks only `undefined`, not `""`.
 *
 * Also checks the key's ENVIRONMENT against this host's own: a test key sealed on a production
 * deployment (or vice versa) would otherwise fail far away — card payments never settling, or
 * `reconcile` sweeping a test-mode account against live rows. See `keyEnvironmentOf` for why an
 * unclassifiable key passes through.
 */
export function stripeSecretKeyFrom(
  payload: Record<string, string | undefined>,
  ref: { purpose: string },
  environment: DeploymentEnvironment,
): string {
  const secretKey = payload.secretKey;
  if (secretKey === undefined) {
    throw new AppError("server.credential_unusable", { ...ref, field: "secretKey" });
  }
  const keyEnvironment = keyEnvironmentOf(secretKey);
  if (keyEnvironment !== null && keyEnvironment !== environment) {
    throw new AppError("payment.credential_environment_mismatch", {
      keyEnvironment,
      hostEnvironment: environment,
    });
  }
  return secretKey;
}

/**
 * The shared `readCredential` → `stripeSecretKeyFrom` sequence every resolver below runs: read this
 * tenant's `payments.stripe` credential from the vault and validate/decrypt it into a usable secret
 * key. The environment-prefix guard lives inside `stripeSecretKeyFrom`.
 */
async function resolveStripeSecretKey(deps: StripeAccountDeps): Promise<string> {
  const payload = await readCredential(deps.db, deps.ring, "payments.stripe");
  return stripeSecretKeyFrom(payload, { purpose: "payments.stripe" }, deps.environment);
}

/**
 * `StripeReconcilerOptions.resolveAccount`, wired to the vault. One reconciler is built for the
 * whole settlement identity and swept across tenants, so the resolved ACCOUNT is what scopes each
 * sweep — the accounts are standalone, one per merchant, with no Connect layer to carry the scope.
 *
 * `report` and `refund` are two views of one SDK client: the audit lists balance transactions, and
 * a claimed orphan's reversal issues a refund.
 */
export function stripeAccountResolver(
  deps: StripeAccountDeps,
): () => Promise<StripeReconcileAccount> {
  return async () => {
    const secretKey = await resolveStripeSecretKey(deps);
    const stripe = deps.makeStripe(secretKey);
    return { report: stripeReportClient(stripe), refund: stripeClient(stripe) };
  };
}
