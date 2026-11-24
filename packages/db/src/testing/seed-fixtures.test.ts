import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { persons } from "../schema/identity/persons.js";
import { parties } from "../schema/parties.js";
import { printers } from "../schema/printers.js";
import { invoiceSeries } from "../schema/series.js";
import { partyAllergyGuests } from "../schema/venue-service/party-allergy.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import {
  advanceSeriesTo,
  clearPartyAllergyForTest,
  holdPrinterForTest,
  readPrinterHoldsForTest,
  seedActivityActor,
  seedDevice,
  seedInvoiceNumber,
  seedNode,
  seedPerson,
  seedVenueSettings,
  seriesWithNextNumber,
  withInvoiceNumberCollision,
  withInvoiceSeriesGuardDropped,
} from "./seed.js";
import { useVenueDb } from "./venue-db.js";

// Apart from seed.test.ts, whose own cleanup deletes nodes, which the invoice series and the
// undeletable sales rows these cases write point to.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

describe("advanceSeriesTo", () => {
  it("numbers every live series of the named node up to the given next number, and no other", async () => {
    const db = suite.db;
    const nodeId = await seedNode(db);
    const otherNodeId = await seedNode(db);
    const ids = await db
      .insert(invoiceSeries)
      .values([
        { nodeId, code: "R" },
        { nodeId, code: "F", purpose: "full" },
        { nodeId, code: "OLD", retiredAt: new Date("2026-10-01T09:00:00.000Z") },
        { nodeId: otherNodeId, code: "R" },
      ])
      .returning({ id: invoiceSeries.id });
    await advanceSeriesTo(db, nodeId, 7);
    const next = await db
      .select({ id: seriesWithNextNumber.id, nextNumber: seriesWithNextNumber.nextNumber })
      .from(invoiceSeries);
    expect(new Map(next.map((row) => [row.id, row.nextNumber]))).toEqual(
      new Map([
        [ids[0]!.id, 7],
        [ids[1]!.id, 7],
        [ids[2]!.id, 1],
        [ids[3]!.id, 1],
      ]),
    );
  });
});

describe("withInvoiceNumberCollision", () => {
  async function liveSeries(db: Database) {
    const nodeId = await seedNode(db);
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "R" })
      .returning({ seriesId: invoiceSeries.id });
    return { nodeId, seriesId: series!.seriesId };
  }
  const collisionTrigger = (db: Database) =>
    db.all(sql`select name from sqlite_schema where name = 'invoice_number_collision'`);

  it("makes SQLite's unique invoice-number key refuse a sale inserted inside it, then removes itself", async () => {
    const db = suite.db;
    const series = await liveSeries(db);
    let refusal: unknown;
    try {
      await withInvoiceNumberCollision(db, () => seedInvoiceNumber(db, series, 1));
    } catch (caught) {
      refusal = caught;
    }
    expect(
      refusalOn(refusal, UNIQUE_VIOLATION, {
        table: "sales",
        columns: ["series_id", "invoice_number"],
      }),
    ).toBe(true);
    expect(collisionTrigger(db)).toEqual([]);
    expect(db.all(sql`select count(*) as n from sales`)).toEqual([{ n: 0 }]);
    await seedInvoiceNumber(db, series, 1);
    expect(db.all(sql`select invoice_number from sales`)).toEqual([{ invoice_number: 1 }]);
  });

  it("returns the callback's value and removes itself when the callback succeeds", async () => {
    const db = suite.db;
    expect(await withInvoiceNumberCollision(db, () => Promise.resolve("issued"))).toBe("issued");
    expect(collisionTrigger(db)).toEqual([]);
  });
});

