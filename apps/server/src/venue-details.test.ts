import { Hono } from "hono";
import { seedStationWeek } from "@waitron/venue-service/testing/station-week.js";
import { WorkforceBackend, employments } from "@waitron/workforce";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountWorkforceApi } from "./workforce-api.js";
import { jobOrigin } from "@waitron/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { VenueDetailPatch, VenueDetailWrite } from "./venue-detail-types.js";
import { recordDailyClose, businessDayStart, computeDailyClose } from "@waitron/reporting";
import { createOpenOrder, placeOrder } from "./working-order.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { recordTillSale } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import { deviceRequestCfg } from "./testing/session-device.js";
import { sql } from "drizzle-orm";
import {
  withTransaction,
  installChangeFeed,
  subscribeToChanges,
  CORE_CHANGE_SOURCES,
  sales,
  saleVoids,
  nodes,
  kitchenStations,
  diningTables,
} from "@waitron/db";
import { BOOKINGS_FLOOR_ANNOTATIONS, bookings } from "@waitron/bookings";
import {
  saveMenuPeriod,
  replaceMenuWeek,
  createDepartment,
  stationStates,
  stationDayStates,
} from "@waitron/venue-service";
import { mountReportApi, resolveVenueClock } from "./report-api.js";
import type { ResourceChange } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { readVenueDetails, writeVenueDetails } from "./venue-details.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: Venue;
beforeEach(async () => {
  venue = await setupVenue(suite.db);
  await suite.db.execute(
    sql`update departments set name = 'Dining department', trading_name = 'Customer trading name' where location_id = ${venue.cfg.locationId}`,
  );
});
const read = () => withTransaction(suite.db, (tx) => readVenueDetails(tx, venue.cfg));
afterEach(() => vi.useRealTimers());

async function prepareSale(observeClock?: () => void) {
  const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
  const clock: TrustedClock = {
    now: () => {
      observeClock?.();
      return {
        instant: new Date("2026-10-06T12:00:00Z"),
        offsetMinutes: 120,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("An anchored clock is supplied");
    },
    currentAnchor: () => null,
  };
  const backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
    resolveClient: () => Promise.reject(new Error("Local sale contacted AEAT")),
  });
  const cfg = await deviceRequestCfg(suite.db, venue.cfg);
  return () =>
    recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId: offers.zoneId,
      lines: [{ menuItemId: offers.offerFor(venue.cafeId), quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });
}

describe("venue detail edits", () => {
  it("reads the deployed address, issuer and history independently", async () => {
    const model = await read();
    expect(model.details).toEqual({
      name: "Sala principal",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    });
    expect(model.issuer).toEqual({
      country: "ES",
      legalName: "Deli Test SL",
      taxId: expect.any(String),
    });
    expect([model.hasSales, model.hasOrderHistory, model.hasDailyClose]).toEqual([
      false,
      false,
      false,
    ]);
    expect(model.policy.name).toEqual({
      decision: "allow_with_warning",
      reasons: ["current_details_only"],
    });
    expect(model.policy.province).toEqual({ decision: "refuse", reasons: ["geography_context"] });
    expect(model.provinces).toContainEqual({ code: "28", name: "Madrid" });
  });
  it("normalizes an edit and serves an equivalent retry even with a stale expected name", async () => {
    const initial = await read();
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "  New cafe\u0301  " },
      }),
    );
    expect(saved.changed).toBe(true);
    expect(saved.model.details.name).toBe("New café");
    const repeat = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "New café" },
      }),
    );
    expect(repeat.changed).toBe(false);
    expect((await read()).details.name).toBe("New café");
  });
  it("refuses a stale changed field and preserves the newer address", async () => {
    const initial = await read();
    await suite.db.execute(
      sql`update locations set name = 'Another editor', city = 'Alcalá de Henares' where id = ${venue.cfg.locationId}`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { name: "My edit" },
        }),
      ),
    ).rejects.toMatchObject({ code: "venue.detail_changed", params: { field: "name" } });
    expect((await read()).details.name).toBe("Another editor");
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { addressLine1: "Calle nueva 2" },
      }),
    );
    expect(saved.model.details.city).toBe("Alcalá de Henares");
    expect(saved.model.details.addressLine1).toBe("Calle nueva 2");
  });
  it("clears only optional line two and retains unrelated location settings", async () => {
    await suite.db.execute(
      sql`update locations set address_line2 = 'Upstairs' where id = ${venue.cfg.locationId}`,
    );
    const initial = await read();
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { addressLine2: "  " },
      }),
    );
    expect(saved.model.details.addressLine2).toBeNull();
    const rows = await suite.db.execute(
      sql`select operation_description, fiscal_territory from locations where id = ${venue.cfg.locationId}`,
    );
    expect(rows.rows).toEqual([
      {
        operation_description: "Venta en establecimiento",
        fiscal_territory: "ES-common",
      },
    ]);
  });
  it("serves empty and canonical equivalent patches without rewriting stored bytes", async () => {
    await suite.db.execute(
      sql`update locations set name = '  Sala principal  ', province = 'Madrid', time_zone = 'Europe/Madrid', day_cutover = '05:00:00' where id = ${venue.cfg.locationId}`,
    );
    const initial = await read();
    for (const changes of [
      {},
      { name: "Sala principal", province: "28", dayCutover: "05:00:00" },
    ]) {
      expect(
        (
          await withTransaction(suite.db, (tx) =>
            writeVenueDetails(tx, venue.cfg, { expected: initial.details, changes }),
          )
        ).changed,
      ).toBe(false);
    }
    expect((await read()).details.name).toBe("  Sala principal  ");
  });
  it.each(["country", "legalName", "taxId", "locationId", "fiscalTerritory"])(
    "refuses read-only %s even with a matching value",
    async (field) => {
      const initial = await read();
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: initial.details,
            changes: { [field]: field === "country" ? "ES" : "value" },
          }),
        ),
      ).rejects.toMatchObject({ code: "venue.detail_read_only", params: { field } });
      expect((await read()).details).toEqual(initial.details);
    },
  );
  it.each([
    [{ name: null }, "name", "type"],
    [{ name: ["name"] }, "name", "type"],
    [{ name: "  " }, "name", "required"],
    [{ name: "a".repeat(201) }, "name", "length"],
    [{ addressLine1: null }, "addressLine1", "required"],
    [{ unexpected: "not echoed" }, "changes", "unknown_field"],
    [{ timeZone: "not/a-zone" }, "timeZone", "time_zone"],
    [{ timeZone: "+02:00" }, "timeZone", "time_zone"],
    [{ timeZone: "-0500" }, "timeZone", "time_zone"],
    [{ dayCutover: "04:00garbage" }, "dayCutover", "cutover"],
    [{ dayCutover: "25:00" }, "dayCutover", "cutover"],
    [{ dayCutover: "04:00:01" }, "dayCutover", "cutover"],
    [{ postalCode: "abc" }, "postalCode", "postcode"],
    [{ postalCode: "08001" }, "postalCode", "postcode"],
  ])("refuses malformed changes %j atomically", async (changes, field, reason) => {
    const initial = await read();
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { name: "Valid new name", ...changes } as VenueDetailPatch,
        }),
      ),
    ).rejects.toMatchObject({ code: "venue.detail_invalid", params: { field, reason } });
    expect((await read()).details).toEqual(initial.details);
  });
});

