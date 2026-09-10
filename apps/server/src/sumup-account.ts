import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";
import { AppError } from "@waitron/shared";
import { sumupClient } from "@waitron/payments-sumup";
import type { SumUpClient, SumUpClientOptions } from "@waitron/payments-sumup";
import { readCredential } from "./credentials.js";
import "./errors.js";

export interface SumUpAccountDeps {
  db: Database;
  ring: KeyRing;
  /** Injected so a test observes the requests and never reaches the network. */
  fetch?: typeof fetch;
}

/** The literal an operator seals when the merchant has no affiliate key. */
const NO_AFFILIATE = "-";

/** Validates the decrypted payload at the READ site (the `stripeSecretKeyFrom` convention: a row
 * sealed under an older field list decrypts to a payload missing a field, and the host must name
 * the tenant and the field rather than fail somewhere far away). */
export function sumupClientOptionsFrom(
  payload: Record<string, string | undefined>,
  ref: { tenantId: string; purpose: string },
): Pick<SumUpClientOptions, "apiKey" | "merchantCode" | "affiliate"> {
  for (const field of ["apiKey", "merchantCode", "affiliateAppId", "affiliateKey"] as const) {
    if (payload[field] === undefined)
      throw new AppError("server.credential_unusable", { ...ref, field });
  }
  const affiliate =
    payload.affiliateAppId === NO_AFFILIATE || payload.affiliateKey === NO_AFFILIATE
      ? undefined
      : { appId: payload.affiliateAppId!, key: payload.affiliateKey! };
  return {
    apiKey: payload.apiKey!,
    merchantCode: payload.merchantCode!,
    ...(affiliate ? { affiliate } : {}),
  };
}

export function sumupClientResolver(
  deps: SumUpAccountDeps,
): (tenantId: TenantId) => Promise<SumUpClient> {
  return async (tenantId) => {
    const payload = await readCredential(deps.db, deps.ring, tenantId, "payments.sumup");
    const options = sumupClientOptionsFrom(payload, { tenantId, purpose: "payments.sumup" });
    return sumupClient({ ...options, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  };
}
