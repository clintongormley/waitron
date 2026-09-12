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
import { asAppUser, devices, withTenant, type Database, type Transaction } from "@waitron/db";
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
 * Everything `mountPaymentsApi` needs. One tenant per database (`cfg.tenantId` scopes every query and
 * every by-id read — one-tenant-per-db is NOT the query's isolation boundary, CLAUDE.md §3). `ring` is
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
 * helper, which opens a tenant-scoped app-role transaction and `authorizeManager`s `payments.manage`
 * before the op runs, in exactly one place. Provider `connect`/reader calls reach the network, so they
 * run OUTSIDE any transaction (a `withTenant` is never held across a provider round-trip); the gate
 * runs first, in its own `gated` call, so an unauthorised caller never reaches the provider.
 */
export function mountPaymentsApi(app: Hono, deps: PaymentsApiDeps, log: Logger): void {
  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // `payments.manage`, then run `fn`. Every route funnels its DB work through here so the gate is
  // applied identically and in exactly one place (print-api.ts's seam). Proven by deletion: removing
  // the `authorizeManager(...)` call makes a staff session succeed on every gated route.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: PAYMENTS_MANAGE,
      });
      return fn(tx);
    });

  // The runtime context every provider seat call takes — this tenant's db handle, the vault key ring,
  // the tenant id, and the test-injected fetch when present. Built identically at each reader call
  // (add / status / remove), so it lives in one place.
  const runtimeDeps = (): CardProviderRuntimeDeps => ({
    db: deps.db,
    ring: deps.ring,
    tenantId: deps.cfg.tenantId,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });

  // ── List every provider and whether it is connected (payments.manage) ────────────────────────────
  app.get("/management-api/payments/providers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // "Connected" = a sealed credential exists for the seat's purpose. Read the purposes THIS tenant
      // holds (metadata only — no ciphertext, no decrypt, never a secret), scoped by the explicit
      // `tenant_id` predicate (CLAUDE.md §3, one-tenant-per-db is not the query boundary).
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({ purpose: tenantCredentials.purpose })
          .from(tenantCredentials)
          .where(eq(tenantCredentials.tenantId, deps.cfg.tenantId)),
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
      // payload to seal. `environment` AND `tenantId` MUST both be passed or the Stripe prefix/env
      // guard silently no-ops (it refuses a wrong-environment key only when it knows the host's env).
      const { merchantName, sealedPayload } = await seat.connect(
        {
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          environment: deps.environment,
          tenantId: deps.cfg.tenantId,
        },
        payload,
      );
      await gated(sessionId, async (tx) => {
        // Validate the seat-assembled payload against the purpose's declared fields before sealing, so
        // a provider that returns a wrong-shaped payload fails loudly rather than sealing junk.
        validatePayload(seat.credentialPurpose, sealedPayload);
        await putCredential(tx, deps.ring, {
          tenantId: deps.cfg.tenantId,
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
        // Refuse while any ACTIVE reader still uses this provider — the operator retires those first.
        // `activeReaders` is a COUNT (never a reader id or a secret), scoped to the tenant.
        const active = await tx
          .select({ id: cardReaders.id })
          .from(cardReaders)
          .where(
            and(
              eq(cardReaders.tenantId, deps.cfg.tenantId),
              eq(cardReaders.provider, id),
              eq(cardReaders.active, true),
            ),
          );
        if (active.length > 0) {
          throw new AppError("payment.provider_in_use", { activeReaders: active.length });
        }
        await deleteCredential(tx, {
          tenantId: deps.cfg.tenantId,
          purpose: seat.credentialPurpose,
        });
      });
      deps.pool.evict(id);
      return c.body(null, 204);
    }),
  );

  // ── List this tenant's card readers (payments.manage) ────────────────────────────────────────────
  app.get("/management-api/payments/readers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Active AND retired: `active` on each row lets the dashboard show a retired reader (historical
      // payments still resolve its name). `deviceCount` comes from a SEPARATE tenant-scoped aggregate
      // rather than a correlated subquery over the `.from()` base — a `sql` scalar correlated to the
      // base table binds to the subquery's table and returns a wrong answer (CLAUDE.md §3, #152).
      const { readers, counts } = await gated(sessionId, async (tx) => ({
        readers: await tx
          .select({
            id: cardReaders.id,
            provider: cardReaders.provider,
            name: cardReaders.name,
            active: cardReaders.active,
          })
          .from(cardReaders)
          .where(eq(cardReaders.tenantId, deps.cfg.tenantId))
          .orderBy(cardReaders.name),
        counts: await tx
          .select({
            readerId: deviceCardReaders.readerId,
            n: sql<number>`count(*)::int`,
          })
          .from(deviceCardReaders)
          .where(eq(deviceCardReaders.tenantId, deps.cfg.tenantId))
          .groupBy(deviceCardReaders.readerId),
      }));
      const countByReader = new Map(counts.map((r) => [r.readerId, r.n]));
      return c.json(readers.map((r) => ({ ...r, deviceCount: countByReader.get(r.id) ?? 0 })));
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
          .where(
            and(
              eq(tenantCredentials.tenantId, deps.cfg.tenantId),
              eq(tenantCredentials.purpose, seat.credentialPurpose),
            ),
          );
        if (cred === undefined) throw new AppError("reader.provider_disconnected", { providerId });
      });
      // Relay to the seat (pairs SumUp / verifies Stripe) OUTSIDE any transaction — a provider
      // round-trip. The seat reads the sealed credential itself.
      const result = await seat.readers.add(
        runtimeDeps(),
        {
          name,
          ...(code !== undefined ? { code } : {}),
          ...(reference !== undefined ? { reference } : {}),
        },
      );
      // A disconnect can commit between the pre-check above and this insert (the provider round-trip
      // holds no transaction), leaving the just-paired reader's provider with NO sealed credential.
      // Re-check the credential is STILL present in the same transaction as the insert and refuse if
      // it is gone, so we never insert an ACTIVE reader whose provider is disconnected. A residual
      // sub-millisecond window between this re-check and the commit is accepted; the common case (a
      // disconnect that has already committed) is closed.
      const inserted = await gated(sessionId, async (tx) => {
        const [cred] = await tx
          .select({ purpose: tenantCredentials.purpose })
          .from(tenantCredentials)
          .where(
            and(
              eq(tenantCredentials.tenantId, deps.cfg.tenantId),
              eq(tenantCredentials.purpose, seat.credentialPurpose),
            ),
          );
        if (cred === undefined) return undefined;
        const [row] = await tx
          .insert(cardReaders)
          .values({
            tenantId: deps.cfg.tenantId,
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
        await seat.readers
          .remove(
            runtimeDeps(),
            result.providerRef,
          )
          .catch(() => {});
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
      // Load the reader BY ID with an explicit `tenant_id` predicate — a by-id read still scopes to the
      // tenant (CLAUDE.md §3); another tenant's reader id is `reader.not_found`, never readable.
      const reader = await gated(sessionId, async (tx) => {
        const [row] = await tx
          .select({ provider: cardReaders.provider, providerRef: cardReaders.providerRef })
          .from(cardReaders)
          .where(and(eq(cardReaders.tenantId, deps.cfg.tenantId), eq(cardReaders.id, readerId)));
        if (row === undefined) throw new AppError("reader.not_found", { id: readerId });
        return row;
      });
      const seat = cardProviderById(deps.providers, reader.provider);
      const status = await seat.readers.status(
        runtimeDeps(),
        reader.providerRef,
      );
      return c.json(status);
    }),
  );

  // ── Retire a reader (payments.manage) ────────────────────────────────────────────────────────────
  app.post("/management-api/payments/readers/:id/retire", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const readerId = requireUuidParam(c.req.param("id"), "CardReaderId");
      // Load the reader BY ID, tenant-scoped but WITHOUT requiring `active` — a retry after a failed
      // vendor unpair must still find the (already-retired) row and re-attempt the provider call.
      // Another tenant's reader id is `reader.not_found` (by-id isolation, CLAUDE.md §3).
      const reader = await gated(sessionId, async (tx) => {
        const [row] = await tx
          .select({ provider: cardReaders.provider, providerRef: cardReaders.providerRef })
          .from(cardReaders)
          .where(and(eq(cardReaders.tenantId, deps.cfg.tenantId), eq(cardReaders.id, readerId)));
        if (row === undefined) throw new AppError("reader.not_found", { id: readerId });
        return row;
      });
      // Tell the provider to forget the reader (SumUp deletes it; Stripe is a no-op) — a round-trip,
      // so it runs outside any transaction. Do it BEFORE flipping the row so a vendor failure leaves
      // the reader still active and the whole retire retryable; a retry re-runs the vendor call.
      const seat = cardProviderById(deps.providers, reader.provider);
      await seat.readers.remove(
        runtimeDeps(),
        reader.providerRef,
      );
      // Only once the vendor has forgotten it do we retire the row = UPDATE `active=false,
      // retired_at=now()` (the row is KEPT so historical payments still resolve its name; `app_user`
      // holds no DELETE on `card_readers`). Idempotent: a retry after the vendor already succeeded
      // simply re-sets the same values.
      await gated(sessionId, (tx) =>
        tx
          .update(cardReaders)
          .set({ active: false, retiredAt: sql`now()` })
          .where(and(eq(cardReaders.tenantId, deps.cfg.tenantId), eq(cardReaders.id, readerId))),
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
          .where(
            and(
              eq(deviceCardReaders.tenantId, deps.cfg.tenantId),
              eq(deviceCardReaders.deviceId, deviceId),
            ),
          ),
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
        // The device must be THIS tenant's (by-id, tenant-scoped) — an unknown/foreign device id is
        // `device.not_found`, which also keeps the composite device FK from 23503-ing an opaque 500.
        const [device] = await tx
          .select({ id: devices.id })
          .from(devices)
          .where(and(eq(devices.tenantId, deps.cfg.tenantId), eq(devices.id, deviceId)));
        if (device === undefined) throw new AppError("device.not_found", { deviceId });
        if (readerId === null) {
          // Clear the default = delete the row (idempotent; a device with none just has no default).
          await tx
            .delete(deviceCardReaders)
            .where(
              and(
                eq(deviceCardReaders.tenantId, deps.cfg.tenantId),
                eq(deviceCardReaders.deviceId, deviceId),
              ),
            );
          return;
        }
        // A named reader must be THIS tenant's AND active — a foreign or retired reader is
        // `reader.not_found`, never assignable (CLAUDE.md §3; keeps the composite reader FK from a 500).
        const [reader] = await tx
          .select({ id: cardReaders.id })
          .from(cardReaders)
          .where(
            and(
              eq(cardReaders.tenantId, deps.cfg.tenantId),
              eq(cardReaders.id, readerId),
              eq(cardReaders.active, true),
            ),
          );
        if (reader === undefined) throw new AppError("reader.not_found", { id: readerId });
        await tx
          .insert(deviceCardReaders)
          .values({ tenantId: deps.cfg.tenantId, deviceId, readerId })
          .onConflictDoUpdate({
            target: [deviceCardReaders.tenantId, deviceCardReaders.deviceId],
            set: { readerId },
          });
      });
      return c.body(null, 204);
    }),
  );
}