describe("venue history locks", () => {
  it.each(["open", "placed", "settled", "abandoned"])(
    "retains the clock after an %s order with no sale",
    async (status) => {
      const id = randomUUID();
      await withTransaction(suite.db, (tx) => createOpenOrder(tx, venue.cfg, id, [], null));
      if (status === "settled")
        await suite.db.execute(
          sql`update working_orders set status = ${status}, settled_at = '2026-10-06T12:00:00.000Z' where id = ${id}`,
        );
      else if (status !== "open")
        await suite.db.execute(sql`update working_orders set status = ${status} where id = ${id}`);
      const initial = await read();
      expect([initial.hasSales, initial.hasOrderHistory, initial.hasDailyClose]).toEqual([
        false,
        true,
        false,
      ]);
      expect(initial.policy.timeZone).toEqual({ decision: "refuse", reasons: ["orders"] });
      for (const changes of [{ timeZone: "UTC" }, { dayCutover: "04:00" }]) {
        await expect(
          withTransaction(suite.db, (tx) =>
            writeVenueDetails(tx, venue.cfg, {
              expected: initial.details,
              changes: { name: "Should roll back", ...changes },
            }),
          ),
        ).rejects.toMatchObject({
          code: "venue.detail_locked",
          params: { field: Object.keys(changes)[0], reason: "orders" },
        });
        expect((await read()).details).toEqual(initial.details);
      }
      const allowed = await withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { name: "Allowed", timeZone: "Europe/Madrid", dayCutover: "05:00:00" },
        }),
      );
      expect(allowed.changed).toBe(true);
      expect(allowed.model.details.name).toBe("Allowed");
      expect(
        (
          await withTransaction(suite.db, (tx) =>
            writeVenueDetails(tx, venue.cfg, {
              expected: initial.details,
              changes: { name: "Allowed" },
            }),
          )
        ).changed,
      ).toBe(false);
    },
  );
  it("locks both clock fields after an empty daily close", async () => {
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from persons where role = 'manager' limit 1`,
    );
    await withTransaction(suite.db, (tx) =>
      recordDailyClose(tx, {
        nodeId: venue.cfg.nodeId,
        businessDay: "2026-10-01",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        closedBy: rows[0]!.id,
        cashCounts: [],
      }),
    );
    const initial = await read();
    expect([initial.hasSales, initial.hasOrderHistory, initial.hasDailyClose]).toEqual([
      false,
      false,
      true,
    ]);
    for (const field of ["timeZone", "dayCutover"] as const) {
      expect(initial.policy[field]).toEqual({ decision: "refuse", reasons: ["daily_close"] });
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: initial.details,
            changes: { [field]: field === "timeZone" ? "UTC" : "04:00" },
          }),
        ),
      ).rejects.toMatchObject({
        code: "venue.detail_locked",
        params: { field, reason: "daily_close" },
      });
    }
    expect((await read()).details).toEqual(initial.details);
    const retained = {
      closes: suite.db.all(sql`select * from daily_closes`),
      chain: suite.db.all(sql`select * from daily_close_chain`),
    };
    const noOp = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { timeZone: "Europe/Madrid", dayCutover: "05:00:00" },
      }),
    );
    expect(noOp.changed).toBe(false);
    expect(noOp.model.details).toEqual(initial.details);
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "Current empty-close display" },
      }),
    );
    expect(saved.model.details).toEqual({
      ...initial.details,
      name: "Current empty-close display",
    });
    expect({
      closes: suite.db.all(sql`select * from daily_closes`),
      chain: suite.db.all(sql`select * from daily_close_chain`),
    }).toEqual(retained);
  });
  it("locks province and clock after a real locally recorded sale", async () => {
    await (
      await prepareSale()
    )();
    const initial = await read();
    expect(initial.hasSales).toBe(true);
    for (const [field, value] of [
      ["timeZone", "UTC"],
      ["dayCutover", "04:00"],
      ["province", "Barcelona"],
    ] as const) {
      expect(initial.policy[field]).toEqual({ decision: "refuse", reasons: ["sales"] });
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: initial.details,
            changes: { [field]: value, name: "Atomic refusal" },
          }),
        ),
      ).rejects.toMatchObject({ code: "venue.detail_locked", params: { field, reason: "sales" } });
      expect((await read()).details).toEqual(initial.details);
    }
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "Current display", province: "28", dayCutover: "05:00:00" },
      }),
    );
    expect(saved.model.details.name).toBe("Current display");
  });
  it("permits a clock override before operational history and stores whole seconds", async () => {
    const initial = await read();
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { timeZone: "UTC", dayCutover: "04:30" },
      }),
    );
    expect(saved.model.details.timeZone).toBe("UTC");
    expect(saved.model.details.dayCutover).toBe("04:30");
    const { rows } = await suite.db.execute(
      sql`select day_cutover from locations where id = ${venue.cfg.locationId}`,
    );
    expect(rows).toEqual([{ day_cutover: "04:30:00" }]);
  });
});

describe("crafted detail bodies and legacy values", () => {
  it("reports forbidden identity keys before unknown keys regardless of their order", async () => {
    const initial = await read();
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { unexpected: "hidden", country: "ES" },
        } as unknown as VenueDetailWrite),
      ),
    ).rejects.toMatchObject({ code: "venue.detail_read_only", params: { field: "country" } });
    expect((await read()).details).toEqual(initial.details);
  });
  it.each([
    null,
    [],
    "body",
    { changes: [], expected: {} },
    { changes: {}, expected: null },
    { changes: {}, expected: {} },
  ])("refuses a malformed envelope %j before writing", async (input) => {
    const initial = await read();
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, input as unknown as VenueDetailWrite),
      ),
    ).rejects.toMatchObject({ code: "venue.detail_invalid" });
    expect((await read()).details).toEqual(initial.details);
  });
  it("keeps unset legacy geography out of a name-only change", async () => {
    await suite.db.execute(
      sql`update locations set address_line1 = null, postal_code = null, province = null, city = null where id = ${venue.cfg.locationId}`,
    );
    const initial = await read();
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "Corrected", province: null, city: null },
      }),
    );
    expect(saved.model.details).toEqual({ ...initial.details, name: "Corrected" });
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, { expected: saved.model.details, changes: { city: "" } }),
      ),
    ).rejects.toMatchObject({
      code: "venue.detail_invalid",
      params: { field: "city", reason: "required" },
    });
  });
  it("refuses a cross-context province before sales but accepts a postcode correction in Madrid", async () => {
    const initial = await read();
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { province: "Barcelona", name: "Not committed" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "venue.detail_locked",
      params: { field: "province", reason: "geography_context" },
    });
    expect((await read()).details).toEqual(initial.details);
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { postalCode: "28014" },
      }),
    );
    expect(saved.model.details.postalCode).toBe("28014");
    expect(saved.model.details.province).toBe("Madrid");
  });
  it("keeps exact invalid legacy values as no-ops without normalizing other fields", async () => {
    await suite.db.execute(
      sql`update locations set time_zone = 'legacy-invalid', province = 'Unknown legacy province' where id = ${venue.cfg.locationId}`,
    );
    const initial = await read();
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: {
          timeZone: "legacy-invalid",
          province: "Unknown legacy province",
          name: "Corrected name",
        },
      }),
    );
    expect(saved.model.details).toEqual({ ...initial.details, name: "Corrected name" });
  });
  it("does not issue an UPDATE for empty or equivalent retries", async () => {
    const initial = await read();
    await suite.db.execute(
      sql`create trigger detail_probe_no_update before update on locations begin select raise(abort, 'detail probe update'); end`,
    );
    try {
      for (const changes of [
        {},
        { name: " Sala principal ", province: "28", dayCutover: "05:00:00" },
      ]) {
        expect(
          (
            await withTransaction(suite.db, (tx) =>
              writeVenueDetails(tx, venue.cfg, { expected: initial.details, changes }),
            )
          ).changed,
        ).toBe(false);
      }
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: initial.details,
            changes: { name: "Actually changed" },
          }),
        ),
      ).rejects.toThrow("detail probe update");
    } finally {
      await suite.db.execute(sql`drop trigger detail_probe_no_update`);
    }
  });
  it("refuses a missing deployed location", async () => {
    await expect(
      withTransaction(suite.db, (tx) => readVenueDetails(tx, { locationId: randomUUID() })),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "locationId" },
    });
  });
});
describe("existing clock-change cutover mapping", () => {
  it.each([
    ["2026-03-29T12:00:00Z", "Europe/Madrid", "2026-03-29T01:30:00.000Z"],
    ["2026-10-25T12:00:00Z", "Europe/Madrid", "2026-10-25T01:30:00.000Z"],
    ["2026-03-29T12:00:00Z", "UTC", "2026-03-29T02:30:00.000Z"],
  ])("resolves %s in %s", (instant, timeZone, expected) => {
    expect(businessDayStart(new Date(instant), { timeZone, dayCutover: "02:30" })).toBe(expected);
  });
});

describe("unavailable country and own expected values", () => {
  it("offers no geography edit when the stored country has no installed pack", async () => {
    await suite.db.execute(sql`update tenants set country = 'ZZ' where id = 1`);
    const initial = await read();
    expect(initial.provinces).toEqual([]);
    for (const field of ["city", "postalCode"] as const) {
      expect(initial.policy[field]).toEqual({ decision: "refuse", reasons: ["geography_context"] });
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: initial.details,
            changes: { [field]: field === "city" ? "New town" : "28014" },
          }),
        ),
      ).rejects.toMatchObject({
        code: "venue.detail_invalid",
        params: { field, reason: "country_unavailable" },
      });
    }
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "Corrected display", addressLine1: "Updated street" },
      }),
    );
    expect(saved.model.details.name).toBe("Corrected display");
    expect(saved.model.details.addressLine1).toBe("Updated street");
    expect(saved.model.issuer.country).toBe("ZZ");
  });
  it("requires expected fields on the request itself", async () => {
    const initial = await read();
    const expected = Object.create(initial.details) as VenueDetailWrite["expected"];
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, { expected, changes: { name: "Should not write" } }),
      ),
    ).rejects.toMatchObject({
      code: "venue.detail_invalid",
      params: { field: "name", reason: "type" },
    });
    expect((await read()).details).toEqual(initial.details);
  });
  it("keeps department, trading and taxpayer names when editing the venue display", async () => {
    const initial = await read();
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "Changed venue display" },
      }),
    );
    expect(saved.model.details.name).toBe("Changed venue display");
    expect(saved.model.issuer.legalName).toBe("Deli Test SL");
    const { rows } = await suite.db.execute(
      sql`select name, trading_name from departments where location_id = ${venue.cfg.locationId}`,
    );
    expect(rows).toEqual([{ name: "Dining department", trading_name: "Customer trading name" }]);
  });
});

describe("venue details preserve committed history", () => {
  const retainedTables = [
    "tenants",
    "nodes",
    "invoice_series",
    "sales",
    "sale_lines",
    "tenders",
    "sale_settlements",
    "sale_voids",
    "registros_facturacion",
    "registro_sif",
    "contadores_instalacion",
    "working_orders",
    "working_order_lines",
    "ticket_items",
    "departments",
    "print_jobs",
    "drawer_opens",
  ];
  function retained() {
    return Object.fromEntries(
      retainedTables.map((table) => [
        table,
        suite.db.all(sql`select * from ${sql.identifier(table)} order by rowid`),
      ]),
    );
  }
  it("keeps full history and series bytes through a refusal and an allowed address/name edit", async () => {
    await (
      await prepareSale()
    )();
    const initial = await read();
    const history = retained();
    const location = suite.db.all(sql`select * from locations`);
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { name: "Refused together", timeZone: "UTC" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "venue.detail_locked",
      params: { field: "timeZone", reason: "sales" },
    });
    expect(suite.db.all(sql`select * from locations`)).toEqual(location);
    expect(retained()).toEqual(history);
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "New display", addressLine1: "Calle nueva 3", city: "Alcalá de Henares" },
      }),
    );
    expect(saved.model.details).toEqual({
      ...initial.details,
      name: "New display",
      addressLine1: "Calle nueva 3",
      city: "Alcalá de Henares",
    });
    expect(retained()).toEqual(history);
    const { rows } = await suite.db.execute(sql`pragma foreign_key_check`);
    expect(rows).toEqual([]);
  });
  it("a rolled-back real sale does not leave history or consume a series number", async () => {
    const sell = await prepareSale();
    const before = retained();
    await suite.db.execute(
      sql`create trigger detail_sale_rollback before insert on sale_settlements begin select raise(abort, 'sale rollback probe'); end`,
    );
    try {
      await expect(sell()).rejects.toThrow("sale rollback probe");
      expect(retained()).toEqual(before);
      const initial = await read();
      expect([initial.hasSales, initial.hasOrderHistory]).toEqual([false, false]);
      const saved = await withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { timeZone: "UTC" },
        }),
      );
      expect(saved.changed).toBe(true);
      expect(saved.model.details.timeZone).toBe("UTC");
    } finally {
      await suite.db.execute(sql`drop trigger detail_sale_rollback`);
    }
  });
  it("notifies the old and new location resource and stays silent on equivalent and empty retries after sales", async () => {
    await (
      await prepareSale()
    )();
    await installChangeFeed(suite.db, CORE_CHANGE_SOURCES);
    const initial = await read();
    const events: ResourceChange[] = [];
    const unsubscribe = subscribeToChanges((event) => events.push(event));
    try {
      const saved = await withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { name: "New display" },
        }),
      );
      expect(saved.changed).toBe(true);
      expect(events).toEqual([
        { resources: [{ type: "locations", id: venue.cfg.locationId }] },
        { resources: [{ type: "locations", id: venue.cfg.locationId }] },
      ]);
      events.length = 0;
      for (const changes of [
        {},
        { name: " New display ", province: "28", dayCutover: "05:00:00" },
      ]) {
        const repeat = await withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, { expected: initial.details, changes }),
        );
        expect(repeat.changed).toBe(false);
        expect(events).toEqual([]);
        expect(suite.db.all(sql`select * from change_log`)).toEqual([]);
      }
    } finally {
      unsubscribe();
    }
  });
  it("serves a recognized zone alias after history without rewriting its stored spelling", async () => {
    await suite.db.execute(
      sql`update locations set time_zone = 'US/Eastern' where id = ${venue.cfg.locationId}`,
    );
    await (
      await prepareSale()
    )();
    const initial = await read();
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "Alias control", timeZone: "America/New_York" },
      }),
    );
    expect(saved.changed).toBe(true);
    expect(saved.model.details).toEqual({
      ...initial.details,
      name: "Alias control",
      timeZone: "US/Eastern",
    });
  });
  it("queues a clock edit after a real sale and refuses it using the committed sale history", async () => {
    const sell = await prepareSale();
    const initial = await read();
    const sale = sell();
    const edit = withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "Refused together", timeZone: "UTC" },
      }),
    );
    // Attach the rejection observer before waiting for the first queued write.
    const refused = expect(edit).rejects.toMatchObject({
      code: "venue.detail_locked",
      params: { field: "timeZone", reason: "sales" },
    });
    await sale;
    await refused;
    expect((await read()).details).toEqual(initial.details);
    expect(suite.db.all(sql`select id from sales`)).toHaveLength(1);
  });
  it("commits a queued clock edit before the following real sale reads current location details", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    const clocksReadAtIssuance: unknown[] = [];
    const sell = await prepareSale(() =>
      clocksReadAtIssuance.push(
        suite.db.all(
          sql`select time_zone, day_cutover from locations where id = ${venue.cfg.locationId}`,
        ),
      ),
    );
    await withTransaction(suite.db, async (tx) => {
      const periods = await tx.execute<{ id: string; department_id: string }>(
        sql`select p.id, p.department_id from menu_periods p join departments d on d.id = p.department_id where d.location_id = ${venue.cfg.locationId} and p.name = 'Always'`,
      );
      for (const period of periods.rows)
        await replaceMenuWeek(
          tx,
          venue.cfg,
          period.department_id,
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            slots: [{ periodId: period.id, startsAt: "09:00", endsAt: "17:00" }],
          })),
          new Date(),
        );
    });
    const initial = await read();
    const edit = withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { timeZone: "UTC", dayCutover: "04:30" },
      }),
    );
    const sale = sell();
    const saved = await edit;
    expect(saved.changed).toBe(true);
    await sale;
    const current = await read();
    expect(current.details).toEqual({ ...initial.details, timeZone: "UTC", dayCutover: "04:30" });
    expect(current.hasSales).toBe(true);
    expect(clocksReadAtIssuance.length).toBeGreaterThan(0);
    for (const clockRow of clocksReadAtIssuance)
      expect(clockRow).toEqual([{ time_zone: "UTC", day_cutover: "04:30:00" }]);
    expect(suite.db.all(sql`select id from sales`)).toHaveLength(1);
  });
});

describe("all retained sale rows lock venue clocks", () => {
  it.each(["practice", "zero", "void", "correction", "other_node"] as const)(
    "does not exclude %s history from the policy",
    async (kind) => {
      const saleId = randomUUID();
      const otherNode = randomUUID();
      if (kind === "other_node")
        await suite.db.insert(nodes).values({
          id: otherNode,
          locationId: venue.cfg.locationId,
          name: "Retained other node",
        });
      const base = {
        source: "demo_seed" as const,
        deviceId: null,
        seriesId: venue.cfg.seriesId,
        nodeId: kind === "other_node" ? otherNode : venue.cfg.nodeId,
        invoiceNumber: 1,
        issuedAt: "2026-10-06T12:00:00.000Z",
        issuedOffsetMinutes: 120,
        total: kind === "zero" ? 0 : 150,
        vatBreakdown: [{ rate: "21.00", base: "1.24", tax: "0.26" }],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: kind === "practice" ? "none" : "verifactu",
        fiscalState: kind === "practice" ? ("not_applicable" as const) : ("recorded" as const),
      };
      await suite.db.insert(sales).values({ ...base, id: saleId });
      if (kind === "void")
        await suite.db.insert(saleVoids).values({
          saleId,
          reason: "Predicate control",
          voidedAt: "2026-10-06T12:30:00.000Z",
        });
      if (kind === "correction")
        await suite.db.insert(sales).values({
          ...base,
          id: randomUUID(),
          invoiceNumber: 2,
          total: -150,
          correctsSaleId: saleId,
        });
      const initial = await read();
      expect(initial.hasSales).toBe(true);
      expect(initial.hasOrderHistory).toBe(false);
      expect(initial.policy.timeZone).toEqual({ decision: "refuse", reasons: ["sales"] });
      const stored = suite.db.all(sql`select * from sales order by invoice_number`);
      for (const [field, value] of [
        ["timeZone", "UTC"],
        ["dayCutover", "04:30"],
        ["province", "Barcelona"],
      ] as const) {
        await expect(
          withTransaction(suite.db, (tx) =>
            writeVenueDetails(tx, venue.cfg, {
              expected: initial.details,
              changes: { name: "No partial save", [field]: value },
            }),
          ),
        ).rejects.toMatchObject({
          code: "venue.detail_locked",
          params: { field, reason: "sales" },
        });
        expect((await read()).details).toEqual(initial.details);
        expect(suite.db.all(sql`select * from sales order by invoice_number`)).toEqual(stored);
      }
      const noOp = await withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { province: "28", dayCutover: "05:00:00" },
        }),
      );
      expect(noOp.changed).toBe(false);
    },
  );
});

describe("venue detail consumer reads", () => {
  it("changes current station days and booking annotations without rewriting their intentions", async () => {
    const at = new Date("2026-10-02T23:30:00Z");
    const stationIds = await withTransaction(suite.db, async (tx) => {
      const rows = await tx
        .insert(kitchenStations)
        .values([
          { locationId: venue.cfg.locationId, name: "Weekly station" },
          { locationId: venue.cfg.locationId, name: "Old-day override" },
          { locationId: venue.cfg.locationId, name: "New-day override" },
        ])
        .returning({ id: kitchenStations.id });
      for (const row of rows.slice(0, 3)) {
        await seedStationWeek(tx, venue.cfg, row.id, [
          { weekday: 5, opensAt: "23:00", closesAt: "23:59" },
        ]);
      }
      await tx.insert(stationDayStates).values([
        { stationId: rows[1]!.id, businessDay: "2026-10-02", open: false },
        { stationId: rows[2]!.id, businessDay: "2026-10-01", open: false },
      ]);
      const defaults = await tx.execute<{ id: string }>(
        sql`select id from kitchen_stations where location_id = ${venue.cfg.locationId} and is_default`,
      );
      expect(defaults.rows).toHaveLength(1);
      return [...rows.map((row) => row.id), defaults.rows[0]!.id];
    });
    const [table] = await suite.db
      .insert(diningTables)
      .values({
        locationId: venue.cfg.locationId,
        label: "Booking clock control",
      })
      .returning({ id: diningTables.id });
    await suite.db.insert(bookings).values([
      {
        locationId: venue.cfg.locationId,
        tableId: table!.id,
        bookingDate: "2026-10-03",
        bookingTime: "02:00:00",
        partySize: 2,
        contactName: "Saturday guest",
        createdBy: randomUUID(),
      },
      {
        locationId: venue.cfg.locationId,
        tableId: table!.id,
        bookingDate: "2026-10-02",
        bookingTime: "23:45:00",
        partySize: 2,
        contactName: "Friday guest",
        createdBy: randomUUID(),
      },
    ]);
    const retained = () => ({
      weekCells: suite.db.all(sql`select * from hours_week_cells order by id`),
      weekPeriods: suite.db.all(sql`select * from hours_week_periods order by id`),
      overrides: suite.db.all(sql`select * from station_day_states order by id`),
      bookings: suite.db.all(sql`select * from bookings order by id`),
    });
    const before = retained();
    expect([before.weekCells.length, before.weekPeriods.length]).toEqual([21, 3]);
    const readCurrent = () =>
      withTransaction(suite.db, async (tx) => {
        const states = await stationStates(tx, venue.cfg, at);
        const annotations = await BOOKINGS_FLOOR_ANNOTATIONS.annotate(tx, venue.cfg, at, [
          table!.id,
        ]);
        return {
          open: stationIds.map((id) => states.get(id)!.open),
          annotation: annotations.get(table!.id),
        };
      });
    expect(await readCurrent()).toEqual({
      open: [false, false, false, true],
      annotation: { reservedTime: "02:00" },
    });
    const initial = await read();
    await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { timeZone: "UTC", dayCutover: "23:45" },
      }),
    );
    expect(await readCurrent()).toEqual({
      open: [true, true, false, true],
      annotation: { reservedTime: "23:45" },
    });
    expect(retained()).toEqual(before);
    expect((await read()).hasOrderHistory).toBe(false);
  });

  it("keeps operational reports and the frozen close after allowed corrections and a refused clock edit", async () => {
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const cfg = await deviceRequestCfg(suite.db, venue.cfg);
    const clock: TrustedClock = {
      now: () => ({
        instant: new Date("2026-10-06T03:15:00Z"),
        offsetMinutes: 120,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      }),
      anchor: () => {
        throw Error("No external clock needed");
      },
      currentAnchor: () => null,
    };
    const backend = new VerifactuBackend({
      clock,
      db: suite.db,
      environment: "preproduction",
      deploymentEnvironment: "preproduction",
      resolveClient: () => Promise.reject(Error("No external filing permitted")),
    });
    await recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId: offers.zoneId,
      lines: [{ menuItemId: offers.offerFor(venue.cafeId), quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });
    const app = new Hono();
    mountReportApi(app, { db: suite.db, cfg: venue.cfg, venueLocale: "en-GB" }, () => {});
    const httpReport = async (businessDay: string) => {
      const response = await app.request(
        `/management-api/reports/daily-close?businessDay=${businessDay}`,
        {
          headers: { cookie: venue.managerCookie },
        },
      );
      expect(response.status).toBe(200);
      return response.json();
    };
    const reports = () =>
      withTransaction(suite.db, async (tx) => {
        const current = await resolveVenueClock(tx, venue.cfg.nodeId);
        const previous = await computeDailyClose(tx, {
          nodeId: venue.cfg.nodeId,
          businessDay: "2026-10-05",
          ...current,
        });
        const day = await computeDailyClose(tx, {
          nodeId: venue.cfg.nodeId,
          businessDay: "2026-10-06",
          ...current,
        });
        return { previous, day };
      });
    const httpBefore = {
      previous: await httpReport("2026-10-05"),
      day: await httpReport("2026-10-06"),
    };
    expect(httpBefore.previous.counts.sales).toBe(0);
    expect(httpBefore.day.counts.sales).toBe(1);
    const before = await reports();
    expect(before.previous.counts.sales).toBe(0);
    expect(before.day.counts.sales).toBe(1);
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from persons where role = 'manager' limit 1`,
    );
    await withTransaction(suite.db, (tx) =>
      recordDailyClose(tx, {
        nodeId: venue.cfg.nodeId,
        businessDay: "2026-10-06",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        closedBy: rows[0]!.id,
        cashCounts: [
          {
            deviceId: cfg.origin.deviceId,
            openingFloat: "0.00",
            payouts: "0.00",
            countedCash: "1.50",
          },
        ],
      }),
    );
    const retained = () => ({
      closes: suite.db.all(sql`select * from daily_closes`),
      heads: suite.db.all(sql`select * from daily_close_chain`),
      fiscal: suite.db.all(sql`select * from registros_facturacion`),
      series: suite.db.all(sql`select * from invoice_series order by id`),
    });
    const history = retained();
    const initial = await read();
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: {
          name: "Corrected display",
          addressLine1: "Corrected street",
          city: "Alcalá de Henares",
        },
      }),
    );
    expect(saved.changed).toBe(true);
    expect(saved.model.details).toEqual({
      ...initial.details,
      name: "Corrected display",
      addressLine1: "Corrected street",
      city: "Alcalá de Henares",
    });
    expect(await reports()).toEqual(before);
    expect(retained()).toEqual(history);
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: saved.model.details,
          changes: { timeZone: "UTC", dayCutover: "06:00", name: "Must not save" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "venue.detail_locked",
      params: { field: "timeZone", reason: "sales" },
    });
    expect((await read()).details).toEqual(saved.model.details);
    expect(await reports()).toEqual(before);
    expect({
      previous: await httpReport("2026-10-05"),
      day: await httpReport("2026-10-06"),
    }).toEqual(httpBefore);
    expect(retained()).toEqual(history);
  });
});

