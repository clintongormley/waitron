import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { locationId as brandLocationId } from "@waitron/shared";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  seedFiredLine,
  seedFiredOrder,
  seedKitchenStation,
  seedNodeAndSeries,
  seedOpenOrder,
  seedVenue,
} from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeOverdueOrders } from "./overdue-orders.js";
import type { OverdueOrder, OverdueOrdersInput } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
let stationId: string;

beforeEach(async () => {
  venue = await seedVenue(suite.db);
  stationId = await seedKitchenStation(suite.db, {
    tenantId: venue.tenantId,
    locationId: brandLocationId(venue.locationId),
    name: "Cocina",
  });
});

function run(overrides: Partial<OverdueOrdersInput> = {}): Promise<OverdueOrder[]> {
  const input: OverdueOrdersInput = {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    ...overrides,
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return computeOverdueOrders(tx, input);
  });
}

describe("computeOverdueOrders", () => {
  it("returns only overdue/forgotten orders, worst-first, with the right station + age; drops fresh and served lines", async () => {
    // Default thresholds (5/10/15): 11 min -> overdue, 16 min -> forgotten, 2 min -> fresh (excluded).
    const overdue = await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 1, ageMinutes: 11 },
    );
    const forgotten = await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 2, ageMinutes: 16 },
    );
    await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 3, ageMinutes: 2 },
    );
    // A line old enough to be forgotten, but SERVED — drops off the clock entirely (design §3), so
    // this whole order (its only line served) must not appear.
    await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 4, ageMinutes: 20, served: true },
    );

    const rows = await run();

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.orderId)).toEqual([forgotten.orderId, overdue.orderId]);
    expect(rows[0]).toMatchObject({
      orderId: forgotten.orderId,
      orderNumber: 2,
      stationName: "Cocina",
      band: "forgotten",
    });
    expect(rows[0]!.ageMinutes).toBeGreaterThanOrEqual(16);
    expect(rows[1]).toMatchObject({
      orderId: overdue.orderId,
      orderNumber: 1,
      stationName: "Cocina",
      band: "overdue",
    });
    expect(rows[1]!.ageMinutes).toBeGreaterThanOrEqual(11);
    expect(rows[1]!.ageMinutes).toBeLessThan(15);
  });

  it("reports the order's WORST unserved line, not its first — one order, two lines", async () => {
    const { orderId } = await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 1, ageMinutes: 2 }, // line 1: fresh
    );
    // A SECOND fired line on the SAME order, older and past forgotten — the order's band must reduce
    // to this worse line, not stay at the first (fresh) line.
    await seedFiredLine(
      suite.db,
      { tenantId: venue.tenantId, nodeId: venue.nodeId, stationId },
      { orderId, lineNo: 2, ageMinutes: 16 },
    );

    const rows = await run();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderId, band: "forgotten" });
  });

  it("among TWO lines both at the order's worst band, reports the OLDER one (not merely one of them)", async () => {
    const { orderId } = await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 1, ageMinutes: 16 }, // line 1: forgotten
    );
    // A THIRD line — well past line 1's age, ALSO forgotten (the same band), so the "oldest of the
    // worst" reduction must strictly REPLACE line 1 with this one, not just keep whichever line the
    // reduce started from. This is the `line.ageMinutes > oldest.ageMinutes` branch of the reduction
    // (the tied-age test above exercises the opposite, equal-age branch).
    await seedFiredLine(
      suite.db,
      { tenantId: venue.tenantId, nodeId: venue.nodeId, stationId },
      { orderId, lineNo: 2, ageMinutes: 25 },
    );

    const rows = await run();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderId, band: "forgotten" });
    expect(rows[0]!.ageMinutes).toBeGreaterThanOrEqual(25);
  });

  it("breaks a tied worst band (same age, different stations) by line_no, not by insertion/row-arrival order", async () => {
    // A second station in the same location — the fixture the tie needs, since the beforeEach station
    // only gives us one. `isDefault: false` avoids colliding with the beforeEach station's own default.
    const barra = await seedKitchenStation(suite.db, {
      tenantId: venue.tenantId,
      locationId: brandLocationId(venue.locationId),
      name: "Barra",
      isDefault: false,
    });
    const { orderId } = await seedOpenOrder(
      suite.db,
      { tenantId: venue.tenantId, tillId: venue.tillId, nodeId: venue.nodeId },
      1,
    );
    // ONE shared instant for BOTH lines — a real multi-station fire inserts every line in ONE
    // statement against a single shared `defaultNow()` (`apps/server/src/working-order.ts`'s
    // `fireLines`), so both rows get the BIT-IDENTICAL `queued_at`. Two separate `seedFiredLine` calls
    // each computing their own "now() - N minutes" do NOT tie exactly (each runs a few milliseconds
    // apart in its own implicit transaction) — reading the timestamp once and pinning it via
    // `queuedAt` is what reproduces the real tie.
    const tiedQueuedAt = (
      await suite.db.execute<{ ts: string }>(
        sql`select (now() - interval '11 minutes')::text as ts`,
      )
    ).rows[0]!.ts;
    // Fire line_no 2 (station "Barra") FIRST and line_no 1 (station "Cocina") SECOND — insertion order
    // is the OPPOSITE of line_no order. If the reduction ever fell back to insertion/PGlite-scan order
    // instead of the query's own `queued_at, line_no` ORDER BY, this would report "Barra"; the
    // correct, line_no-ordered answer is "Cocina" (line_no 1).
    await seedFiredLine(
      suite.db,
      { tenantId: venue.tenantId, nodeId: venue.nodeId, stationId: barra },
      { orderId, lineNo: 2, ageMinutes: 11, queuedAt: tiedQueuedAt },
    );
    await seedFiredLine(
      suite.db,
      { tenantId: venue.tenantId, nodeId: venue.nodeId, stationId },
      { orderId, lineNo: 1, ageMinutes: 11, queuedAt: tiedQueuedAt },
    );

    const rows = await run();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderId, band: "overdue", stationName: "Cocina" });
  });

  it("excludes a COLLECTED order even if its worst line is forgotten (design §3 — ages until collected)", async () => {
    await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 1, ageMinutes: 20, status: "settled", collected: true },
    );
    expect(await run()).toEqual([]);
  });

  it("excludes an ABANDONED order even if its worst line is forgotten", async () => {
    await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 1, ageMinutes: 20, status: "abandoned" },
    );
    expect(await run()).toEqual([]);
  });

  it("carries the dining table's label when the order is a tab", async () => {
    const seeded = await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 1, ageMinutes: 11, tableLabel: "12" },
    );
    const rows = await run();
    expect(rows).toEqual([expect.objectContaining({ orderId: seeded.orderId, tableLabel: "12" })]);
  });

  it("a bare walk-up (no table) carries a null tableLabel", async () => {
    await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 1, ageMinutes: 11 },
    );
    const rows = await run();
    expect(rows[0]!.tableLabel).toBeNull();
  });

  it("scopes to nodeId: another node's overdue order in the same tenant is excluded", async () => {
    const nodeB = await seedNodeAndSeries(suite.db, venue);
    const stationB = await seedKitchenStation(suite.db, {
      tenantId: venue.tenantId,
      locationId: brandLocationId(venue.locationId),
      name: "Barra",
      isDefault: false,
    });
    await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: nodeB.nodeId,
        locationId: venue.locationId,
        stationId: stationB,
      },
      { orderNumber: 1, ageMinutes: 20 },
    );
    expect(await run()).toEqual([]);
  });

  it("excludes another tenant's overdue order (RLS + the explicit tenant predicate)", async () => {
    const other = await seedVenue(suite.db);
    const otherStation = await seedKitchenStation(suite.db, {
      tenantId: other.tenantId,
      locationId: brandLocationId(other.locationId),
      name: "Cocina",
    });
    await seedFiredOrder(
      suite.db,
      {
        tenantId: other.tenantId,
        tillId: other.tillId,
        nodeId: other.nodeId,
        locationId: other.locationId,
        stationId: otherStation,
      },
      { orderNumber: 1, ageMinutes: 20 },
    );
    expect(await run()).toEqual([]);
  });

  it("returns [] when there are no ticket items at all", async () => {
    expect(await run()).toEqual([]);
  });

  it("breaks a tie (same band, same age) by order number ascending", async () => {
    // Two orders seeded with the SAME ageMinutes and default thresholds land at the identical
    // "overdue" band with (almost certainly) the identical floored age, so the primary band-rank and
    // secondary age tiebreaks both resolve to 0 and the sort falls through to order number.
    await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 5, ageMinutes: 11 },
    );
    await seedFiredOrder(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        locationId: venue.locationId,
        stationId,
      },
      { orderNumber: 3, ageMinutes: 11 },
    );

    const rows = await run();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.band === "overdue")).toBe(true);
    expect(rows.map((r) => r.orderNumber)).toEqual([3, 5]);
  });
});
