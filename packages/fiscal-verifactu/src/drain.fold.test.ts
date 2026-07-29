import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { VerifactuClient } from "@waitron/verifactu";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, type Database } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";

// `drain.tenancy.test.ts`'s own convention: `now` a minute after the fixtures' fixed `2026-07-21
// 00:00Z` due-work timestamp (`seedPendingEnvios`'s own doc comment), so every seeded row here is
// due.
const NOW = new Date("2026-07-21T00:01:00Z");

/**
 * Deliberately unreachable. The gated tenant below has its OWN `envio_flujo` gate 30s in the
 * future and only one due row (`MAX_REGISTROS_POR_ENVIO` is nowhere near reached), so
 * `drainTenant`'s gate check (`drain.ts`) returns before ever calling `resolveClient`'s client —
 * see this file's own test for the full reasoning. A stub that throws if invoked is therefore a
 * stronger fixture than a working fake AEAT client would be: it proves the network is never
 * touched, not merely that the test doesn't happen to read its response.
 */
const unreachableClient: VerifactuClient = {
  submit: () => Promise.reject(new Error("this test's gated tenant must never submit")),
  consultar: () => Promise.reject(new Error("this test's gated tenant must never consult")),
};

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  if (db !== undefined) await db.close();
});

/**
 * `drain.tenancy.test.ts`'s own "THE FOLD" test moved here (see that file's comment on why):
 * proving the fold needs a tenant that is NOT skipped, with a `nextDueAt` earlier than
 * `now + skipRetryMs`, alongside a tenant that is. Rather than wiring a genuinely-successful
 * submission through the fake AEAT (a real network round trip, with its own `TiempoEsperaEnvio`
 * plumbing), this hand-seeds the ONE fact that matters — `envio_flujo.proximo_envio_en`, the row
 * `drainTenant` itself persists after a real submission (`drain.ts`'s own `upsertFlujo`) — 30
 * seconds out, then relies on the SAME gate check a real successful tenant would have hit on a
 * LATER pass (`drainTenant`'s "gate not open, fewer than a full envío due" branch) to fold it into
 * `result.nextDueAt` via `bumpNextDue`, with no submission required at all.
 */
describe("drain — folds the skip-retry interval as a minimum against a healthy tenant's own gate", () => {
  it("prefers a successful tenant's earlier gate over the skip-retry interval", async () => {
    // The skipping tenant: due work, but its resolver rejects — contributes nothing of its own to
    // `nextDueAt`, only the skip-retry interval below.
    const failingSeed = await seedPendingEnvios(db, { count: 1 });
    const failing = failingSeed.tenantId;

    // The gate-deferred tenant: due work too, but its OWN gate is already 30s out — inside the
    // 5-minute skip-retry interval. `envios_tenants_with_work` (0004's migration) matches it on
    // its `pendiente` row alone; `envio_flujo` plays no part in enumeration, only in what
    // `drainTenant` does once it gets there.
    const gatedSeed = await seedPendingEnvios(db, { count: 1 });
    const gated = gatedSeed.tenantId;
    const gateAt = new Date(NOW.getTime() + 30_000);
    await db.execute(sql`
      insert into envio_flujo (tenant_id, proximo_envio_en, tiempo_espera_seg)
      values (${gated}, ${gateAt.toISOString()}, 30)
    `);

    const result = await drain(
      {
        db,
        resolveClient: (tenantId) =>
          tenantId === failing
            ? Promise.reject(
                new AppError("sif.not_registered", { tenantId, tillId: failingSeed.tillId }),
              )
            : Promise.resolve(unreachableClient),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.skipped.some((s) => s.tenantId === failing)).toBe(true);
    // The load-bearing assertion. The gated tenant's own gate (30s out) must win over the
    // skip-retry interval (5 minutes out) — this IS the fold. A plain assignment of
    // `now + skipRetryMs` on any skip (the pre-fix behaviour, with `skipRetryMs` substituted for
    // the old bare `now`) would instead report `NOW + 5 minutes` here, discarding the gated
    // tenant's genuinely earlier answer — so this assertion fails against that implementation.
    expect(result.nextDueAt).toEqual(gateAt);
  });

  it("prefers the skip-retry interval over a successful tenant's later gate", async () => {
    // A DEDICATED, single-tenant PGlite instance, not this file's shared `db` — mirroring
    // `drain.tenancy.test.ts`'s own last test. The assertion below is exact (`toEqual`, not
    // `.some(...)`), so a due-but-not-yet-submitted tenant left behind by the test above — its gate
    // 30s out, genuinely earlier than everything this test seeds — would otherwise still be
    // enumerated by `tenantsWithWork` here (it shares the same fixed `NOW`) and silently win the
    // fold, passing for the wrong reason.
    const soloDb = await createPgliteDb();
    await runMigrations(soloDb, CORE_MIGRATIONS);
    await runMigrations(soloDb, FISCAL_MIGRATIONS);
    try {
      // The skipping tenant: due work, but its resolver rejects — contributes only the skip-retry
      // interval below, exactly as in the "earlier gate" test above.
      const failingSeed = await seedPendingEnvios(soloDb, { count: 1 });
      const failing = failingSeed.tenantId;

      // The gate-deferred tenant: due work too, but its OWN gate is now LATER than the skip-retry
      // interval (5 minutes) rather than earlier — 10 minutes out. The interval must win here: a
      // successful tenant's genuinely FURTHER-away gate must not push a skipped tenant's own retry
      // out past it — the mirror of the "earlier gate" test above, which cannot distinguish the
      // correct `Math.min` fold from a mutant that simply prefers whichever answer is already set.
      const gatedSeed = await seedPendingEnvios(soloDb, { count: 1 });
      const gated = gatedSeed.tenantId;
      const gateAt = new Date(NOW.getTime() + 10 * 60_000);
      await soloDb.execute(sql`
        insert into envio_flujo (tenant_id, proximo_envio_en, tiempo_espera_seg)
        values (${gated}, ${gateAt.toISOString()}, 30)
      `);

      const result = await drain(
        {
          db: soloDb,
          resolveClient: (tenantId) =>
            tenantId === failing
              ? Promise.reject(
                  new AppError("sif.not_registered", { tenantId, tillId: failingSeed.tillId }),
                )
              : Promise.resolve(unreachableClient),
          skipRetryMs: DEFAULT_SKIP_RETRY_MS,
          environment: "production",
        },
        NOW,
      );

      expect(result.skipped).toEqual([{ tenantId: failing, errorCode: "sif.not_registered" }]);
      // The load-bearing assertion. The skip-retry interval (5 minutes out) must win over the gated
      // tenant's own, LATER gate (10 minutes out) — `Math.min` picks the interval. A fold that
      // instead "prefers any existing answer" (`result.nextDueAt ?? retryAt` — keeping whatever
      // `bumpNextDue` already set once it is non-null, rather than taking the minimum against
      // `retryAt`) would report the gated tenant's 10-minute gate here instead, discarding the
      // skipped tenant's genuinely nearer retry — a mutant the "earlier gate" test above cannot
      // catch, because there `result.nextDueAt` is already the right answer either way.
      expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + DEFAULT_SKIP_RETRY_MS));
    } finally {
      await soloDb.close();
    }
  });
});