describe("complete editable field validation", () => {
  it.each([
    "name",
    "addressLine1",
    "addressLine2",
    "postalCode",
    "city",
    "province",
    "timeZone",
    "dayCutover",
  ] as const)("does not coerce an array or number submitted as %s", async (field) => {
    const initial = await read();
    for (const value of [[initial.details[field]], 123]) {
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: initial.details,
            changes: { [field]: value } as VenueDetailPatch,
          }),
        ),
      ).rejects.toMatchObject({ code: "venue.detail_invalid", params: { field, reason: "type" } });
      expect((await read()).details).toEqual(initial.details);
    }
  });
  it.each([
    "name",
    "addressLine1",
    "city",
    "postalCode",
    "province",
    "timeZone",
    "dayCutover",
  ] as const)("refuses clearing required %s without saving a companion field", async (field) => {
    const initial = await read();
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { addressLine2: "Must not save", [field]: " " },
        }),
      ),
    ).rejects.toMatchObject({
      code: "venue.detail_invalid",
      params: { field, reason: "required" },
    });
    expect((await read()).details).toEqual(initial.details);
  });
  it.each(["name", "addressLine1", "addressLine2", "city"] as const)(
    "counts Unicode code points for %s, preserving interior spaces and case",
    async (field) => {
      const initial = await read();
      const accepted = "É  Mixed" + "😀".repeat(192);
      const saved = await withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { [field]: `  ${accepted}  ` },
        }),
      );
      expect(saved.model.details[field]).toBe(accepted);
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: saved.model.details,
            changes: { [field]: accepted + "😀" },
          }),
        ),
      ).rejects.toMatchObject({
        code: "venue.detail_invalid",
        params: { field, reason: "length" },
      });
      expect((await read()).details).toEqual(saved.model.details);
    },
  );
  it("keeps all field policies and allows current display/address corrections after a real sale", async () => {
    await (
      await prepareSale()
    )();
    const initial = await read();
    expect(initial.policy).toEqual({
      name: { decision: "allow_with_warning", reasons: ["current_details_only"] },
      addressLine1: { decision: "allow", reasons: [] },
      addressLine2: { decision: "allow", reasons: [] },
      city: { decision: "allow_with_warning", reasons: ["holiday_geography"] },
      postalCode: { decision: "allow_with_warning", reasons: ["current_details_only"] },
      province: { decision: "refuse", reasons: ["sales"] },
      timeZone: { decision: "refuse", reasons: ["sales"] },
      dayCutover: { decision: "refuse", reasons: ["sales"] },
    });
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: {
          name: "Current display",
          addressLine1: "New street",
          addressLine2: "Upper floor",
          city: "Alcalá de Henares",
          postalCode: "28014",
        },
      }),
    );
    expect(saved.model.details).toEqual({
      ...initial.details,
      name: "Current display",
      addressLine1: "New street",
      addressLine2: "Upper floor",
      city: "Alcalá de Henares",
      postalCode: "28014",
    });
    const cleared = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: saved.model.details,
        changes: { addressLine2: null },
      }),
    );
    expect(cleared.model.details).toEqual({ ...saved.model.details, addressLine2: null });
    expect(cleared.model.policy).toEqual(initial.policy);
  });
  it.each(["modules", "invoiceLocales", "receiptPrintMode", "nodeId"])(
    "does not accept %s through a crafted details patch",
    async (key) => {
      const initial = await read();
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: initial.details,
            changes: { name: "Must not save", [key]: "hidden" },
          }),
        ),
      ).rejects.toMatchObject({
        code: "venue.detail_invalid",
        params: { field: "changes", reason: "unknown_field" },
      });
      expect((await read()).details).toEqual(initial.details);
    },
  );
});

