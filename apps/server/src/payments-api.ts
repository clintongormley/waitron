// Side-effect only: loads this host's errors.ts augmentation for the codes these routes throw.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { AppError, centsToDecimal, isAppError, tillId as brandTillId } from "@waitron/shared";
import {
  billPaymentRefunds,
  billPayments,
  devices,
  nowIso,
  tills,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  cardProviderById,
  cardReaders,
  deviceCardReaders,
  findPaymentByBillPayment,
  payments,
  type AbandonedAttemptOutcome,
  type CardProviderContribution,
  type CardProviderRuntimeDeps,
  type PaymentProvider,
} from "@waitron/payments";
import {
  deleteCredential,
  putCredential,
  tenantCredentials,
  validatePayload,
  type KeyRing,
} from "@waitron/credentials";
import {
  authorizeManager,
  createPinThrottle,
  verifyPersonCredential,
  type Permission,
  type PinThrottle,
} from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { requireBodyUuid, requireString, requireUuidParam } from "@waitron/server-kit";
import type { DeploymentEnvironment } from "./config.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { billPaymentIsLive, completeBillPayment, failBillPayment } from "./bill-payments.js";
import { CHARGED, settleFromProviderRow } from "./bill-payments-loop.js";
import {
  attestCardRefund,
  billRefundIsLive,
  refundProvidersOf,
  resumeCardRefund,
} from "./bill-refunds.js";
import {
  clearPaymentAttemptMark,
  paymentAttemptIsLive,
  payWorkingOrderIntegrated,
} from "./till-sale.js";

/**
 * The routes never import a provider package. `fetch` is injected by tests; the live host omits it and the seats fall back to the global.
 */
export interface PaymentsApiDeps {
  db: Database;
  /** For filing the sale of a stuck payment the provider reports captured. */
  backend: FiscalBackend;
  clock: TrustedClock;
  cfg: TillConfig;
  ring: KeyRing;
  environment: DeploymentEnvironment;
  pool: CardProviderPool;
  providers: readonly CardProviderContribution[];
  /** The practice simulator, when this installation built one: a bill refund it took is resolved
   * through it. */
  simulator?: PaymentProvider;
  fetch?: typeof fetch;
  /** Injected by tests; production gets one `createPinThrottle()` per mount. */
  pinThrottle?: PinThrottle;
}

const PAYMENTS_MANAGE: Permission = "payments.manage";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "payment.provider_unknown": 404,
  "payment.provider_credential_rejected": 422,
  "payment.credential_environment_mismatch": 422,
  "payment.provider_merchant_ambiguous": 409,
  "payment.provider_in_use": 409,
  "payment.pairing_refused": 422,
  "reader.provider_disconnected": 409,
  "reader.not_found": 404,
  "reader.not_listed": 422,
  "device.not_found": 404,
  "payment.not_stuck": 409,
  "payment.resolve_unsupported": 422,
  "payment.outcome_unknown": 409,
  "bill.payment_not_found": 404,
  "bill.refund_not_found": 404,
  "bill.refund_not_stuck": 409,
  "bill.refund_outcome_unconfirmed": 409,
  "bill.attestation_contradicted": 409,
  "bill.payment_not_stuck": 409,
  "bill.payment_outcome_unconfirmed": 409,
  "payment.not_refundable": 409,
  "payment.refund_exceeds_capture": 422,
  "pin.invalid": 401,
  "pin.throttled": 429,
};

/** The throttle's device slot for a PIN entered on the dashboard, so it keys on the person alone
 * and a new management session does not start the count again. */
const DASHBOARD_PIN_SLOT = "management";

const run = createErrorBoundary(STATUS, "payments.failed");

/** `provider` with a `collect` that refuses, so a pay through it can file a payment already
 * captured but can never charge a card. */
