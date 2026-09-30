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
  it("gives a new venue one cancel reason staff use alone, named in the venue's language", async () => {
    const node = await provisionedNode(["es-ES", "en-GB"]);

    const report = await db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node));

    expect(report).toBe("default cancel reason ready");
    expect(await reasons()).toEqual([
      {
        id: expect.any(String),
        name: "Error al marcar",
        names: { en: "Entry error", es: "Error al marcar" },
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRole: "staff",
        approverRole: "supervisor",
        noteRequired: false,
        active: true,
        position: 0,
      },
    ]);
  });

  it("names it in English where the venue's first invoice language is not Spanish", async () => {
    const node = await provisionedNode(["en-GB", "es-ES"]);

    await db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node));

    expect((await reasons()).map((reason) => reason.name)).toEqual(["Entry error"]);
  });

  it("adds nothing on a second run", async () => {
    const node = await provisionedNode(["es-ES"]);
    await db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node));

    await expect(
      db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node)),
    ).resolves.toBe("reasons already present");

    expect(await reasons()).toHaveLength(1);
  });

  it("adds nothing to a venue that already has a reason, even one switched off", async () => {
    const node = await provisionedNode(["es-ES"]);
    await withTransaction(db, async (tx) => {
      const reason = await createAdjustmentReason(tx, {
        name: "Complaint",
        names: {},
        actions: ["comp"],
        maxPercentBp: null,
        maxAmount: null,
        applyRole: "supervisor",
        approverRole: "manager",
        noteRequired: true,
      });
      await deactivateAdjustmentReason(tx, reason.id);
    });

    await db.transaction((tx) => ADJUSTMENTS_PROVISIONING.seed!.run(tx, node));

    expect((await reasons()).map((reason) => reason.name)).toEqual(["Complaint"]);
  });
});