describe("withInvoiceSeriesGuardDropped", () => {
  const renameRefusal = "invoice_series: only retired_at may be set, once";
  async function seriesId(db: Database) {
    const nodeId = await seedNode(db);
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "R" })
      .returning({ id: invoiceSeries.id });
    return series!.id;
  }
  async function rename(db: Database, id: string, code: string) {
    await db.update(invoiceSeries).set({ code }).where(eq(invoiceSeries.id, id));
  }
  async function renameRefused(db: Database, id: string) {
    let error: unknown;
    try {
      await rename(db, id, "Z");
    } catch (caught) {
      error = caught;
    }
    expect(triggerRaised(error, renameRefusal)).toBe(true);
  }

  it("lets a change the series guard refuses go through inside it, and puts the guard back", async () => {
    const db = suite.db;
    const id = await seriesId(db);
    await renameRefused(db, id);
    await withInvoiceSeriesGuardDropped(db, () => rename(db, id, "S"));
    const [row] = await db
      .select({ code: invoiceSeries.code })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, id));
    expect(row).toEqual({ code: "S" });
    await renameRefused(db, id);
  });

  it("puts the guard back when the change throws", async () => {
    const db = suite.db;
    const id = await seriesId(db);
    await expect(
      withInvoiceSeriesGuardDropped(db, () => Promise.reject(new Error("corruption failed"))),
    ).rejects.toThrow("corruption failed");
    await renameRefused(db, id);
  });
});

describe("seedActivityActor", () => {
  it("seeds one fixed person who acts on no device and authorises their own action", async () => {
    const db = suite.db;
    const actor = await seedActivityActor(db);
    expect(actor).toEqual({
      personId: "test-activity-person",
      deviceId: null,
      authorizedBy: "test-activity-person",
    });
    expect(await seedActivityActor(db)).toEqual(actor);
    expect(
      await db
        .select({ id: persons.id, displayName: persons.displayName })
        .from(persons)
        .where(eq(persons.id, actor.personId)),
    ).toEqual([{ id: "test-activity-person", displayName: "Today actor" }]);
  });
});

describe("clearPartyAllergyForTest", () => {
  it("removes the party's allergy guests and its answer, leaving another party's alone", async () => {
    const db = suite.db;
    const personId = await seedPerson(db);
    const at = "2026-10-16T09:00:00.000Z";
    const answered = {
      openedBy: personId,
      allergyAnswer: "allergies" as const,
      allergyAnsweredBy: personId,
      allergyAnsweredAt: at,
    };
    const [party, other] = await db
      .insert(parties)
      .values([answered, answered])
      .returning({ id: parties.id });
    await db.insert(partyAllergyGuests).values(
      [party!.id, other!.id].map((partyId) => ({
        partyId,
        position: 0,
        who: "Guest 1",
        allergens: { gluten: {} },
      })),
    );
    await clearPartyAllergyForTest(db, party!.id);
    const answers = await db
      .select({
        id: parties.id,
        allergyAnswer: parties.allergyAnswer,
        allergyAnsweredBy: parties.allergyAnsweredBy,
        allergyAnsweredAt: parties.allergyAnsweredAt,
      })
      .from(parties);
    expect(new Map(answers.map(({ id, ...answer }) => [id, answer]))).toEqual(
      new Map([
        [party!.id, { allergyAnswer: null, allergyAnsweredBy: null, allergyAnsweredAt: null }],
        [
          other!.id,
          { allergyAnswer: "allergies", allergyAnsweredBy: personId, allergyAnsweredAt: at },
        ],
      ]),
    );
    expect(
      await db.select({ partyId: partyAllergyGuests.partyId }).from(partyAllergyGuests),
    ).toEqual([{ partyId: other!.id }]);
  });
});

describe("holdPrinterForTest and readPrinterHoldsForTest", () => {
  it("marks one printer held by the device now, and reads back only held printers in id order", async () => {
    const db = suite.db;
    await seedVenueSettings(db);
    const { deviceId } = await seedDevice(db);
    const ids = (
      await db
        .insert(printers)
        .values(
          ["printer-b", "printer-a", "printer-c"].map((id, i) => ({
            id,
            name: id,
            transport: "network_tcp" as const,
            host: `10.0.0.${i + 2}`,
            portable: true,
          })),
        )
        .returning({ id: printers.id })
    ).map(({ id }) => id);
    expect(await readPrinterHoldsForTest(db)).toEqual([]);
    const before = Date.now();
    await holdPrinterForTest(db, ids[0]!, deviceId);
    await holdPrinterForTest(db, ids[1]!, deviceId);
    const holds = await readPrinterHoldsForTest(db);
    expect(holds.map(({ printerId, deviceId: holder }) => ({ printerId, holder }))).toEqual([
      { printerId: "printer-a", holder: deviceId },
      { printerId: "printer-b", holder: deviceId },
    ]);
    for (const { heldAt } of holds) {
      expect(Date.parse(heldAt!)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(heldAt!)).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });
});