describe("workforce facts after venue corrections", () => {
  it("keeps midnight offset dates, the published roster and chain bytes through an eligible clock edit", async () => {
    const backend = new WorkforceBackend();
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from persons where role = 'manager' limit 1`,
    );
    const personId = rows[0]!.id;
    await suite.db.insert(employments).values({
      personId,
      contractedMinutesPerWeek: 2400,
      contractType: "full_time",
      startDate: "2026-01-01",
      payRate: 1500,
    });
    const versionId = await withTransaction(suite.db, (tx) =>
      backend.createRosterVersion(tx, { locationId: venue.cfg.locationId, period: "2026-10-05" }),
    );
    await withTransaction(suite.db, async (tx) => {
      await backend.addShift(tx, {
        versionId,
        personId,
        locationId: venue.cfg.locationId,
        startsAt: "2026-10-05T23:30:00Z",
        startsOffsetMinutes: 120,
        endsAt: "2026-10-06T00:30:00Z",
        endsOffsetMinutes: 120,
        role: "Waiter",
      });
      await backend.publishRoster(tx, { versionId, publishedByPersonId: personId });
      const event = {
        nodeId: venue.cfg.nodeId,
        personId,
        locationId: venue.cfg.locationId,
        offsetMinutes: 120,
        origin: jobOrigin("dashboard"),
      };
      await backend.clockIn(tx, { ...event, at: "2026-10-05T23:30:00Z" });
      await backend.clockOut(tx, { ...event, at: "2026-10-06T00:30:00Z" });
    });
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId }),
    );
    const app = new Hono();
    mountWorkforceApi(app, { db: suite.db, cfg: venue.cfg }, () => {});
    const get = async (path: string) => {
      const response = await app.request(`/management-api/${path}`, {
        headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<unknown>;
    };
    const readCurrent = async () => ({
      roster: await get(`roster?locationId=${venue.cfg.locationId}&period=2026-10-05`),
      comparison: await get(
        `planned-vs-actual?locationId=${venue.cfg.locationId}&from=2026-10-06&to=2026-10-07`,
      ),
      summary: await withTransaction(suite.db, (tx) =>
        backend.workSummary(
          tx,
          { personId, period: { start: "2026-10-06", end: "2026-10-07" } },
          { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
        ),
      ),
    });
    const retained = () => ({
      entries: suite.db.all(sql`select * from time_entries order by sequence_no`),
      chain: suite.db.all(sql`select * from workforce_chains`),
      shifts: suite.db.all(sql`select * from shifts`),
      versions: suite.db.all(sql`select * from roster_versions`),
    });
    const before = await readCurrent();
    expect(before.comparison).toEqual([
      {
        personId,
        workDate: "2026-10-06",
        plannedMinutes: 60,
        workedMinutes: 60,
        lateMinutes: 0,
        noShow: false,
        unplanned: false,
      },
    ]);
    const history = retained();
    expect(history.entries).toHaveLength(2);
    const initial = await read();
    expect([initial.hasSales, initial.hasOrderHistory, initial.hasDailyClose]).toEqual([
      false,
      false,
      false,
    ]);
    await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { timeZone: "UTC", dayCutover: "23:45", name: "Current location label" },
      }),
    );
    expect(await readCurrent()).toEqual(before);
    expect(retained()).toEqual(history);
    expect(await get("locations")).toEqual([
      { id: venue.cfg.locationId, name: "Current location label" },
    ]);
  });
});

describe("open kitchen work during venue corrections", () => {
  it("refuses the clock while preserving sent line and station assignments on a display correction", async () => {
    const offers = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, venue.cfg, { serviceMode: "ticket_then_pay" }),
    );
    const cfg = await deviceRequestCfg(suite.db, venue.cfg);
    const clock: TrustedClock = {
      now: () => ({
        instant: new Date("2026-10-06T12:00:00Z"),
        offsetMinutes: 120,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      }),
      anchor: () => {
        throw Error("No external clock needed");
      },
      currentAnchor: () => null,
    };
    const backend = new VerifactuBackend({
      clock,
      db: suite.db,
      environment: "preproduction",
      deploymentEnvironment: "preproduction",
      resolveClient: () => Promise.reject(Error("No external filing permitted")),
    });
    const id = randomUUID();
    await withTransaction(suite.db, (tx) =>
      createOpenOrder(
        tx,
        cfg,
        id,
        [{ menuItemId: offers.offerFor(venue.cafeId), quantity: "1" }],
        "Kitchen work",
        { zoneId: offers.zoneId },
      ),
    );
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from persons where role = 'manager' limit 1`,
    );
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, rows[0]!.id);
    const retained = () => ({
      orders: suite.db.all(sql`select * from working_orders order by id`),
      lines: suite.db.all(sql`select * from working_order_lines order by id`),
      tickets: suite.db.all(sql`select * from ticket_items order by id`),
      contexts: suite.db.all(sql`select * from order_service_contexts order by working_order_id`),
    });
    const before = retained();
    expect(before.tickets).toHaveLength(1);
    expect(before.tickets[0]).toMatchObject({
      station_id: venue.defaultStationId,
      state: "queued",
    });
    const initial = await read();
    expect([initial.hasSales, initial.hasOrderHistory]).toEqual([false, true]);
    await expect(
      withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: initial.details,
          changes: { name: "Refused together", timeZone: "UTC" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "venue.detail_locked",
      params: { field: "timeZone", reason: "orders" },
    });
    expect((await read()).details).toEqual(initial.details);
    expect(retained()).toEqual(before);
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { name: "Current display", addressLine1: "Corrected street" },
      }),
    );
    expect(saved.model.details).toEqual({
      ...initial.details,
      name: "Current display",
      addressLine1: "Corrected street",
    });
    expect(retained()).toEqual(before);
  });
});

