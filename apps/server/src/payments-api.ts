import { MODULES_SETTINGS } from "./modules.js";
import { withIssuanceTransaction } from "@waitron/core";
import { requireEconomicWrite } from "./trading-admission.js";
import "./errors.js";
import type { Hono } from "hono";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { isFencedStanding, standingOf } from "@waitron/membership";
import { isReadableChart } from "./membership-trust.js";
import { readTakenOverFrom } from "./handover-collection.js";
import { AppError, isAppError } from "@waitron/shared";
import { readSettings, readNodeMembership, type Transaction } from "@waitron/db";
import {
  PAYMENTS_SETTINGS,
  cardReaders,
  SimulatorPaymentProvider,
  payments,
  type AbandonedAttemptOutcome,
  type CardProviderContribution,
  type CardProviderRuntimeDeps,
  type PaymentProvider,
} from "@waitron/payments";
import { venueCredentials } from "@waitron/credentials";
import {
  authorizeManager,
  createPinThrottle,
  verifyThrottledCredential,
  type SecretCheck,
} from "@waitron/identity";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { withSettledSlip, type SettledSlipPrinter } from "./payment-slip-print.js";
import { inPinTurn, withPinCheckAhead } from "./pin-check-ahead.js";
import { type PaymentsApiDeps, PAYMENTS_MANAGE } from "./payments-api-deps.js";
import { mountPaymentsReaderAdoptionRoutes } from "./payments-reader-adoption-routes.js";
import { mountPaymentsBackupAuditRoutes } from "./payments-backup-audit-routes.js";
import { mountPaymentsProviderSettingsRoutes } from "./payments-provider-settings-routes.js";
import { mountPaymentsReaderRoutes } from "./payments-readers-routes.js";
import { mountPaymentsReaderAssignmentRoutes } from "./payments-reader-assignments-routes.js";
import { mountPaymentsResolutionRoutes } from "./payments-resolution-routes.js";
import { mountPaymentsAbandonedRefundRoutes } from "./payments-abandoned-refunds-routes.js";
import { mountPaymentsHeldRoutes } from "./payments-held-routes.js";
import { mountPaymentsRefundRoutes } from "./payments-refunds-routes.js";

/** The throttle's slot for a PIN entered on the dashboard, so it keys on the person alone
 * and a new management session does not start the count again. */
const DASHBOARD_PIN_SLOT = "management";

/**
 * Provider calls reach the network, so they run outside any transaction; the `gated` authorisation
 * runs first, in its own transaction, so an unauthorised caller never reaches the provider.
 */
