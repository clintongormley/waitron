// Side-effect only: loads this host's errors.ts augmentation for the codes THESE routes throw
// directly — `payment.provider_in_use`, `reader.not_found`, `reader.provider_disconnected`, plus the
// shared management-gate codes (`management.request_invalid`, `shared.invalid_id`) and `device.not_found`.
// The seat codes this surface relays — `payment.provider_credential_rejected` /
// `payment.provider_merchant_ambiguous` (@waitron/payments and its adapter packages) and
// `payment.credential_environment_mismatch` (@waitron/payments-stripe) — reach the type registry
// through the VALUE imports of `cardProviderById` and the provider seats in `CARD_PROVIDERS`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  asAppUser,
  devices,
  nowIso,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  cardProviderById,
  cardReaders,
  deviceCardReaders,
  type CardProviderContribution,
  type CardProviderRuntimeDeps,
} from "@waitron/payments";
import {
  deleteCredential,
  putCredential,
  tenantCredentials,
  validatePayload,
  type KeyRing,
} from "@waitron/credentials";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { requireBodyUuid, requireString, requireUuidParam } from "@waitron/server-kit";
import type { DeploymentEnvironment } from "./config.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/**
 * Everything `mountPaymentsApi` needs. One taxpayer per database, so a by-id read needs only the
 * id. `ring` is
 * the vault key ring the host opened once at boot: this is the FIRST dashboard write to the credential
 * vault. `pool` is the lazy card-provider pool — these routes only `evict` it so a credential change
 * takes effect without a restart; the pay path (Task 12) is what `get`s from it. `providers` is the
 * composition list (`CARD_PROVIDERS`); the routes reach a seat only through `cardProviderById`, never by
 * importing a provider package. `fetch` is injected only by tests whose seat needs it (SumUp); the live
 * host omits it and the seats fall back to the global.
 */
export interface PaymentsApiDeps {
  db: Database;
  cfg: TillConfig;
  ring: KeyRing;
  environment: DeploymentEnvironment;
  pool: CardProviderPool;
  providers: readonly CardProviderContribution[];
  fetch?: typeof fetch;
}

/** The ONE permission every payments-management route is gated on — a manager/admin act, never a till
 * operator's (permissions.ts maps `payments.manage` to manager + admin). One named constant referenced
 * at the gate, the `print-api.ts` seam. */
const PAYMENTS_MANAGE: Permission = "payments.manage";

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to. CLIENT faults only: a
 * genuine SERVER fault reaches `run` as a non-AppError and becomes an opaque `server.internal` 500. A
 * registered code absent here defaults to 400 via `run`. Each surface owns its own STATUS map.
 *
 *  - The management gate (mirroring `print-api.ts`): `management_session.*` (401),
 *    `person.suspended`/`authorization.not_permitted` (403), `management.request_invalid` (400) from
 *    the body screens, and `shared.invalid_id` (400) from the path-id screen.
 *  - Provider selection: `payment.provider_unknown` (an id naming no seat, 404).
 *  - Connect: `payment.provider_credential_rejected` and `payment.credential_environment_mismatch`
 *    (422 Unprocessable — the credential is well-formed but does not verify / is the wrong
 *    environment) and `payment.provider_merchant_ambiguous` (409 — the key spans several merchants and
 *    the form must pick one, relayed with its `{ merchants }` list).
 *  - Disconnect: `payment.provider_in_use` (409 — an active reader still uses the provider).
 *  - Readers / device default: `reader.provider_disconnected` (409 — a reader op on a provider with no
 *    sealed credential), `payment.pairing_refused` (422 — SumUp refused the pairing code: bad, expired
 *    or already used), `reader.not_found` (404 — a reader id that is not this tenant's), and
 *    `device.not_found` (404 — a device id that is not this tenant's).
 */
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
};

// The one error boundary every payments route wraps its handler in.
const run = createErrorBoundary(STATUS, "payments.failed");

/** Screen the connect form body into a `Record<string,string>` the seat's `connect` accepts: every
 * value must be a string (a provider form has only text/password inputs), else
 * `management.request_invalid` naming the field. `merchantCode` (SumUp's picker re-submit) passes
 * through like any other field. */
function screenStringMap(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(body)) {
    if (typeof value !== "string") throw new AppError("management.request_invalid", { field });
    out[field] = value;
  }
  return out;
}

