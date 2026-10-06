/** The adjustment reasons seed, against a database every module set has migrated. */

import { describe, expect, it } from "vitest";
import { locations, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ADJUSTMENTS_PROVISIONING, listAdjustmentReasons } from "@waitron/adjustments";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { seedAdjustmentReasons } from "./seed-adjustments.js";
import { CASA_DELGADO_ES } from "./data-sets/casa-delgado-es.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const ENGLISH = [
  "Entry error",
  "Changed mind",
  "Unavailable item",
  "Complaint",
  "Friends and family",
  "Employee discount",
  "Manager special",
];

describe("seedAdjustmentReasons", () => {
  it.each([
    ["es", "es-ES"],
    ["en", "en-GB"],
  ] as const)(
    "does not repeat the cancel reason provisioning gave a %s venue",
    async (locale, invoiceLocale) => {
      await seedTenant(suite.db);
      const [location] = await suite.db
        .insert(locations)
        .values({ name: "Venue", invoiceLocales: [invoiceLocale], operationDescription: "Demo" })
        .returning({ id: locations.id });
      const locationId = brandLocationId(location!.id);
      const node = { locationId, nodeId: await seedNode(suite.db, locationId) };
      const reasons = await withTransaction(suite.db, async (tx) => {
        await ADJUSTMENTS_PROVISIONING.seed!.run(tx, node);
        await seedAdjustmentReasons(tx, {
          locale,
          dataSet: CASA_DELGADO_ES,
          languages: locale === "en" ? ["en", "es"] : ["es", "en"],
        });
        return listAdjustmentReasons(tx, { includeInactive: true });
      });
      expect(reasons.map((reason) => reason.names.en)).toEqual(ENGLISH);
    },
  );

  it("seeds the owner's seven example reasons, in order, named in the seed's language", async () => {
    const reasons = await withTransaction(suite.db, async (tx) => {
      await seedAdjustmentReasons(tx, {
        locale: "es",
        dataSet: CASA_DELGADO_ES,
        languages: ["es", "en"],
      });
      return listAdjustmentReasons(tx);
    });
    expect(reasons.map((reason) => reason.names.en)).toEqual(ENGLISH);
    expect(reasons.map((reason) => reason.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const reason of reasons) {
      expect(reason.name).toBe(reason.names.es);
      expect(reason.names.es).not.toBe(reason.names.en);
    }
    expect(reasons.find((reason) => reason.names.en === "Complaint")).toMatchObject({
      actions: ["comp", "discount_percent"],
      maxPercentBp: 5000,
      maxAmount: "30.00",
      applyRole: "supervisor",
      approverRole: "manager",
      noteRequired: true,
    });
  });

  it("names each reason in English for an English seed, and adds nothing on a second run", async () => {
    const reasons = await withTransaction(suite.db, async (tx) => {
      await seedAdjustmentReasons(tx, {
        locale: "en",
        dataSet: CASA_DELGADO_ES,
        languages: ["en", "es"],
      });
      await seedAdjustmentReasons(tx, {
        locale: "en",
        dataSet: CASA_DELGADO_ES,
        languages: ["en", "es"],
      });
      return listAdjustmentReasons(tx, { includeInactive: true });
    });
    expect(reasons.map((reason) => reason.name)).toEqual(ENGLISH);
  });

  it("keeps every cancel-only reason free of approval and every reduction under a limit", async () => {
    const reasons = await withTransaction(suite.db, async (tx) => {
      await seedAdjustmentReasons(tx, {
        locale: "en",
        dataSet: CASA_DELGADO_ES,
        languages: ["en", "es"],
      });
      return listAdjustmentReasons(tx);
    });
    for (const reason of reasons) {
      if (reason.actions.every((action) => action === "cancel")) {
        expect(reason.applyRole, reason.name).toBe("staff");
      } else {
        expect(reason.maxAmount, reason.name).not.toBeNull();
      }
    }
  });
});
