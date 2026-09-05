import type { Database, DeploymentEnvironment } from "@waitron/db";
import type { FiscalBackend } from "./backend.js";
import type { TrustedClock } from "./clock.js";

/** What a host supplies to build the sale-path backend. */
export interface FiscalBackendDeps {
  readonly db: Database;
  readonly clock: TrustedClock;
  /** Which deployment this host is — the value a regime stamps on what it records. */
  readonly environment: DeploymentEnvironment;
}

/**
 * A module's contribution to the fiscal slot — the one provision-only, swappable slot. Exactly one
 * enabled module fills it; the framework selects it and refuses zero or two.
 */
export interface FiscalContribution {
  /** The backend's identifying string: what `sales.fiscal_backend` records and what provisioning
   * stamps into `nodes.filing_module`. Equals `makeBackend(...).id`. */
  readonly id: string;
  /** The SALE-PATH backend: it records locally and never contacts an authority — nothing external
   * may block a sale. The duty that does contact one is a separate, later seat. */
  makeBackend(deps: FiscalBackendDeps): FiscalBackend;
}