it("accepts a named Etc zone containing a sign and passes it to the reporting clock", async () => {
  const initial = await read();
  const saved = await withTransaction(suite.db, (tx) =>
    writeVenueDetails(tx, venue.cfg, {
      expected: initial.details,
      changes: { timeZone: " Etc/GMT+2 " },
    }),
  );
  expect(saved.changed).toBe(true);
  expect(saved.model.details.timeZone).toBe("Etc/GMT+2");
  expect(businessDayStart(new Date("2026-10-06T12:00:00Z"), saved.model.details)).toBe(
    "2026-10-06T07:00:00.000Z",
  );
});

describe("reviewed legacy geography and clock repairs", () => {
  it.each([null, "Unknown legacy province"])(
    "does not offer postcode edits without a resolved province: %s",
    async (province) => {
      await suite.db.execute(
        sql`update locations set province = ${province} where id = ${venue.cfg.locationId}`,
      );
      const model = await read();
      expect(model.policy.postalCode).toEqual({
        decision: "refuse",
        reasons: ["geography_context"],
      });
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(tx, venue.cfg, {
            expected: model.details,
            changes: { postalCode: "28001", name: "Must not save" },
          }),
        ),
      ).rejects.toMatchObject({
        code: "venue.detail_locked",
        params: { field: "postalCode", reason: "geography_context" },
      });
      expect((await read()).details.name).toBe("Sala principal");
      const saved = await withTransaction(suite.db, (tx) =>
        writeVenueDetails(tx, venue.cfg, {
          expected: model.details,
          changes: { name: "Allowed display correction" },
        }),
      );
      expect(saved.model.details.name).toBe("Allowed display correction");
    },
  );
  it("keeps a malformed saved cutover visible and accepts its eligible correction", async () => {
    await suite.db.execute(
      sql`update locations set day_cutover = '06:00garbage' where id = ${venue.cfg.locationId}`,
    );
    const model = await read();
    expect(model.details.dayCutover).toBe("06:00garbage");
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: model.details,
        changes: { dayCutover: "06:00" },
      }),
    );
    expect(saved.changed).toBe(true);
    expect(
      suite.db.all(sql`select day_cutover from locations where id = ${venue.cfg.locationId}`),
    ).toEqual([{ day_cutover: "06:00:00" }]);
  });
});

