import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDevice, generatePairingCode } from "./device.js";
import type { DeviceKind } from "./device.js";
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

async function pairingCodeCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from device_pairing_codes where tenant_id = ${cfg.tenantId}`,
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

describe("device pairing-code digest collision (real Postgres)", () => {
  it("maps a colliding-digest mint to device.pairing_code_unavailable, not a raw 23505", async () => {
    // The ~2^-40 digest collision is unreachable by chance, so the `codeSource` seam FORCES it: two mints
    // asked for the SAME code hash to the same code_sha256, and the second trips
    // `device_pairing_codes_lookup_idx` — the UNIQUE index on (tenant_id, code_sha256) that 385b6248
    // added for single-use safety — with 23505. `generatePairingCode` must translate that into the clean,
    // retryable domain code rather than letting the raw driver error reach `run` as an opaque
    // `server.internal` 500. Real Postgres (not PGlite) so the 23505 arrives through the PRODUCTION
    // node-postgres driver shape `isUniqueViolation` walks, beside the DB-level duplicate proof in
    // packages/db devices.rls.test.ts.
    const { cfg, stationId } = await setupStation();
    const forced = "COLLIDE7"; // any canonical Crockford-shaped code; returned by codeSource BOTH times
    const first = await asApp(suite.admin, cfg, (tx) =>
      generatePairingCode(
        tx,
        cfg,
        { kind: "kds_station", stationId, label: "Pantalla" },
        () => forced,
      ),
    );
    expect(first.code).toBe(forced);

    await expect(
      asApp(suite.admin, cfg, (tx) =>
        generatePairingCode(
          tx,
          cfg,
          { kind: "kds_station", stationId, label: "Pantalla" },
          () => forced,
        ),
      ),
    ).rejects.toMatchObject({ code: "device.pairing_code_unavailable" });

    // The collision rolled the second mint's tx back — exactly ONE code row survives for this tenant,
    // and no partial second row landed.
    expect(await pairingCodeCount(cfg)).toBe(1);
  });

  it("rethrows a NON-unique INSERT failure raw, not as device.pairing_code_unavailable", async () => {
    // The false branch of the new catch — the negative control the `isUniqueViolation` siblings each
    // carry (kitchen.ts / tables.ts). An INVALID `device_kind` enum value fails the INSERT with 22P02
    // (invalid enum), NOT the 23505 unique; requireLiveStation passes (the station is valid), so the
    // failure reaches the catch, where `isUniqueViolation` is false and `generatePairingCode` rethrows
    // the raw driver error rather than mistranslating it as `device.pairing_code_unavailable`. (No
    // privilege/concurrency dimension of its own — proven here beside the positive case against the
    // production driver.)
    const { cfg, stationId } = await setupStation();
    const err = await asApp(suite.admin, cfg, (tx) =>
      generatePairingCode(tx, cfg, { kind: "not_a_kind" as DeviceKind, stationId, label: "x" }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error); // rejected (a resolved {code} would fail this)
    expect(err).not.toBeInstanceOf(AppError); // a raw driver error, not a domain translation
  });
});
