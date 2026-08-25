import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDevice, generatePairingCode } from "./device.js";
import "./errors.js";

// Real Postgres, not PGlite — MANDATORY for THIS suite (CLAUDE.md §4). The single-use guarantee is a
// CONCURRENCY property: two devices racing to redeem ONE pairing code must yield exactly one enrolment,
// enforced by the locking `DELETE … RETURNING` that row-locks the code (the consumeChallenge shape,
// packages/identity passkey.ts). PGlite serialises every query onto ONE backend, so the two redeems can
// never truly overlap there and the race is a FALSE pass, not a weak one. Each racer below opens its own
// backend via `suite.pg.connect()` (distinct `pg_backend_pid()`, asserted), and the shared-container
// globalSetup throws rather than skips when Docker is absent, so a vanished suite fails loudly.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });

interface SeededStation {
  cfg: TillConfig;
  stationId: string;
}

/** A fresh tenant + venue + one station, seeded on the superuser admin connection (RLS bypassed for
 * setup) with the station created through the app role. Each test gets its OWN tenant so device counts
 * are order-independent across the shared clone (CLAUDE.md §4). */
async function setupStation(): Promise<SeededStation> {
  const admin = suite.admin;
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(admin, tenantId, brandLocationId(locationId));
  const cfg: TillConfig = {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const st = await asApp(admin, cfg, (tx) =>
    createStation(tx, cfg, { name: "Cocina", isDefault: true }),
  );
  return { cfg, stationId: st.id };
}

function asApp<T>(db: Database, cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

async function deviceCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from devices where tenant_id = ${cfg.tenantId}`,
  );
  return rows[0]!.n;
}

describe("device enrolment single-use race (real Postgres)", () => {
  it("two concurrent enrolments of ONE code create exactly one device; the loser is device.pairing_invalid", async () => {
    const { cfg, stationId } = await setupStation();
    const { code } = await asApp(suite.admin, cfg, (tx) =>
      generatePairingCode(tx, cfg, { kind: "kds_station", stationId, label: "Pantalla" }),
    );

    // TWO distinct backends racing to redeem ONE code. Load-bearing: distinct backend PROCESSES — on
    // PGlite these collapse onto one and the race never happens (a false pass).
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]!.pid;
        }),
      );
      expect(new Set(pids).size).toBe(2);

      // Both race past the locking DELETE … RETURNING. One row-locks the code, deletes it and enrols;
      // the other blocks, then — once the winner commits — matches zero rows and throws pairing_invalid.
      const results = await Promise.allSettled([
        asApp(connA, cfg, (tx) => enrolDevice(tx, cfg, { code })),
        asApp(connB, cfg, (tx) => enrolDevice(tx, cfg, { code })),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1); // exactly one enrolment succeeded
      expect(rejected).toHaveLength(1); // the loser was rejected
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "device.pairing_invalid",
      });
      // The database agrees: exactly ONE device row for this tenant — the loser filed nothing.
      expect(await deviceCount(cfg)).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});