export function mountPaymentsApi(app: Hono, deps: PaymentsApiDeps, log: Logger): void {
  const collectionScope = async (tx: Transaction) => {
    const takenOverFrom = await readTakenOverFrom(tx, deps.cfg.nodeId);
    const held = deps.isPrimary() ? await readNodeMembership(tx) : null;
    const replaced =
      held !== null &&
      isReadableChart(held) &&
      standingOf(held, deps.cfg.nodeId) === "serving-primary"
        ? [
            ...held.body.nodes
              .filter((node) => isFencedStanding(node.standing))
              .map((node) => node.nodeId),
            ...(held.body.revoked ?? []),
          ]
        : [];
    return or(
      inArray(payments.nodeId, [
        deps.cfg.nodeId,
        ...takenOverFrom,
        ...(deps.isPrimary() ? replaced : []),
      ]),
      deps.isPrimary() ? isNull(payments.nodeId) : undefined,
    );
  };
  const gated = <T>(
    sessionId: string,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ): Promise<T> =>
    withIssuanceTransaction(
      deps.db,
      async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: PAYMENTS_MANAGE,
        });
        await requireEconomicWrite(tx, deps.cfg, deps.admission);
        return fn(tx, authorizedBy);
      },
      log,
    );

  const refuseUntilRecordable = (tx: Transaction) =>
    deps.backend.refuseUntilRecordable(tx, deps.clock.now());

  const pinThrottle = deps.pinThrottle ?? createPinThrottle();
  const attempts = { throttle: pinThrottle, slot: DASHBOARD_PIN_SLOT };

  const managerPinToCheck = async (
    sessionId: string,
    pin: unknown,
  ): Promise<{ personId: string; pin: unknown }> => {
    const { authorizedBy } = await authorizeManager(deps.db, {
      managementSessionId: sessionId,
      permission: PAYMENTS_MANAGE,
      touch: false,
    });
    return { personId: authorizedBy, pin };
  };

  const pinGated = async <T>(
    sessionId: string,
    pin: unknown,
    fn: (tx: Transaction, personId: string, print: SettledSlipPrinter) => Promise<T>,
  ): Promise<T> => {
    const credential = await managerPinToCheck(sessionId, pin);
    const transaction = (checked: SecretCheck | undefined) =>
      withSettledSlip((print) =>
        gated(sessionId, async (tx, personId) => {
          await verifyThrottledCredential(tx, personId, pin, attempts, checked);
          return fn(tx, personId, print);
        }),
      );
    if (typeof credential.pin !== "string") {
      // Count malformed attempts after the earlier PIN checks have settled, without deriving a key.
      return inPinTurn(attempts, credential.personId, () => transaction(undefined));
    }
    return withPinCheckAhead(
      deps.db,
      { personId: credential.personId, pin: credential.pin },
      attempts,
      transaction,
    );
  };

  /**
   * Asks the provider what became of an abandoned attempt. `payment.not_found` from it means a
   * concurrent resolve settled the row after the caller's check, answered with `notStuck`.
   */
  const resolveAtProvider = async (
    attempt: { provider: string; paymentRef: string },
    personId: string,
    notStuck: () => AppError,
  ): Promise<{ provider: PaymentProvider; resolved: AbandonedAttemptOutcome; now: Date }> => {
    const provider =
      attempt.provider === "simulator"
        ? new SimulatorPaymentProvider(deps.db)
        : await deps.pool.get(attempt.provider);
    if (provider.resolveAbandonedAttempt === undefined) {
      throw new AppError("payment.resolve_unsupported", { providerId: attempt.provider });
    }
    const now = deps.clock.now().instant;
    try {
      const resolved = await provider.resolveAbandonedAttempt(attempt.paymentRef, now, {
        personId,
      });
      return { provider, resolved, now };
    } catch (error) {
      if (isAppError(error) && error.code === "payment.not_found") throw notStuck();
      throw error;
    }
  };

  const runtimeDeps = (): CardProviderRuntimeDeps => ({
    db: deps.db,
    ring: deps.ring,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });

  const requireConnected = async (
    tx: Transaction,
    seat: CardProviderContribution,
  ): Promise<void> => {
    const [credential] = await tx
      .select({ purpose: venueCredentials.purpose })
      .from(venueCredentials)
      .where(eq(venueCredentials.purpose, seat.credentialPurpose));
    if (credential === undefined)
      throw new AppError("reader.provider_disconnected", { providerId: seat.providerId });
  };
  const requirePaymentsEnabled = async (tx: Transaction): Promise<void> => {
    if (
      deps.paymentsEnabled === false ||
      (await readSettings(tx, MODULES_SETTINGS)).doc.modules.payments === false
    )
      throw new AppError("module.disabled", { module: "payments" });
  };
  const requireEnabled = async (tx: Transaction, seat: CardProviderContribution): Promise<void> => {
    await requirePaymentsEnabled(tx);
    const { doc } = await readSettings(tx, PAYMENTS_SETTINGS);
    if (doc.providers[seat.providerId] === false)
      throw new AppError("payment.provider_disabled", { providerId: seat.providerId });
  };
  const readerWhere = (id: string) => eq(cardReaders.id, id);
  const requireReader = async (tx: Transaction, id: string) => {
    // No lock is taken: `withTransaction` (`packages/db/src/tenancy.ts`) runs one write
    // transaction per file at a time, so no other write lands between this read and the caller's
    // own write in the same `gated` call.
    const [reader] = await tx
      .select()
      .from(cardReaders)
      .where(and(readerWhere(id), isNull(cardReaders.deletedAt)));
    if (reader === undefined) throw new AppError("reader.not_found", { id });
    return reader;
  };

  // The readers a Delete or Unpair is working on, from its first transaction until it returns.
  // One process owns a venue's database (`openVenueStore` holds `venue.lock`), so this set holds
  // every one in progress.
  const unpairing = new Set<string>();
  const refuseWhileUnpairing = (id: string): void => {
    if (unpairing.has(id)) throw new AppError("reader.unpair_in_progress", { readerId: id });
  };
  /** Runs `fn`, releasing the reader when it ends if `fn` called `hold`, which refuses one held. */
  const holdingReader = async <T>(id: string, fn: (hold: () => void) => Promise<T>): Promise<T> => {
    let held = false;
    try {
      return await fn(() => {
        refuseWhileUnpairing(id);
        unpairing.add(id);
        held = true;
      });
    } finally {
      if (held) unpairing.delete(id);
    }
  };
  /**
   * Adopts from just before their provider list request until their save ends; a Delete or Unpair
   * calling the provider to remove that reader, even a call that fails, voids them.
   */
  const adopting = new Set<{ provider: string; providerRef: string; stale: boolean }>();
  const removeAtProvider = async (seat: CardProviderContribution, providerRef: string) => {
    try {
      await seat.readers.remove(runtimeDeps(), providerRef);
    } catch (error) {
      if (isAppError(error) && error.code === "credentials.missing")
        throw new AppError("reader.provider_disconnected", { providerId: seat.providerId });
      if (isAppError(error)) throw error;
      throw new AppError(
        "reader.unpair_failed",
        { providerId: seat.providerId },
        { reason: codeOf(error) },
      );
    } finally {
      for (const adopt of adopting)
        if (adopt.provider === seat.providerId && adopt.providerRef === providerRef)
          adopt.stale = true;
    }
  };

  mountPaymentsReaderAdoptionRoutes(
    app,
    deps,
    log,
    gated,
    runtimeDeps,
    requireConnected,
    requireEnabled,
    readerWhere,
    requireReader,
    adopting,
    refuseWhileUnpairing,
    holdingReader,
    removeAtProvider,
  );

  mountPaymentsBackupAuditRoutes(app, deps, log);

  mountPaymentsProviderSettingsRoutes(app, deps, log, gated, requirePaymentsEnabled);

  mountPaymentsReaderRoutes(
    app,
    deps,
    log,
    gated,
    runtimeDeps,
    requireConnected,
    requireEnabled,
    requireReader,
    holdingReader,
    removeAtProvider,
    requirePaymentsEnabled,
    refuseWhileUnpairing,
  );

  mountPaymentsReaderAssignmentRoutes(app, log, gated);

  mountPaymentsResolutionRoutes(
    app,
    deps,
    log,
    gated,
    pinGated,
    collectionScope,
    refuseUntilRecordable,
    requireConnected,
    resolveAtProvider,
  );

  mountPaymentsAbandonedRefundRoutes(app, log, gated);

  mountPaymentsHeldRoutes(app, deps, log, gated, pinGated, refuseUntilRecordable);

  mountPaymentsRefundRoutes(app, deps, log, gated, pinGated, refuseUntilRecordable);
}
