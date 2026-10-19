import type { KeyRing } from "@waitron/credentials";
import type { Database, DeploymentEnvironment, Transaction } from "@waitron/db";
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
  readonly observeAuthorityTime?: (sample: {
    authorityTimestamp: string | null;
    sentAt: Date;
    receivedAt: Date;
  }) => void;
}

export interface FiscalCertificateAnswer {
  readonly outcome: "installed" | "refused";
  readonly reason: string;
  readonly field?: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

export interface FiscalCertificateSeat {
  /** The card, as JSON the host passes on unread. One transaction; `authorize` runs first in it. */
  read(
    deps: {
      db: Database;
      nodeId: string;
      locationId: string;
      authorize(tx: Transaction): Promise<void>;
      nameOf(tx: Transaction, personId: string): Promise<string | null>;
    },
    now: Date,
  ): Promise<Readonly<Record<string, unknown>>>;
  /** Every check, then one write; a refusal is an answer, not a throw. Throws only for the request
   * itself. `authorize` runs in the read before anything leaves the box, and again in the write. */
  install(
    deps: {
      db: Database;
      ring: KeyRing;
      nodeId: string;
      locationId: string;
      environment: DeploymentEnvironment;
      authorize(tx: Transaction): Promise<{ personId: string }>;
      log?: FiscalDutyLog;
      /** Read after AEAT answers and again in the write; `now` is when the request began. */
      clock?: () => Date;
    },
    body: unknown,
    now: Date,
  ): Promise<FiscalCertificateAnswer>;
  /** The ongoing expiry alerts for the certificate `nodeId` installed last, read in `tx`. */
  alerts(
    tx: Transaction,
    deps: { nodeId: string; locationId: string },
    now: Date,
  ): Promise<
    readonly {
      key: string;
      code: string;
      params: Readonly<Record<string, unknown>>;
      severity: "warning" | "error";
      since: string | null;
      screen?: string;
    }[]
  >;
  /** Expiry emails for the certificate `nodeId` installed last: at most one per person per stage. */
  reminders: {
    /** Claims the next email due, or `null`; the caller sends it, then reports how it ended. */
    claim(
      tx: Transaction,
      deps: { nodeId: string; locationId: string },
      recipients: readonly { personId: string; email: string; language: "en" | "es" }[],
      now: Date,
    ): Promise<{ id: string; recipient: string; subject: string; text: string } | null>;
    report(
      tx: Transaction,
      deps: { nodeId: string },
      id: string,
      outcome: "sent" | "rejected" | "unknown",
      now: Date,
    ): Promise<void>;
  };
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
  /** Regimes with stored fiscal records probe their environment before boot migrates anything.
   * An absent regime table is an empty history; an unknown record environment is not production. */
  hasNonproductionRecords?(db: Database): Promise<boolean>;
  /** Saved authority refusals from the isolated readiness sample, without changing its records. */
  readinessRejections?(db: Database): Promise<{ code: string | null; message: string | null }[]>;
  /** The SALE-PATH backend: it records locally and never contacts an authority — nothing external
   * may block a sale. */
  makeBackend(deps: FiscalBackendDeps): FiscalBackend;
  /** One runtime submission pass: the seat that does contact the authority. */
  drain(deps: FiscalDutyDeps, now: Date): Promise<DrainResult>;
  /** Returns every submission a previous run left in flight to the queue, with no wait. The server
   * calls it before its first `drain` (`apps/server/src/restart-reset.ts`), when nothing in flight
   * can belong to a live pass of this process. Required, so a regime that files cannot omit it. */
  resetInFlight(deps: { readonly db: Database }, now: Date): Promise<void>;
  /** The provision-time secret this regime seals into a fresh venue's vault. The host holds the
   * opaque blob but does not know its shape, so it reaches the regime through this seat. */
  readonly provisioningSecret?: {
    /** Whether a provision in `environment` must carry the secret. */
    required(environment: DeploymentEnvironment): boolean;
    /** Validate the secret's SHAPE, throwing `setup.request_invalid` naming the offending field,
     * and writing NOTHING. Run BEFORE `provisionVenue` mints the unrepairable SIF/hash chain
     * (CLAUDE.md §5). */
    validate(raw: unknown): void;
    /** Seal the secret into the venue's vault in its own transaction, re-validating it. `nodeId`
     * is the node whose vault holds the secret. */
    seal(deps: { db: Database; ring: KeyRing; nodeId: string }, raw: unknown): Promise<void>;
  };
  /** The operator-typed venue fields this regime puts on the wire verbatim, reached through this
   * seat because the host does not know the regime's rules. `validate` throws
   * `setup.request_invalid` naming ONE offending field and writes nothing. Run it BEFORE
   * provisioning mints the unrepairable SIF and hash chain (CLAUDE.md §5). */
  readonly venueFields?: {
    readonly defaults?: { readonly operationDescription: string };
    validateOperationDescription(description: string): void;
    validateLegalName(name: string): void;
    validate(venue: {
      readonly legalName: string;
      readonly seriesCode: string;
      readonly fullSeriesCode: string;
      readonly rectificativeSeriesCode: string;
      readonly operationDescription: string;
    }): void;
  };
  readonly certificate?: FiscalCertificateSeat;
}