function withoutCollect(provider: PaymentProvider): PaymentProvider {
  return new Proxy(provider, {
    get: (target, prop) => {
      if (prop === "collect") {
        return () =>
          Promise.reject(new Error("a stuck payment's resolve must never collect a new payment"));
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The request fields of a manager's confirmed outcome, before the PIN is checked. */
function parseAttestation<O extends string>(
  body: Record<string, unknown>,
  outcomes: readonly O[],
): { outcome: O; note: string; pin: unknown } {
  const outcome = body.outcome;
  if (!outcomes.includes(outcome as O)) {
    throw new AppError("management.request_invalid", { field: "outcome" });
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note === "") throw new AppError("management.request_invalid", { field: "note" });
  return { outcome: outcome as O, note, pin: body.pin };
}

/** `reason` and, when the provider named one, `providerStatus` of an unknown outcome. */
function unknownOutcome(resolved: Extract<AbandonedAttemptOutcome, { outcome: "unknown" }>) {
  return {
    reason: resolved.reason,
    ...(resolved.providerStatus === undefined ? {} : { providerStatus: resolved.providerStatus }),
  };
}

function screenStringMap(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(body)) {
    if (typeof value !== "string") throw new AppError("management.request_invalid", { field });
    out[field] = value;
  }
  return out;
}

/**
 * Provider calls reach the network, so they run outside any transaction; the `gated` authorisation
 * runs first, in its own transaction, so an unauthorised caller never reaches the provider.
 */
export function mountPaymentsApi(app: Hono, deps: PaymentsApiDeps, log: Logger): void {
  const gated = <T>(
    sessionId: string,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: PAYMENTS_MANAGE,
      });
      return fn(tx, authorizedBy);
    });

  const pinThrottle = deps.pinThrottle ?? createPinThrottle();

  /** Re-checks the manager's own PIN, refusing `pin.throttled` after too many wrong ones. */
  const verifyManagerPin = async (tx: Transaction, personId: string, pin: unknown) => {
    pinThrottle.check(DASHBOARD_PIN_SLOT, personId);
    try {
      if (typeof pin !== "string") throw new AppError("pin.invalid", {});
      await verifyPersonCredential(tx, personId, pin);
    } catch (error) {
      if (isAppError(error) && error.code === "pin.invalid") {
        pinThrottle.recordFailure(DASHBOARD_PIN_SLOT, personId);
      }
      throw error;
    }
    pinThrottle.clear(DASHBOARD_PIN_SLOT, personId);
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
    const provider = await deps.pool.get(attempt.provider);
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
      .select({ purpose: tenantCredentials.purpose })
      .from(tenantCredentials)
      .where(eq(tenantCredentials.purpose, seat.credentialPurpose));
    if (credential === undefined)
      throw new AppError("reader.provider_disconnected", { providerId: seat.providerId });
  };
  const readerWhere = (id: string) => eq(cardReaders.id, id);
  const requireReader = async (tx: Transaction, id: string) => {
    // No lock is taken: `withTransaction` (`packages/db/src/tenancy.ts`) runs one write
    // transaction per file at a time, so no other write lands between this read and the caller's
    // own write in the same `gated` call. The unpair route reads and writes in separate
    // transactions with the provider call between them, so its decision is taken on a row it no
    // longer holds.
    const [reader] = await tx.select().from(cardReaders).where(readerWhere(id));
    if (reader === undefined) throw new AppError("reader.not_found", { id });
    return reader;
  };

  app.get("/management-api/payments/providers/:id/available-readers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const seat = cardProviderById(deps.providers, c.req.param("id"));
      await gated(sessionId, (tx) => requireConnected(tx, seat));
      const listed = await seat.readers.list(runtimeDeps());
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({ providerRef: cardReaders.providerRef, active: cardReaders.active })
          .from(cardReaders)
          .where(eq(cardReaders.provider, seat.providerId)),
      );
      const registered = new Map(rows.map((row) => [row.providerRef, row.active]));
      return c.json(
        listed.map((reader) => ({
          ...reader,
          status: !registered.has(reader.providerRef)
            ? "available"
            : registered.get(reader.providerRef)
              ? "added"
              : "disabled",
        })),
      );
    }),
  );

  app.post("/management-api/payments/readers/adopt", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const providerId = requireString(body.providerId, "providerId");
      const providerRef = requireString(body.providerRef, "providerRef");
      const name = requireString(body.name, "name").trim();
      if (!name) throw new AppError("management.request_invalid", { field: "name" });
      const seat = cardProviderById(deps.providers, providerId);
      await gated(sessionId, (tx) => requireConnected(tx, seat));
      const listed = await seat.readers.list(runtimeDeps());
      if (!listed.some((reader) => reader.providerRef === providerRef))
        throw new AppError("reader.not_listed", { providerId });
      // Re-read after the network call; as in pairing below, the residual disconnect window remains.
      // Adoption creates nothing at the provider to roll back.
      const row = await gated(sessionId, async (tx) => {
        await requireConnected(tx, seat);
        const [saved] = await tx
          .insert(cardReaders)
          .values({ provider: providerId, providerRef, name })
          .onConflictDoUpdate({
            target: [cardReaders.provider, cardReaders.providerRef],
            set: { name, active: true, disabledAt: null, unpairedAt: null },
          })
          .returning({ id: cardReaders.id });
        return saved!;
      });
      return c.json({ id: row.id, status: "paired" }, 201);
    }),
  );

  app.patch("/management-api/payments/readers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CardReaderId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const name = requireString(body.name, "name").trim();
      if (!name) throw new AppError("management.request_invalid", { field: "name" });
      await gated(sessionId, async (tx) => {
        await requireReader(tx, id);
        await tx.update(cardReaders).set({ name }).where(readerWhere(id));
      });
      return c.body(null, 204);
    }),
  );

  for (const action of ["disable", "enable"] as const) {
    app.post(`/management-api/payments/readers/:id/${action}`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "CardReaderId");
        await gated(sessionId, async (tx) => {
          const reader = await requireReader(tx, id);
          if (action === "enable") {
            await requireConnected(tx, cardProviderById(deps.providers, reader.provider));
            if (reader.unpairedAt !== null)
              throw new AppError("reader.not_listed", { providerId: reader.provider });
          }
          await tx
            .update(cardReaders)
            .set({
              active: action === "enable",
              disabledAt: action === "enable" ? null : nowIso(),
            })
            .where(readerWhere(id));
        });
        return c.body(null, 204);
      }),
    );
  }

  app.get("/management-api/payments/providers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // "Connected" = a sealed credential exists for the seat's purpose; only purposes are read,
      // never a secret.
      const rows = await gated(sessionId, (tx) =>
        tx.select({ purpose: tenantCredentials.purpose }).from(tenantCredentials),
      );
      const connected = new Set(rows.map((r) => r.purpose));
      // `merchantName` is omitted: it is not stored, and recovering it would need decrypting the
      // credential and calling the provider. The connect response is where the dashboard learns it.
      return c.json(
        deps.providers.map((p) => ({
          providerId: p.providerId,
          state: connected.has(p.credentialPurpose) ? "connected" : "not_connected",
          credentialFields: p.credentialFields,
          readerAdd: p.readerAdd,
          canUnpair: p.readers.canUnpair,
        })),
      );
    }),
  );

  app.post("/management-api/payments/providers/:id/connect", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const payload = screenStringMap(body);
      // Authorise BEFORE the provider round-trip so an unauthorised caller never reaches the network.
      await gated(sessionId, async () => {});
      const seat = cardProviderById(deps.providers, id); // payment.provider_unknown on a bad id
      // `environment` must be passed: the Stripe seat refuses a wrong-environment key only when it
      // knows the host's environment.
      const { merchantName, sealedPayload } = await seat.connect(
        {
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          environment: deps.environment,
        },
        payload,
      );
      await gated(sessionId, async (tx) => {
        // Validate the seat-assembled payload against the purpose's declared fields before sealing, so
        // a provider that returns a wrong-shaped payload fails loudly rather than sealing junk.
        validatePayload(seat.credentialPurpose, sealedPayload);
        await putCredential(tx, deps.ring, {
          purpose: seat.credentialPurpose,
          value: sealedPayload,
        });
      });
      deps.pool.evict(id);
      // NEVER a secret — only the merchant name the operator confirms.
      return c.json({ merchantName });
    }),
  );

  app.post("/management-api/payments/providers/:id/disconnect", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      await gated(sessionId, async (tx) => {
        const seat = cardProviderById(deps.providers, id); // payment.provider_unknown on a bad id
        // Refused while an active reader uses this provider; the operator disables those first.
        const active = await tx
          .select({ id: cardReaders.id })
          .from(cardReaders)
          .where(and(eq(cardReaders.provider, id), eq(cardReaders.active, true)));
        if (active.length > 0) {
          throw new AppError("payment.provider_in_use", { activeReaders: active.length });
        }
        await deleteCredential(tx, { purpose: seat.credentialPurpose });
      });
      deps.pool.evict(id);
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/payments/readers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // `deviceCount` comes from a separate aggregate: a `sql` scalar correlated to the `.from()`
      // base binds to the subquery's table and answers wrongly (CLAUDE.md §3). `canEnable` is
      // derived here, not as a `sql` predicate, which the engine would answer as 0/1.
      const { readers, counts } = await gated(sessionId, async (tx) => ({
        readers: await tx
          .select({
            id: cardReaders.id,
            provider: cardReaders.provider,
            name: cardReaders.name,
            active: cardReaders.active,
            unpairedAt: cardReaders.unpairedAt,
          })
          .from(cardReaders)
          .orderBy(cardReaders.name),
        counts: await tx
          .select({
            readerId: deviceCardReaders.readerId,
            n: sql<number>`cast(count(*) as int)`,
          })
          .from(deviceCardReaders)
          .groupBy(deviceCardReaders.readerId),
      }));
      const countByReader = new Map(counts.map((r) => [r.readerId, r.n]));
      return c.json(
        readers.map(({ unpairedAt, ...r }) => ({
          ...r,
          canEnable: unpairedAt === null,
          deviceCount: countByReader.get(r.id) ?? 0,
        })),
      );
    }),
  );

  app.post("/management-api/payments/readers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const providerId = requireString(body.providerId, "providerId");
      const name = requireString(body.name, "name");
      const code = body.code === undefined ? undefined : requireString(body.code, "code");
      const reference =
        body.reference === undefined ? undefined : requireString(body.reference, "reference");
      const seat = cardProviderById(deps.providers, providerId); // payment.provider_unknown
      // The provider must be connected first — else the seat's own credential read would fail with an
      // opaque `credentials.missing`. Pre-check gives the actionable `reader.provider_disconnected`.
      await gated(sessionId, async (tx) => {
        const [cred] = await tx
          .select({ purpose: tenantCredentials.purpose })
          .from(tenantCredentials)
          .where(eq(tenantCredentials.purpose, seat.credentialPurpose));
        if (cred === undefined) throw new AppError("reader.provider_disconnected", { providerId });
      });
      const result = await seat.readers.add(runtimeDeps(), {
        name,
        ...(code !== undefined ? { code } : {}),
        ...(reference !== undefined ? { reference } : {}),
      });
      // Re-check after the provider round-trip. This refuses an already-committed disconnect;
      // without a shared lock, a disconnect between this read and commit remains an accepted window.
      const inserted = await gated(sessionId, async (tx) => {
        const [cred] = await tx
          .select({ purpose: tenantCredentials.purpose })
          .from(tenantCredentials)
          .where(eq(tenantCredentials.purpose, seat.credentialPurpose));
        if (cred === undefined) return undefined;
        const [row] = await tx
          .insert(cardReaders)
          .values({
            provider: providerId,
            providerRef: result.providerRef,
            name,
          })
          .returning({ id: cardReaders.id });
        return row;
      });
      if (inserted === undefined) {
        // Disconnected mid-add: best-effort unpair the vendor reader so it is not stranded.
        await seat.readers.remove(runtimeDeps(), result.providerRef).catch(() => {});
        throw new AppError("reader.provider_disconnected", { providerId });
      }
      return c.json({ id: inserted.id, status: result.status }, 201);
    }),
  );

  app.get("/management-api/payments/readers/:id/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const readerId = requireUuidParam(c.req.param("id"), "CardReaderId");
      const reader = await gated(sessionId, async (tx) => {
        const [row] = await tx
          .select({ provider: cardReaders.provider, providerRef: cardReaders.providerRef })
          .from(cardReaders)
          .where(eq(cardReaders.id, readerId));
        if (row === undefined) throw new AppError("reader.not_found", { id: readerId });
        return row;
      });
      const seat = cardProviderById(deps.providers, reader.provider);
      const status = await seat.readers.status(runtimeDeps(), reader.providerRef);
      return c.json(status);
    }),
  );

  app.post("/management-api/payments/readers/:id/unpair", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CardReaderId");
      const reader = await gated(sessionId, (tx) => requireReader(tx, id));
      const seat = cardProviderById(deps.providers, reader.provider);
      if (!seat.readers.canUnpair)
        throw new AppError("management.request_invalid", { field: "providerId" });
      await gated(sessionId, (tx) => requireConnected(tx, seat));
      // Vendor failure leaves the local row unchanged. Disabled rows remain addressable for retries.
      await seat.readers.remove(runtimeDeps(), reader.providerRef);
      // One clock reading for both stamps, so the unpair lands as one moment.
      const unpairedAt = nowIso();
      await gated(sessionId, (tx) =>
        tx
          .update(cardReaders)
          .set({ active: false, disabledAt: unpairedAt, unpairedAt })
          .where(readerWhere(id)),
      );
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/payments/devices/:id/reader", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const deviceId = requireUuidParam(c.req.param("id"), "DeviceId");
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({ readerId: deviceCardReaders.readerId })
          .from(deviceCardReaders)
          .where(eq(deviceCardReaders.deviceId, deviceId)),
      );
      return c.json({ readerId: rows[0]?.readerId ?? null });
    }),
  );

  app.put("/management-api/payments/devices/:id/reader", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const deviceId = requireUuidParam(c.req.param("id"), "DeviceId");
      const body = await readJsonBody<{ readerId?: unknown }>(c);
      // Required: a reader id sets the default, an explicit null clears it.
      if (!("readerId" in body)) {
        throw new AppError("management.request_invalid", { field: "readerId" });
      }
      const readerId = body.readerId === null ? null : requireBodyUuid(body.readerId, "readerId");
      await gated(sessionId, async (tx) => {
        // So an unknown device is `device.not_found`, not a foreign-key refusal (a 500).
        const [device] = await tx
          .select({ id: devices.id })
          .from(devices)
          .where(eq(devices.id, deviceId));
        if (device === undefined) throw new AppError("device.not_found", { deviceId });
        if (readerId === null) {
          await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
          return;
        }
        // A disabled reader is `reader.not_found` too: it is never assignable.
        const [reader] = await tx
          .select({ id: cardReaders.id })
          .from(cardReaders)
          .where(and(eq(cardReaders.id, readerId), eq(cardReaders.active, true)));
        if (reader === undefined) throw new AppError("reader.not_found", { id: readerId });
        await tx
          .insert(deviceCardReaders)
          .values({ deviceId, readerId })
          .onConflictDoUpdate({
            target: [deviceCardReaders.deviceId],
            set: { readerId },
          });
      });
      return c.body(null, 204);
    }),
  );

  // A card payment nothing is driving any more: the order is still marked in flight and the payment
  // still `attempting`, typically because the server stopped mid-collect.
  app.get("/management-api/payments/stuck", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            paymentId: payments.id,
            workingOrderId: workingOrders.id,
            orderNumber: workingOrders.orderNumber,
            label: workingOrders.label,
            tillId: workingOrders.tillId,
            tillName: tills.name,
            provider: payments.provider,
            amount: payments.amount,
            startedAt: payments.createdAt,
          })
          .from(payments)
          .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
          .innerJoin(tills, eq(tills.id, workingOrders.tillId))
          .where(
            and(
              eq(payments.state, "attempting"),
              eq(workingOrders.status, "open"),
              isNotNull(workingOrders.paymentAttemptAt),
            ),
          )
          .orderBy(payments.createdAt),
      );
      return c.json(
        rows
          .filter((row) => !paymentAttemptIsLive(deps.db, row.workingOrderId))
          .map((row) => ({ ...row, amount: centsToDecimal(row.amount) })),
      );
    }),
  );

  // Asks the provider what became of a stuck payment. A capture is filed through the till's own
  // recovery path, over a provider whose `collect` refuses (`withoutCollect`), so the card is never
  // charged again.
  app.post("/management-api/payments/stuck/:id/resolve", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const paymentId = requireUuidParam(c.req.param("id"), "PaymentId");
      const stuck = await gated(sessionId, async (tx, personId) => {
        const [row] = await tx
          .select({
            paymentRef: payments.paymentRef,
            provider: payments.provider,
            state: payments.state,
            workingOrderId: workingOrders.id,
            orderStatus: workingOrders.status,
            attemptAt: workingOrders.paymentAttemptAt,
            tillId: workingOrders.tillId,
          })
          .from(payments)
          .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
          .where(eq(payments.id, paymentId));
        if (
          row?.state !== "attempting" ||
          row.orderStatus !== "open" ||
          row.attemptAt === null ||
          paymentAttemptIsLive(deps.db, row.workingOrderId)
        ) {
          throw new AppError("payment.not_stuck", { paymentId });
        }
        await requireConnected(tx, cardProviderById(deps.providers, row.provider));
        return { ...row, attemptAt: row.attemptAt, personId };
      });

      const { provider, resolved } = await resolveAtProvider(
        stuck,
        stuck.personId,
        () => new AppError("payment.not_stuck", { paymentId }),
      );
      if (resolved.outcome === "unknown") {
        throw new AppError("payment.outcome_unknown", { paymentId, ...unknownOutcome(resolved) });
      }

      if (resolved.outcome === "failed") {
        // Apart from the provider's write on purpose: a crash between the two leaves a mark that the
        // work loop's next `releaseStalePaymentAttempts` pass clears.
        // Only the mark read above: an attempt started since has written its own.
        // Read back rather than trusting the update: the work loop may have cleared the mark first.
        const orderUnlocked = await gated(sessionId, async (tx) => {
          await clearPaymentAttemptMark(tx, stuck.workingOrderId, stuck.attemptAt);
          const [order] = await tx
            .select({ mark: workingOrders.paymentAttemptAt })
            .from(workingOrders)
            .where(eq(workingOrders.id, stuck.workingOrderId));
          return order?.mark === null;
        });
        return c.json({ outcome: "not_charged", orderUnlocked });
      }

      // The payment is captured with no sale, so the pay takes its recovery branch and files it.
      const paid = await payWorkingOrderIntegrated(
        {
          db: deps.db,
          backend: deps.backend,
          clock: deps.clock,
          provider: withoutCollect(provider),
          log,
        },
        { ...deps.cfg, tillId: brandTillId(stuck.tillId) },
        { id: stuck.workingOrderId, lines: [] },
        stuck.personId,
      );
      /* v8 ignore start -- unreachable: every path that returns another outcome goes through
         `collect`, which `withoutCollect` makes throw. */
      if (paid.outcome !== "captured") {
        throw new Error(`a stuck payment's resolve returned ${paid.outcome}`);
      }
      /* v8 ignore stop */
      return c.json({ outcome: "filed", invoiceNumber: paid.ticket.invoiceNumber });
    }),
  );

  /** A bill payment a manager may resolve: pending, and at no reader in this process. */
  const requireStuckBillPayment = async (tx: Transaction, id: string) => {
    const [row] = await tx.select().from(billPayments).where(eq(billPayments.id, id));
    if (row === undefined) throw new AppError("bill.payment_not_found", { paymentId: id });
    if (row.state !== "pending" || billPaymentIsLive(deps.db, id)) {
      throw new AppError("bill.payment_not_stuck", { paymentId: id });
    }
    return row;
  };
  const fiscal = { db: deps.db, backend: deps.backend, clock: deps.clock, cfg: deps.cfg };

  // Card payments towards a bill that nothing is driving any more (bill payments design §5.4).
  app.get("/management-api/payments/bill-payments", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            billPaymentId: billPayments.id,
            workingOrderId: billPayments.workingOrderId,
            orderNumber: workingOrders.orderNumber,
            label: workingOrders.label,
            tillId: billPayments.tillId,
            tillName: tills.name,
            method: billPayments.method,
            applied: billPayments.applied,
            tip: billPayments.tip,
            startedAt: billPayments.createdAt,
            provider: payments.provider,
            providerState: payments.state,
          })
          .from(billPayments)
          .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
          .innerJoin(tills, eq(tills.id, billPayments.tillId))
          .leftJoin(payments, eq(payments.billPaymentId, billPayments.id))
          .where(eq(billPayments.state, "pending"))
          .orderBy(billPayments.createdAt),
      );
      return c.json(
        rows
          .filter((row) => !billPaymentIsLive(deps.db, row.billPaymentId))
          .map((row) => ({
            ...row,
            applied: centsToDecimal(row.applied),
            tip: centsToDecimal(row.tip),
          })),
      );
    }),
  );

  // Settles one from its provider's own record: a Stripe attempt through `resolveAbandonedAttempt`,
  // then the bill's P3 on a capture. Never a whole-order pay, which would invoice the bill from one
  // payment of it.
  app.post("/management-api/payments/bill-payments/:id/resolve", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BillPaymentId");
      const stuck = await gated(sessionId, async (tx, personId) => {
        await requireStuckBillPayment(tx, id);
        const provided = await findPaymentByBillPayment(tx, id);
        if (provided?.state === "attempting") {
          await requireConnected(tx, cardProviderById(deps.providers, provided.provider));
        }
        return { provided, personId };
      });

      const fromRow = async () => {
        const settled = await gated(sessionId, async (tx) => {
          await requireStuckBillPayment(tx, id);
          return settleFromProviderRow(tx, fiscal, id, deps.clock.now().instant);
        });
        switch (settled.settled) {
          case "received":
            return c.json({
              outcome: "received",
              ...(settled.invoice === null ? {} : { invoiceNumber: settled.invoice.invoiceNumber }),
            });
          case "failed":
            return c.json({ outcome: "not_charged" });
          case "mismatched":
            throw new AppError("bill.payment_outcome_unconfirmed", {
              paymentId: id,
              reason: "mismatched",
            });
          case "left":
            throw new AppError("bill.payment_outcome_unconfirmed", {
              paymentId: id,
              reason: "ambiguous",
              providerStatus: settled.providerState,
            });
        }
      };

      if (stuck.provided?.state !== "attempting") return fromRow();

      const { resolved, now } = await resolveAtProvider(
        stuck.provided,
        stuck.personId,
        () => new AppError("bill.payment_not_stuck", { paymentId: id }),
      );
      if (resolved.outcome === "unknown") {
        throw new AppError("bill.payment_outcome_unconfirmed", {
          paymentId: id,
          ...unknownOutcome(resolved),
        });
      }
      if (resolved.outcome === "failed") {
        // The provider's own record says nothing was charged, so the reservation is released.
        await gated(sessionId, async (tx) => {
          await requireStuckBillPayment(tx, id);
          await failBillPayment(tx, id, now);
        });
        return c.json({ outcome: "not_charged" });
      }
      return fromRow();
    }),
  );

  // A manager records the outcome the provider confirmed when the provider cannot be asked: only
  // with a note, and with their own PIN entered again.
  app.post("/management-api/payments/bill-payments/:id/attest", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BillPaymentId");
      const { outcome, note, pin } = parseAttestation(
        await readJsonBody<Record<string, unknown>>(c),
        ["received", "failed"] as const,
      );
      const answer = await gated(sessionId, async (tx, personId) => {
        await verifyManagerPin(tx, personId, pin);
        await requireStuckBillPayment(tx, id);
        // A provider row still `attempting` can yet be charged, so no outcome is recorded over it;
        // one that shows the card charged contradicts a failure.
        const provided = await findPaymentByBillPayment(tx, id);
        if (provided?.state === "attempting") {
          throw new AppError("bill.payment_outcome_unconfirmed", {
            paymentId: id,
            reason: "attempting",
          });
        }
        if (outcome === "failed" && provided !== undefined && CHARGED.has(provided.state)) {
          throw new AppError("bill.attestation_contradicted", { id, evidence: "captured" });
        }
        const attestation = { attestedBy: personId, note };
        const now = deps.clock.now().instant;
        if (outcome === "failed") {
          await failBillPayment(tx, id, now, attestation);
          return { outcome: "not_charged" as const };
        }
        // Dated when the provider settled it, as the work loop does.
        const receivedAt =
          provided === undefined || provided.settledAt === null
            ? now
            : new Date(provided.settledAt);
        const done = await completeBillPayment(tx, fiscal, deps.cfg, id, receivedAt, attestation);
        return {
          outcome: "received" as const,
          ...(done.invoice === null ? {} : { invoiceNumber: done.invoice.invoiceNumber }),
        };
      });
      return c.json(answer);
    }),
  );

  const refundDeps = {
    db: deps.db,
    clock: deps.clock,
    refundProviderFor: refundProvidersOf({ simulator: deps.simulator, pool: deps.pool }),
  };

  // Card refunds of a bill that nothing is driving any more (bill payments design §6b).
  app.get("/management-api/payments/bill-refunds", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            refundId: billPaymentRefunds.id,
            billPaymentId: billPaymentRefunds.billPaymentId,
            workingOrderId: billPayments.workingOrderId,
            orderNumber: workingOrders.orderNumber,
            label: workingOrders.label,
            tillId: billPaymentRefunds.tillId,
            tillName: tills.name,
            appliedAmount: billPaymentRefunds.appliedAmount,
            tipAmount: billPaymentRefunds.tipAmount,
            reason: billPaymentRefunds.reason,
            requestedAt: billPaymentRefunds.createdAt,
            sentAt: billPaymentRefunds.sentAt,
            sendCount: billPaymentRefunds.sendCount,
            provider: payments.provider,
          })
          .from(billPaymentRefunds)
          .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
          .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
          .innerJoin(tills, eq(tills.id, billPaymentRefunds.tillId))
          .leftJoin(payments, eq(payments.billPaymentId, billPayments.id))
          .where(eq(billPaymentRefunds.state, "pending"))
          .orderBy(billPaymentRefunds.createdAt),
      );
      return c.json(
        rows
          .filter((row) => !billRefundIsLive(deps.db, row.refundId))
          .map((row) => ({
            ...row,
            appliedAmount: centsToDecimal(row.appliedAmount),
            tipAmount: centsToDecimal(row.tipAmount),
          })),
      );
    }),
  );

  // Looks the refund up at its provider and records what that settles; for a provider whose key
  // is still kept, a refund it has no record of is sent again under the same key. Never records a
  // failure from an empty lookup.
  app.post("/management-api/payments/bill-refunds/:id/resolve", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BillRefundId");
      await gated(sessionId, () => Promise.resolve());
      const resumed = await resumeCardRefund(refundDeps, id, "manager");
      if (!resumed.claimed) throw new AppError("bill.refund_not_stuck", { refundId: id });
      if (resumed.refund.state !== "pending") return c.json({ outcome: resumed.refund.state });
      const { lookup } = resumed;
      throw new AppError("bill.refund_outcome_unconfirmed", {
        refundId: id,
        reason:
          resumed.resent || lookup === null || lookup.kind === "match"
            ? "pending"
            : lookup.kind === "none"
              ? "not_found"
              : lookup.kind,
      });
    }),
  );

  // A manager records the outcome the provider confirmed (design §6b): only with a note, and with
  // their own PIN entered again.
  app.post("/management-api/payments/bill-refunds/:id/attest", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BillRefundId");
      const { outcome, note, pin } = parseAttestation(
        await readJsonBody<Record<string, unknown>>(c),
        ["completed", "failed"] as const,
      );
      const personId = await gated(sessionId, async (tx, authorizedBy) => {
        await verifyManagerPin(tx, authorizedBy, pin);
        return authorizedBy;
      });
      const refund = await attestCardRefund(refundDeps, id, outcome, {
        attestedBy: personId,
        note,
      });
      return c.json({ outcome: refund.state });
    }),
  );
}