/**
 * Mounts the payments-management routes on an existing Hono app — the `mountPrintApi` convention.
 * Every route is `requireManagementSession`-gated then funnels its DB work through the local `gated`
 * helper, which opens an app-role transaction and `authorizeManager`s `payments.manage`
 * before the op runs, in exactly one place. Provider `connect`/reader calls reach the network, so they
 * run OUTSIDE any transaction (a `withTransaction` is never held across a provider round-trip); the gate
 * runs first, in its own `gated` call, so an unauthorised caller never reaches the provider.
 */
export function mountPaymentsApi(app: Hono, deps: PaymentsApiDeps, log: Logger): void {
  // Open a transaction as the app role, confirm the caller's management session carries
  // `payments.manage`, then run `fn`. Every route funnels its DB work through here so the gate is
  // applied identically and in exactly one place (print-api.ts's seam). Proven by deletion: removing
  // the `authorizeManager(...)` call makes a staff session succeed on every gated route.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: PAYMENTS_MANAGE,
      });
      return fn(tx);
    });

  // The runtime context every provider seat call takes — the db handle, the vault key ring, and the
  // test-injected fetch when present. Built identically at each reader call
  // (add / status / remove), so it lives in one place.
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
    // Local mutations decide from this row, so Enable cannot race a committed unpair. On PostgreSQL
    // the read took `for update`, which kept the row still between the read and the caller's own
    // UPDATE in the same transaction. One write transaction runs on the venue file at a time
    // (`packages/store/src/write-queue.ts`, reached through `withTransaction` in
    // `packages/db/src/tenancy.ts`, which is what `gated` above opens), so no OTHER write transaction
    // can run in that gap — and there is no lock to take: SQLite has none, and drizzle's SQLite query
    // builder has no `.for()`. Stated once for the whole tree, with its measurement and its control, on
    // `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
    //
    // The unpair route is the one caller this never covered and still does not: it reads here in one
    // `gated` transaction, calls the provider, then writes in a THIRD. The lock was released at the
    // first commit, before the network call — so that route's decision was always taken on a row it
    // no longer held.
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
              // The clock is read in JavaScript and bound: `now()` is a PostgreSQL function this
              // engine does not have. `nowIso` because `disabled_at` is a `tsString` column, the
              // spelling `packages/payments/src/store.ts` stamps every other column here with.
              disabledAt: action === "enable" ? null : nowIso(),
            })
            .where(readerWhere(id));
        });
        return c.body(null, 204);
      }),
    );
  }

  // ── List every provider and whether it is connected (payments.manage) ────────────────────────────
  app.get("/management-api/payments/providers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // "Connected" = a sealed credential exists for the seat's purpose. Read the purposes the database
      // holds (metadata only — no ciphertext, no decrypt, never a secret).
      const rows = await gated(sessionId, (tx) =>
        tx.select({ purpose: tenantCredentials.purpose }).from(tenantCredentials),
      );
      const connected = new Set(rows.map((r) => r.purpose));
      // `merchantName` is deliberately omitted here: it is not stored (only returned at connect time),
      // and recovering it would need decrypting the credential and calling the provider. The field is
      // optional on the contract; the connect response is where the dashboard learns it. The
      // "simulator" state is Task 12's till-boot concern, not computed here.
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

  // ── Connect a provider: verify the typed credential, seal it, evict the pool (payments.manage) ────
  app.post("/management-api/payments/providers/:id/connect", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const payload = screenStringMap(body);
      // Authorise BEFORE the provider round-trip so an unauthorised caller never reaches the network.
      await gated(sessionId, async () => {});
      const seat = cardProviderById(deps.providers, id); // payment.provider_unknown on a bad id
      // The seat verifies the credential and returns the merchant name to confirm PLUS the complete
      // payload to seal. `environment` MUST be passed or the Stripe prefix/env guard silently no-ops
      // (it refuses a wrong-environment key only when it knows the host's env).
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

  // ── Disconnect a provider (payments.manage) ──────────────────────────────────────────────────────
  app.post("/management-api/payments/providers/:id/disconnect", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      await gated(sessionId, async (tx) => {
        const seat = cardProviderById(deps.providers, id); // payment.provider_unknown on a bad id
        // Refuse while any ACTIVE reader still uses this provider — the operator disables those first.
        // `activeReaders` is a COUNT (never a reader id or a secret).
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

  // ── List this tenant's card readers (payments.manage) ────────────────────────────────────────────
  app.get("/management-api/payments/readers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Active AND disabled: `active` on each row lets the dashboard show a disabled reader (historical
      // payments still resolve its name). `deviceCount` comes from a SEPARATE aggregate
      // rather than a correlated subquery over the `.from()` base — a `sql` scalar correlated to the
      // base table binds to the subquery's table and returns a wrong answer (CLAUDE.md §3, #152).
      // `canEnable` is derived from `unpairedAt` HERE rather than asked of the engine as
      // `unpaired_at is null`: a `sql` predicate is an expression, not a declared column, so no read
      // mapping reaches it and this engine answers 0/1 — which this route then put on the wire,
      // where `apps/dashboard/src/api/client.ts` declares a boolean.
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

  // ── Add a card reader (payments.manage) ──────────────────────────────────────────────────────────
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
      // Relay to the seat (pairs SumUp / verifies Stripe) OUTSIDE any transaction — a provider
      // round-trip. The seat reads the sealed credential itself.
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
        // The provider was disconnected mid-add. Best-effort unpair the vendor reader we just paired
        // so it is not stranded; a remove failure is swallowed (the row was never inserted, and the
        // operator's next action is to reconnect and add again).
        await seat.readers.remove(runtimeDeps(), result.providerRef).catch(() => {});
        throw new AppError("reader.provider_disconnected", { providerId });
      }
      return c.json({ id: inserted.id, status: result.status }, 201);
    }),
  );

  // ── A reader's live status (payments.manage) ─────────────────────────────────────────────────────
  app.get("/management-api/payments/readers/:id/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const readerId = requireUuidParam(c.req.param("id"), "CardReaderId");
      // Load the reader BY ID — an unknown reader id is `reader.not_found`, never readable.
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
      // One clock reading for both stamps, so the unpair lands as one moment — which is what
      // PostgreSQL's `now()`, being transaction-start time, gave the two calls for free.
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

  // ── Read a device's default reader (payments.manage) ─────────────────────────────────────────────
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

  // ── Set or clear a device's default reader (payments.manage) ─────────────────────────────────────
  app.put("/management-api/payments/devices/:id/reader", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const deviceId = requireUuidParam(c.req.param("id"), "DeviceId");
      const body = await readJsonBody<{ readerId?: unknown }>(c);
      // REQUIRED field, either a reader uuid (set) or explicit null (clear). Absent → request_invalid.
      if (!("readerId" in body)) {
        throw new AppError("management.request_invalid", { field: "readerId" });
      }
      const readerId = body.readerId === null ? null : requireBodyUuid(body.readerId, "readerId");
      await gated(sessionId, async (tx) => {
        // The device must exist (by id) — an unknown device id is `device.not_found`, which also keeps
        // the device foreign key from refusing with an opaque 500.
        const [device] = await tx
          .select({ id: devices.id })
          .from(devices)
          .where(eq(devices.id, deviceId));
        if (device === undefined) throw new AppError("device.not_found", { deviceId });
        if (readerId === null) {
          // Clear the default = delete the row (idempotent; a device with none just has no default).
          await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
          return;
        }
        // A named reader must exist AND be active — an unknown or disabled reader is `reader.not_found`,
        // never assignable (keeps the reader FK from a 500).
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
}
