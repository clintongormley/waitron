import Stripe from "stripe";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";
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
   * observable — which is the whole of the tenant scoping on this path. */
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
 * Validates the decrypted payload at the READ site — the same convention `aeat-transport.ts`'s
 * `certMaterialFrom` establishes, and exported as a pure function for the same reason: a stale
 * payload (sealed before a field was required, or written by something other than `putCredential`)
 * can be driven directly, rather than forged through the vault's own write path, which
 * `validatePayload` (packages/credentials/src/purposes.ts) makes impossible for any REQUIRED,
 * empty-string field — `secretKey` among them, so this checks only `undefined`, not `""`.
 *
 * Reads do not validate, so a row sealed under an older field list decrypts to a payload missing a
 * field. Unlike `certKind` (added later, so older rows can lack it), `secretKey` has been declared
 * since the purpose existed, so a stale row lacking it is far less likely — but if this host passed
 * `undefined` into the Stripe SDK, it would fail somewhere far away with nothing naming the tenant
 * or the field.
 *
 * Also checks the key's ENVIRONMENT against `environment`, this host's own deployment environment —
 * the same read-site placement, for the same reason: a test key sealed on a production deployment
 * (or vice versa) would otherwise fail somewhere far away — every card payment silently never
 * settling, or `reconcile` sweeping a test-mode account against live rows — with nothing naming the
 * tenant or explaining why. See `keyEnvironmentOf` for why an unclassifiable key passes through
 * rather than being refused.
 */
export function stripeSecretKeyFrom(
  payload: Record<string, string | undefined>,
  ref: { tenantId: string; purpose: string },
  environment: DeploymentEnvironment,
): string {
  const secretKey = payload.secretKey;
  if (secretKey === undefined) {
    throw new AppError("server.credential_unusable", { ...ref, field: "secretKey" });
  }
  const keyEnvironment = keyEnvironmentOf(secretKey);
  if (keyEnvironment !== null && keyEnvironment !== environment) {
    throw new AppError("payments.credential_environment_mismatch", {
      tenantId: ref.tenantId,
      keyEnvironment,
      hostEnvironment: environment,
    });
  }
  return secretKey;
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
): (tenantId: TenantId) => Promise<StripeReconcileAccount> {
  return async (tenantId) => {
    const payload = await readCredential(deps.db, deps.ring, tenantId, "payments.stripe");
    const secretKey = stripeSecretKeyFrom(
      payload,
      { tenantId, purpose: "payments.stripe" },
      deps.environment,
    );
    const stripe = deps.makeStripe(secretKey);
    return { report: stripeReportClient(stripe), refund: stripeClient(stripe) };
  };
}
