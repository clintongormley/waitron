import type { KeyRing } from "@waitron/credentials";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import type { DrainResult, FiscalBackend } from "./backend.js";
import type { TrustedClock } from "./clock.js";

/** What a host supplies to build the sale-path backend. */
export interface FiscalBackendDeps {
  readonly db: Database;
  readonly clock: TrustedClock;
  /** Which deployment this host is — the value a regime stamps on what it records. */
  readonly environment: DeploymentEnvironment;
}

/** A minimal generic log sink so a regime's duty need not import apps/server's Logger. */
export type FiscalDutyLog = (
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
) => void;

/** What a host injects to run one runtime submission pass. The module owns its transport; the host
 * owns the vault ring, the deployment identity, and the retry cadence. */
export interface FiscalDutyDeps {
  readonly db: Database;
  readonly ring: KeyRing;
  readonly environment: DeploymentEnvironment;
  readonly skipRetryMs: number;
  readonly log?: FiscalDutyLog;
}

/**
 * A module's contribution to the fiscal slot — the one provision-only, swappable slot. Exactly one
 * enabled module fills it; the framework selects it and refuses zero or two.
 */
export interface FiscalContribution {
  /** The backend's identifying string: what `sales.fiscal_backend` records and what provisioning
   * stamps into `nodes.filing_module`. Equals `makeBackend(...).id`. */
  readonly id: string;
  /** The server-controlled evidence required before first production activation. */
  readonly activationReadiness: "accepted-test-submission" | "not-applicable";
  /** The exact preproduction authority endpoint bound into activation evidence. */
  activationReadinessTarget?(secret: unknown): string | null;
  /** The SALE-PATH backend: it records locally and never contacts an authority — nothing external
   * may block a sale. The duty that does contact one is a separate, later seat. */
  makeBackend(deps: FiscalBackendDeps): FiscalBackend;
  /** One runtime submission pass. A regime with nothing to submit (id "none") returns the empty
   * DrainResult. The sale-path backend (makeBackend) never contacts an authority; this does. */
  drain(deps: FiscalDutyDeps, now: Date): Promise<DrainResult>;
  /** The provision-time secret this regime seals into a fresh venue's vault (a Veri*Factu venue's
   * AEAT signing certificate; absent for a regime that files nothing). The host holds the opaque
   * blob and the vault ring but does not know the regime's shape, so it reaches the regime through
   * this seat: `required` decides whether the environment demands the secret, `validate` refuses a
   * malformed one WITHOUT any write, and `seal` writes it under the tenant's transaction. */
  readonly provisioningSecret?: {
    /** Whether a provision in `environment` must carry the secret (Veri*Factu: production only). */
    required(environment: DeploymentEnvironment): boolean;
    /** Validate the opaque secret's SHAPE, throwing `setup.request_invalid` naming the offending
     * field, and writing NOTHING. Run BEFORE `provisionVenue` mints the unrepairable SIF/hash chain
     * (CLAUDE.md §5) so a malformed secret is refused with nothing stamped or minted. */
    validate(raw: unknown): void;
    /** Seal the (validated) secret into the tenant's vault under `withTenant`. Runs AFTER the tenant
     * is minted — the vault row FK-restricts to it — and re-validates as defense-in-depth. */
    seal(deps: { db: Database; ring: KeyRing }, tenantId: string, raw: unknown): Promise<void>;
  };
  /** The operator-typed venue fields this regime puts on the wire verbatim. The host collects them
   * and does not know the regime's rules, so — exactly as `provisioningSecret` does for the signing
   * certificate — it reaches them through this seat. `validate` throws `setup.request_invalid`
   * naming ONE offending field and writes nothing; it is run BEFORE `provisionVenue` mints the
   * unrepairable SIF and hash chain (CLAUDE.md §5). A regime that files nothing offers no seat and
   * its venues are not checked, because there is no filing format to violate. */
  readonly venueFields?: {
    readonly defaults?: { readonly operationDescription: string };
    validateOperationDescription(description: string): void;
    validate(venue: {
      readonly legalName: string;
      readonly seriesCode: string;
      readonly rectificativeSeriesCode: string;
      readonly operationDescription: string;
    }): void;
  };
}
