import { dirname } from "node:path";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoiceSeries, sales, workingOrderLines } from "@waitron/db";
import { seedNode, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import { checkEmergencyCopy } from "./handover-emergency-check.js";

const faults = vi.hoisted(() => ({ activity: false }));
vi.mock("@waitron/store", async (original) => {
  const real = await original<typeof import("@waitron/store")>();
  return {
    ...real,
    openBackupQuery: async (path: string) => {
      const opened = await real.openBackupQuery(path);
      return {
        ...opened,
        query: {
          async *rows(statement: string) {
            if (faults.activity && statement.includes("working_orders"))
              throw new Error("activity unavailable");
            yield* opened.query.rows(statement);
          },
        },
      };
    },
  };
});
const venue = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
beforeEach(async () => {
  await seedVenue(venue.db, { invoiceLocales: ["en"] });
});
const venueDir = () => dirname(venue.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file);
afterEach(() => {
  faults.activity = false;
});

it("checks an empty copy and records no dated activity", async () => {
  expect(await checkEmergencyCopy({ venueDir: venueDir(), modules: [] })).toEqual({
    source: "mirror-copy",
    identifier: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    lastChangeAtMs: null,
  });
});

it.each(["openedAt", "settledAt", "collectedAt", "paymentAttemptAt"] as const)(
  "includes %s and compares instants rather than timestamp spellings",
  async (field) => {
    await seedWorkingOrder(venue.db, { openedAt: "2026-11-11T10:30:00+01:00" });
    await seedWorkingOrder(venue.db, {
      openedAt: "2026-11-11T08:00:00Z",
      [field]: "2026-11-11T10:00:00Z",
      ...(field === "settledAt" ? { status: "settled" as const } : {}),
    });
    expect((await checkEmergencyCopy({ venueDir: venueDir(), modules: [] })).lastChangeAtMs).toBe(
      1794391200000,
    );
  },
);

it.each(["sentAt", "servedAt"] as const)("includes line %s", async (field) => {
  const order = await seedWorkingOrder(venue.db, { openedAt: "2026-11-11T08:00:00Z" });
  await venue.db.insert(workingOrderLines).values({
    workingOrderId: order.id,
    lineNo: 1,
    name: "Soup",
    descriptions: { en: "Soup" },
    quantity: 1000,
    unitPriceGross: 100,
    vatClass: "general",
    lineTotal: 100,
    [field]: "2026-11-11T10:00:00Z",
  });
  expect((await checkEmergencyCopy({ venueDir: venueDir(), modules: [] })).lastChangeAtMs).toBe(
    1794391200000,
  );
});

it("refuses invalid activity rather than recording an empty interval", async () => {
  await seedWorkingOrder(venue.db, { openedAt: "not a date" });
  await expect(checkEmergencyCopy({ venueDir: venueDir(), modules: [] })).rejects.toMatchObject({
    code: "handover.copy_check_failed",
  });
});

it("includes a sale's issue time in the latest dated activity", async () => {
  const nodeId = await seedNode(venue.db);
  const [series] = await venue.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A", purpose: "standard", nextNumber: 1 })
    .returning();
  await venue.db
    .insert(sales)
    .values({
      source: "operator_script",
      seriesId: series!.id,
      nodeId,
      invoiceNumber: 1,
      issuedAt: "2026-11-11T10:00:00Z",
      issuedOffsetMinutes: 0,
      total: 100,
      vatBreakdown: [],
      locale: "en",
      invoiceLocales: ["en"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
    });
  expect((await checkEmergencyCopy({ venueDir: venueDir(), modules: [] })).lastChangeAtMs).toBe(
    1794391200000,
  );
});

it("does not turn a failed activity read into a null time", async () => {
  faults.activity = true;
  await expect(checkEmergencyCopy({ venueDir: venueDir(), modules: [] })).rejects.toThrow(
    "activity unavailable",
  );
});

it("refuses a module's broken chain", async () => {
  const module = {
    ...fakeSetlessModule("test-chain", "core"),
    handover: { summarise: async () => null, checkCopy: async () => "broken" as const },
  };
  await expect(
    checkEmergencyCopy({ venueDir: venueDir(), modules: [module] }),
  ).rejects.toMatchObject({ code: "handover.chain_broken" });
});

it("refuses damaged bytes before trying to read activity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emergency-damage-"));
  try {
    await writeFile(join(dir, "venue.db"), "damaged");
    await expect(checkEmergencyCopy({ venueDir: dir, modules: [] })).rejects.toMatchObject({
      code: "handover.copy_damaged",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