it("refuses a changed cutover that empties an offset placement and rolls back other details", async () => {
  const initial = await read();
  await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, venue.cfg, {
      name: "Offset clock department",
      defaultServiceMode: "prepay",
    });
    const menu = (await tx.execute<{ id: string }>(sql`select id from catalogues limit 1`)).rows[0]!
      .id;
    const period = await saveMenuPeriod(tx, venue.cfg, department.id, {
      name: "Lunch",
      menuId: menu,
      staffMenuIds: [],
      endOffsetMinutes: -119,
    });
    await replaceMenuWeek(
      tx,
      venue.cfg,
      department.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: period.id, startsAt: "12:00", endsAt: "14:00" }],
      })),
      new Date(),
    );
  });
  await expect(
    withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, venue.cfg, {
        expected: initial.details,
        changes: { dayCutover: "13:00", name: "Must roll back" },
      }),
    ),
  ).rejects.toMatchObject({
    code: "venue.detail_invalid",
    params: { field: "dayCutover", reason: "end_offset" },
  });
  const app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
  const { rows } = await suite.db.execute<{ id: string }>(
    sql`select id from persons where role = 'manager' limit 1`,
  );
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: rows[0]!.id }),
  );
  const response = await app.request("/management-api/venue-details", {
    method: "PATCH",
    headers: {
      cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      expected: initial.details,
      changes: { dayCutover: "13:00", name: "Must roll back" },
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "venue.detail_invalid", params: { field: "dayCutover", reason: "end_offset" } },
  });
  expect((await read()).details).toEqual(initial.details);
});
