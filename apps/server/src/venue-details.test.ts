import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { VenueDetailPatch, VenueDetailWrite } from "./venue-detail-types.js";
import { recordDailyClose, businessDayStart } from "@waitron/reporting";
import { createOpenOrder } from "./working-order.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { recordTillSale } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import { deviceRequestCfg } from "./testing/session-device.js";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
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
      sql`select operation_description, order_flow, fiscal_territory from locations where id = ${venue.cfg.locationId}`,
    );
    expect(rows.rows).toEqual([
      {
        operation_description: "Venta en establecimiento",
        order_flow: "ticket_then_pay",
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
  });
  it("locks province and clock after a real locally recorded sale", async () => {
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const clock: TrustedClock = {
      now: () => ({
        instant: new Date("2026-10-06T12:00:00Z"),
        offsetMinutes: 120,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      }),
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
    await recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId: offers.zoneId,
      lines: [{ menuItemId: offers.offerFor(venue.cafeId), quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });
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
