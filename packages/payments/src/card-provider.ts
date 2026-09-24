// Side-effect import: registers the `payment.*` codes this file throws.
import "./errors.js";
import type { Database } from "@waitron/db";
import type { KeyRing, Purpose } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import type { PaymentProvider } from "./provider.js";
import type { IncidentSink } from "./reconcile.js";

/** A browser-safe field descriptor for the generic connect form. `secret` fields are password inputs
 * and are never echoed back by any GET. */
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
  /** The COMPLETE payload to seal under `credentialPurpose`. The route validates it with
   * `validatePayload` and seals it verbatim, so the generic route never assembles a provider-shaped
   * payload. */
  sealedPayload: Record<string, string>;
}

export interface AddReaderResult {
  providerRef: string;
  /** For pairing-poll: `processing` until the device confirms; the screen polls status until paired. */
  status: "paired" | "processing";
}

export interface CardProviderContribution {
  readonly providerId: string;
  readonly credentialPurpose: Purpose;
  readonly credentialFields: readonly ProviderCredentialField[];
  readonly readerAdd: ReaderAddMode;
  /** Verify the typed credentials against the provider WITHOUT sealing, and return the merchant name
   * to confirm PLUS the complete payload to seal. Throws `payment.provider_credential_rejected` on a
   * bad credential. If the credential spans several merchants and `payload` names none, throws
   * `payment.provider_merchant_ambiguous` so the form offers a picker and re-submits `payload` with
   * the chosen `merchantCode`.
   *
   * A seat that can tell a key's environment from its shape refuses a key that does not match
   * `environment` with `payment.credential_environment_mismatch` before sealing. */
  connect(
    deps: {
      fetch?: typeof fetch;
      environment?: "preproduction" | "production";
    },
    payload: Record<string, string>,
  ): Promise<ConnectResult>;
  /** Build the live PaymentProvider from the sealed credential (called by the pool). */
  build(deps: CardProviderBuildDeps): PaymentProvider;
  readers: {
    /** Whether remove releases the device registration at the provider. */
    readonly canUnpair: boolean;
    /** The account's readers; a provider unable to enumerate returns an empty list. */
    list(deps: CardProviderRuntimeDeps): Promise<VendorReader[]>;
    add(
      deps: CardProviderRuntimeDeps,
      input: { name: string; code?: string; reference?: string },
    ): Promise<AddReaderResult>;
    status(deps: CardProviderRuntimeDeps, providerRef: string): Promise<ReaderStatus>;
    remove(deps: CardProviderRuntimeDeps, providerRef: string): Promise<void>;
  };
}

export interface VendorReader {
  providerRef: string;
  name: string;
  model?: string;
  serial?: string;
  registeredAt?: string;
}

export interface ReaderStatus {
  online: boolean;
  /** Whole percent, absent when the provider does not report battery. */
  batteryPercent?: number;
  connection?: string;
  activity?: string;
  firmwareVersion?: string;
  lastSeenAt?: string;
  model?: string;
  serial?: string;
  /** The status read failed; the device's connectivity is unknown. */
  unreachable?: boolean;
  /** Where pairing stands, DISTINCT from device connectivity (`online`). The add-reader dialog polls
   * THIS to decide a pairing succeeded, never `online`: a reader that paired but is momentarily
   * offline is paired. */
  pairingStatus?: "processing" | "paired";
}
export interface CardProviderBuildDeps {
  db: Database;
  ring: KeyRing;
  nodeId: string;
  environment: "preproduction" | "production";
  /** Where a provider raises `payment.pending_outcome_unactionable`. */
  incidents: IncidentSink;
}
export interface CardProviderRuntimeDeps {
  db: Database;
  ring: KeyRing;
  fetch?: typeof fetch;
}

/** Throws `payment.provider_duplicate` rather than letting a later entry silently shadow an earlier
 * one. */
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
