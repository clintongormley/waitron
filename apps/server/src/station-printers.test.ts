import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { createPrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import {
  attachPrinterToStation,
  detachPrinterFromStation,
  listStationPrinters,
} from "./station-printers.js";
import "./errors.js";

// PGlite, not real Postgres: these are CONFIG verbs — a live-check SELECT plus an INSERT/DELETE with no
// privilege or concurrency dimension. The `printer.manage` gate lives on the ROUTE (Task 5), the
// composite PK and both tenant-consistent FKs are proven against real Postgres in packages/db's
// station-printers.test.ts (Task 1), and `app_user`'s grant is pinned by the privilege matrix in
// packages/fiscal-verifactu. PGlite serialises every query onto
// one backend, so it would be a FALSE PASS for a concurrency test — but there is no concurrency here,
// so it is the correct lighter target (CLAUDE.md §4), the same choice kitchen.test.ts / outbox.test.ts
// make for their config/outbox verbs.
const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

/** Seed a tenant + location + till + node and return the till's config. `createStation` takes a
 *  `TillConfig`; the station→printer verbs take the narrower `PrintConfig` (its tenant + location),
 *  derived by {@link printCfg}. Mirrors kitchen.test.ts's `setupVenue`. */
async function setupVenue(): Promise<TillConfig> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  return {
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
}

/** The station→printer verbs' scope — the tenant + location the till carries. */
function printCfg(cfg: TillConfig): PrintConfig {
  return { tenantId: cfg.tenantId, locationId: cfg.locationId };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Create a station via the real KDS-1 verb (kitchen.ts). */
function station(cfg: TillConfig, name: string): Promise<string> {
  return asApp(cfg, (tx) => createStation(tx, cfg, { name })).then((r) => r.id);
}

/** Create a printer via the real printing verb (printers.ts). `cloud_poll` needs only a `poll_id`
 *  (no agent to seed) — the minimal live printer for a mapping test. */
function printer(cfg: TillConfig, name: string): Promise<string> {
  return asApp(cfg, (tx) =>
    createPrinter(tx, printCfg(cfg), { name, transport: "cloud_poll", pollId: `poll-${name}` }),
  ).then((r) => r.id);
}

describe("station→printer mapping verbs", () => {
  it("attaches a mapping, lists it, and is idempotent on a repeat attach", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Cocina");
    const p1 = await printer(cfg, "Kitchen");

    await asApp(cfg, (tx) =>
      attachPrinterToStation(tx, printCfg(cfg), { stationId: s1, printerId: p1 }),
    );
    expect(await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)))).toEqual([
      { stationId: s1, printerId: p1 },
    ]);

    // Re-attaching the SAME pair is a silent no-op (ON CONFLICT DO NOTHING), not a duplicate row nor a
    // throw — the idempotency the config UI relies on.
    await asApp(cfg, (tx) =>
      attachPrinterToStation(tx, printCfg(cfg), { stationId: s1, printerId: p1 }),
    );
    expect(await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)))).toEqual([
      { stationId: s1, printerId: p1 },
    ]);
  });

  it("detaches a mapping and is idempotent on a repeat detach (pure delete, no live-check)", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Cocina");
    const p1 = await printer(cfg, "Kitchen");
    await asApp(cfg, (tx) =>
      attachPrinterToStation(tx, printCfg(cfg), { stationId: s1, printerId: p1 }),
    );

    await asApp(cfg, (tx) =>
      detachPrinterFromStation(tx, printCfg(cfg), { stationId: s1, printerId: p1 }),
    );
    expect(await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)))).toEqual([]);

    // Detaching a mapping that is no longer there is a no-op, never an error.
    await asApp(cfg, (tx) =>
      detachPrinterFromStation(tx, printCfg(cfg), { stationId: s1, printerId: p1 }),
    );
    expect(await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)))).toEqual([]);
  });

  it("rejects an attach to a station that is not live (station.not_found)", async () => {
    const cfg = await setupVenue();
    const p1 = await printer(cfg, "Kitchen");
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) =>
        attachPrinterToStation(tx, printCfg(cfg), { stationId: missing, printerId: p1 }),
      ),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: missing } });
  });

  it("rejects an attach to a printer that is not live (printer.not_found)", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Cocina");
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) =>
        attachPrinterToStation(tx, printCfg(cfg), { stationId: s1, printerId: missing }),
      ),
    ).rejects.toMatchObject({ code: "printer.not_found", params: { id: missing } });
  });

  it("filters the listing by stationId and by printerId", async () => {
    const cfg = await setupVenue();
    const s1 = await station(cfg, "Cocina");
    const s2 = await station(cfg, "Plancha");
    const p1 = await printer(cfg, "Kitchen");
    const p2 = await printer(cfg, "Pass");
    // A group printer (p1) on both stations; a station-local printer (p2) on s1 only.
    for (const [stationId, printerId] of [
      [s1, p1],
      [s1, p2],
      [s2, p1],
    ] as const) {
      await asApp(cfg, (tx) => attachPrinterToStation(tx, printCfg(cfg), { stationId, printerId }));
    }

    // No filter → every mapping in the tenant.
    const all = await asApp(cfg, (tx) => listStationPrinters(tx, printCfg(cfg)));
    expect(all).toHaveLength(3);
    expect(all).toContainEqual({ stationId: s1, printerId: p1 });
    expect(all).toContainEqual({ stationId: s1, printerId: p2 });
    expect(all).toContainEqual({ stationId: s2, printerId: p1 });

    // Filter by station → only that station's printers.
    const byStation = await asApp(cfg, (tx) =>
      listStationPrinters(tx, printCfg(cfg), { stationId: s1 }),
    );
    expect(byStation).toHaveLength(2);
    expect(byStation).toContainEqual({ stationId: s1, printerId: p1 });
    expect(byStation).toContainEqual({ stationId: s1, printerId: p2 });

    // Filter by printer → only the stations that printer serves (the group-printer read).
    const byPrinter = await asApp(cfg, (tx) =>
      listStationPrinters(tx, printCfg(cfg), { printerId: p1 }),
    );
    expect(byPrinter).toHaveLength(2);
    expect(byPrinter).toContainEqual({ stationId: s1, printerId: p1 });
    expect(byPrinter).toContainEqual({ stationId: s2, printerId: p1 });
  });
});
