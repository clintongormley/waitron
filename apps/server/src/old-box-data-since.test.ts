import { strFromU8, unzipSync } from "fflate";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordActivity, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedPerson } from "@waitron/identity/test/fixtures.js";
import {
  seedFiredOrder,
  seedKitchenStation,
  seedSale,
  seedVenueWithSeries,
  type SeededVenue,
} from "@waitron/reporting/test/fixtures.js";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { sinceRule, type SinceRule } from "./old-box-data-since.js";
import { buildOldBoxWorkbook } from "./old-box-data-workbook.js";
import { row } from "./testing/xlsx-rows.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const MADE_AT = new Date("2026-11-23T09:30:00.000Z");
const CUTOFF = Date.parse("2026-11-20T10:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});

function sheet(bytes: Uint8Array, name: string): string | undefined {
  const file = unzipSync(bytes)[name];
  return file === undefined ? undefined : strFromU8(file);
}

function build(since: SinceRule, language: "en" | "es" = "en") {
  return buildOldBoxWorkbook({
    db: suite.db,
    modules: [],
    mainHoldings: null,
    madeAt: MADE_AT,
    language,
    since,
  });
}

async function namedPerson(name: string): Promise<string> {
  const personId = await seedPerson(suite.db, "manager");
  await suite.db.run(sql`update persons set display_name = ${name} where id = ${personId}`);
  return personId;
}

async function signedIn(personId: string | null, atMs: number): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordActivity(tx, {
      kind: "dashboard.signed_in",
      subjectId: personId ?? "00000000-0000-4000-8000-000000000001",
      personId,
      data: { method: "password" },
      at: new Date(atMs),
    }),
  );
}

describe("the old box's since rule", () => {
  it("takes the cutoff 10 minutes before the copy's latest change when the main box sent one", async () => {
    expect(await sinceRule(suite.db, { lastChangeAtMs: CUTOFF })).toEqual({
      kind: "copy",
      fromMs: CUTOFF - 10 * MINUTE,
    });
  });

  it("lists everything when the main box said the copy held no sale or order", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
    });
    expect(await sinceRule(suite.db, { lastChangeAtMs: null })).toEqual({ kind: "all" });
  });

  it("takes 7 days before this box's own latest sale or order when no copy time was heard, and everything when this box has none", async () => {
    expect(await sinceRule(suite.db, null)).toEqual({ kind: "all" });
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
    });
    const stationId = await seedKitchenStation(suite.db, { name: "Kitchen" });
    const { orderId } = await seedFiredOrder(
      suite.db,
      { deviceId: venue.deviceId, nodeId: venue.nodeId, stationId },
      { orderNumber: 1, ageMinutes: 0 },
    );
    await suite.db.run(
      sql`update working_orders set opened_at = '2026-11-19T08:00:00.000Z' where id = ${orderId}`,
    );
    await suite.db.run(
      sql`update working_order_lines set sent_at = '2026-11-21T12:00:00.000Z' where working_order_id = ${orderId}`,
    );
    expect(await sinceRule(suite.db, null)).toEqual({
      kind: "own",
      fromMs: Date.parse("2026-11-21T12:00:00.000Z") - 7 * DAY,
    });
  });
});

describe("the old box's Activity tab", () => {
  // Seeding the venue saves its settings, which the activity log records at the real time.
  beforeEach(async () => {
    await suite.db.run(sql`delete from activity_log`);
  });

  it.each(["en", "es"] as const)(
    "lists entries at the cutoff and after, not before, with the person's name and the kind's code, under the rule's first line, in %s",
    async (language) => {
      const words = OLD_BOX_DATA_WORDS[language];
      const marta = await namedPerson("Marta Ruiz");
      await signedIn(marta, CUTOFF - 1);
      await signedIn(marta, CUTOFF + 60 * MINUTE);
      await signedIn(null, CUTOFF);
      const xml = sheet(
        await build({ kind: "copy", fromMs: CUTOFF }, language),
        "xl/worksheets/sheet2.xml",
      )!;
      expect(row(xml, 1)).toEqual([words.sinceCopyIntro.replace("{time}", "2026-11-20 10:00 UTC")]);
      expect(row(xml, 2)).toEqual([...words.activityColumns]);
      expect(row(xml, 3)).toEqual([
        "2026-11-20T10:00:00.000Z",
        "dashboard.signed_in",
        "",
        "person",
        "00000000-0000-4000-8000-000000000001",
      ]);
      expect(row(xml, 4)).toEqual([
        "2026-11-20T11:00:00.000Z",
        "dashboard.signed_in",
        "Marta Ruiz",
        "person",
        marta,
      ]);
      expect(row(xml, 5)).toEqual([]);
      const names = strFromU8(
        unzipSync(await build({ kind: "all" }, language))["xl/workbook.xml"]!,
      );
      expect(names).toContain(`<sheet name="${words.activitySheet}" sheetId="2"`);
    },
  );

  it("takes the 7-day rule's first line from its own words", async () => {
    const xml = sheet(await build({ kind: "own", fromMs: CUTOFF }), "xl/worksheets/sheet2.xml")!;
    expect(row(xml, 1)).toEqual([
      OLD_BOX_DATA_WORDS.en.sinceOwnIntro.replace("{time}", "2026-11-20 10:00 UTC"),
    ]);
  });

  it("an empty Activity tab still has its first line and headings, read without a write transaction", async () => {
    const lock = vi.spyOn(suite.db, "withWriteLock");
    const transaction = vi.spyOn(suite.db, "transaction");
    const xml = sheet(await build({ kind: "all" }), "xl/worksheets/sheet2.xml")!;
    expect(await sinceRule(suite.db, null)).toEqual({ kind: "all" });
    expect(lock).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(row(xml, 1)).toEqual([OLD_BOX_DATA_WORDS.en.sinceAllIntro]);
    expect(row(xml, 2)).toEqual([...OLD_BOX_DATA_WORDS.en.activityColumns]);
    expect(row(xml, 3)).toEqual([]);
  });

  it("lists every entry under the rule that lists everything", async () => {
    await signedIn(null, CUTOFF - 365 * DAY);
    const xml = sheet(await build({ kind: "all" }), "xl/worksheets/sheet2.xml")!;
    expect(row(xml, 3)[0]).toBe(new Date(CUTOFF - 365 * DAY).toISOString());
  });
});
