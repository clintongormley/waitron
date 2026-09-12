// Side-effect import: registers `payment.provider_duplicate` / `payment.provider_unknown` on the
// shared `ErrorParams` registry (see ./errors.ts), matching the pattern `./provider.ts` uses for
// the codes it throws.
import "./errors.js";
import type { Database } from "@waitron/db";
import type { KeyRing, Purpose } from "@waitron/credentials";
import { AppError, type TenantId, type TillId } from "@waitron/shared";
import type { PaymentProvider } from "./provider.js";
import type { IncidentSink } from "./reconcile.js";

/** A browser-safe field descriptor for the generic connect form. `secret` fields are password inputs
 * and are never echoed back by any GET. `optional` lets a field (SumUp affiliate) be left blank. */
export interface ProviderCredentialField {
  name: string; // the vault payload key (e.g. "apiKey")
  labelKey: string; // an i18n key the provider's dashboard panel registers
  secret: boolean;
  optional?: boolean;
}

/** How the generic screen renders "add a reader" for this provider. */
export type ReaderAddMode =
  | { kind: "pairing-poll"; codeLabelKey: string } // SumUp: post a code, poll until paired
  | { kind: "reference"; refLabelKey: string }; // Stripe: paste a reader id, verify once

export interface ConnectResult {
  /** The merchant name to show for confirmation; the seat has verified the credentials. */
  merchantName: string;
  /** The COMPLETE payload to seal under `credentialPurpose`, assembled by the seat from the form
   * values plus anything it discovered (SumUp fills in `merchantCode` from the memberships call and
   * the `-` affiliate placeholders). The route validates it with `validatePayload` and seals it
   * verbatim, so the generic route never assembles a provider-shaped payload. */
  sealedPayload: Record<string, string>;
}

export interface AddReaderResult {
  providerRef: string;
  /** For pairing-poll: `processing` until the device confirms; the screen polls status until paired. */
  status: "paired" | "processing";
}

export interface CardProviderContribution {
  readonly providerId: string; // "sumup" | "stripe"
  readonly credentialPurpose: Purpose; // "payments.sumup" | "payments.stripe"
  readonly credentialFields: readonly ProviderCredentialField[];
  readonly readerAdd: ReaderAddMode;
  /** Verify the typed credentials against the provider WITHOUT sealing, and return the merchant name
   * to confirm PLUS the complete payload to seal. Throws `payment.provider_credential_rejected` on a
   * bad credential. If the credential spans several merchants and `payload` names none, throws
   * `payment.provider_merchant_ambiguous` with `{ merchants: [{ code, name }] }` (codes and names are
   * not secrets) so the form offers a picker and re-submits `payload` with the chosen `merchantCode`.
   *
   * `environment` and `tenantId` are the deployment context the route holds: a seat that can tell a
   * key's environment from its shape (Stripe's `sk_live_`/`sk_test_` prefix) refuses a mismatched
   * key with `payment.credential_environment_mismatch` before sealing. Both are optional so a seat
   * that has no such notion (SumUp) ignores them and a caller that cannot supply them skips the
   * guard. */
  connect(
    deps: {
      fetch?: typeof fetch;
      environment?: "preproduction" | "production";
      tenantId?: TenantId;
    },
    payload: Record<string, string>,
  ): Promise<ConnectResult>;
  /** Build the live PaymentProvider from the sealed credential (called by the pool). */
  build(deps: CardProviderBuildDeps): PaymentProvider;
  readers: {
    add(
      deps: CardProviderRuntimeDeps,
      input: { name: string; code?: string; reference?: string },
    ): Promise<AddReaderResult>;
    status(deps: CardProviderRuntimeDeps, providerRef: string): Promise<ReaderStatus>;
    remove(deps: CardProviderRuntimeDeps, providerRef: string): Promise<void>;
  };
}

export interface ReaderStatus {
  online: boolean;
  detail?: string; // connection type, screen state
  /** Where pairing itself stands, DISTINCT from device connectivity (`online`): a reader confirms
   * pairing (`processing → paired`) and only later may go briefly offline. The add-reader dialog
   * polls THIS to decide a pairing succeeded, never `online` — a reader that paired but is momentarily
   * offline is paired. Optional and additive: a provider whose reader is paired the instant it is
   * added (Stripe, a reference) reports `"paired"`, and a caller that predates the field ignores it. */
  pairingStatus?: "processing" | "paired";
}
export interface CardProviderBuildDeps {
  db: Database;
  ring: KeyRing;
  tenantId: TenantId;
  nodeId: string;
  environment: "preproduction" | "production";
  /** The pool supplies this so the built provider resolves each sale's chosen reader ref. */
  resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>;
  /** Where a provider raises `payment.pending_outcome_unactionable` (SumUp's resolvePending). */
  incidents: IncidentSink;
}
export interface CardProviderRuntimeDeps {
  db: Database;
  ring: KeyRing;
  tenantId: TenantId;
  fetch?: typeof fetch;
}

/** Indexes a module list by `providerId` for the registry (Task 9) and the pool (Task 10). Throws
 * `payment.provider_duplicate` rather than letting a later entry silently shadow an earlier one. */
export function selectCardProviders(
  list: readonly CardProviderContribution[],
): Map<string, CardProviderContribution> {
  const byId = new Map<string, CardProviderContribution>();
  for (const c of list) {
    if (byId.has(c.providerId))
      throw new AppError("payment.provider_duplicate", { providerId: c.providerId });
    byId.set(c.providerId, c);
  }
  return byId;
}

/** Looks up one contribution by id, throwing `payment.provider_unknown` rather than returning
 * `undefined` — every caller needs the seat, not a value to null-check. */
export function cardProviderById(
  list: readonly CardProviderContribution[],
  id: string,
): CardProviderContribution {
  const c = selectCardProviders(list).get(id);
  if (c === undefined) throw new AppError("payment.provider_unknown", { providerId: id });
  return c;
}
