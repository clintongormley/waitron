import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import {
  createAdjustmentReason,
  deactivateAdjustmentReason,
  listAdjustmentReasons,
} from "./operations.js";
import { ADJUSTMENTS_PROVISIONING } from "./provisioning.js";
import { adjustmentSettings } from "./schema/settings.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function provisionedNode(invoiceLocales: string[]) {
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Venue", invoiceLocales, operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  const locationId = brandLocationId(location!.id);
  return { locationId, nodeId: await seedNode(db, locationId) };
}

function reasons() {
  return withTransaction(db, (tx) => listAdjustmentReasons(tx, { includeInactive: true }));
}

describe("ADJUSTMENTS_PROVISIONING", () => {
  it("gives a new venue the nine starter reasons, in order, named in English only even where the venue's language is Spanish", async () => {
    const node = await provisionedNode(["es-ES", "en-GB"]);

    const report = await db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node));

    expect(report).toBe("default cancel reason ready");
    const seeded = await reasons();
    const every = ["staff", "supervisor", "manager", "admin"];
    const supervisorUp = ["supervisor", "manager", "admin"];
    const managerUp = ["manager", "admin"];
    expect(
      seeded.map((reason) => [
        reason.kind,
        reason.names.en,
        reason.applyRoles,
        reason.approverRoles,
        reason.maxPercentBp,
        reason.noteRequired,
      ]),
    ).toEqual([
      ["void", "Entry error", [], [], null, false],
      ["void", "Item not available", [], [], null, false],
      ["void", "Customer changed mind", [], [], null, false],
      ["void", "Not served", [], [], null, false],
      ["void", "Other", [], [], null, true],
      ["comp", "Complaint", supervisorUp, supervisorUp, null, false],
      ["comp", "On the house", managerUp, managerUp, null, false],
      ["comp", "Staff meal", every, managerUp, 5000, false],
      ["comp", "Discount", managerUp, managerUp, null, false],
    ]);
    expect(seeded.map((reason) => reason.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(seeded.map((reason) => [reason.name, reason.names])).toEqual(
      [
        "Entry error",
        "Item not available",
        "Customer changed mind",
        "Not served",
        "Other",
        "Complaint",
        "On the house",
        "Staff meal",
        "Discount",
      ].map((name) => [name, { en: name }]),
    );
    const all = ["comp", "discount_percent", "discount_amount"];
    expect(seeded.map((reason) => reason.actions)).toEqual([
      ["cancel"],
      ["cancel"],
      ["cancel"],
      ["cancel"],
      ["cancel"],
      all,
      all,
      ["discount_percent", "discount_amount"],
      all,
    ]);
    expect(seeded.every((reason) => reason.maxAmount === null && reason.active)).toBe(true);
    expect(await db.select().from(adjustmentSettings)).toEqual([]);
  });

  it("names it in English only where the venue's first invoice language is English", async () => {
    const node = await provisionedNode(["en-GB", "es-ES"]);

    await db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node));

    const seeded = await reasons();
    expect(seeded.map((reason) => reason.names)).toEqual(
      seeded.map((reason) => ({ en: reason.name })),
    );
    expect(seeded.map((reason) => reason.name)).toEqual([
      "Entry error",
      "Item not available",
      "Customer changed mind",
      "Not served",
      "Other",
      "Complaint",
      "On the house",
      "Staff meal",
      "Discount",
    ]);
  });

  it("adds nothing on a second run", async () => {
    const node = await provisionedNode(["es-ES"]);
    await db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node));

    await expect(
      db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node)),
    ).resolves.toBe("reasons already present");

    expect(await reasons()).toHaveLength(9);
  });

  it("adds nothing to a venue that already has a reason, even one switched off", async () => {
    const node = await provisionedNode(["es-ES"]);
    await withTransaction(db, async (tx) => {
      const reason = await createAdjustmentReason(tx, {
        name: "Complaint",
        names: {},
        kind: "comp",
        actions: ["comp"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: ["supervisor", "manager", "admin"],
        approverRoles: ["manager", "admin"],
        noteRequired: true,
      });
      await deactivateAdjustmentReason(tx, reason.id);
    });

    await db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node));

    expect((await reasons()).map((reason) => reason.name)).toEqual(["Complaint"]);
  });
});
