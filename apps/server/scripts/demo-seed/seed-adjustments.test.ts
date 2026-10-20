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

const EXTRAS = ["Friends and family", "Employee discount", "Manager special"];

const ENGLISH = [
  "Entry error",
  "Item not available",
  "Customer changed mind",
  "Not served",
  "Other",
  "Complaint",
  ...EXTRAS,
];

/** The nine starter reasons provisioning gives, then the demo's reasons it lacks. */
const PROVISIONED = [
  "Entry error",
  "Item not available",
  "Customer changed mind",
  "Not served",
  "Other",
  "Complaint",
  "On the house",
  "Staff meal",
  "Discount",
  ...EXTRAS,
];

describe("seedAdjustmentReasons", () => {
  it.each([
    ["es", "es-ES"],
    ["en", "en-GB"],
  ] as const)(
    "does not repeat any reason provisioning gave a %s venue",
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
      expect(reasons.map((reason) => reason.names.en)).toEqual(PROVISIONED);
      expect(new Set(reasons.map((reason) => reason.name)).size).toBe(reasons.length);
    },
  );

  it("names a starter reason the demo lists in the demo's languages, keeping the starter's rules", async () => {
    await seedTenant(suite.db);
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["es-ES"], operationDescription: "Demo" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const node = { locationId, nodeId: await seedNode(suite.db, locationId) };
    const [before, after] = await withTransaction(suite.db, async (tx) => {
      await ADJUSTMENTS_PROVISIONING.seed!.run(tx, node);
      const provisioned = await listAdjustmentReasons(tx, { includeInactive: true });
      await seedAdjustmentReasons(tx, {
        locale: "es",
        dataSet: CASA_DELGADO_ES,
        languages: ["es", "en"],
      });
      return [provisioned, await listAdjustmentReasons(tx, { includeInactive: true })];
    });
    const demo = CASA_DELGADO_ES.adjustmentReasons.find(
      (reason) => reason.names.en === "Entry error",
    )!;
    const starter = before.find((reason) => reason.names.en === "Entry error")!;
    const seeded = after.find((reason) => reason.id === starter.id)!;
    expect(seeded.name).toBe(demo.names.es);
    expect(seeded.names).toEqual({ en: demo.names.en, es: demo.names.es });
    for (const provisioned of before) {
      const kept = after.find((reason) => reason.id === provisioned.id)!;
      expect({ ...kept, name: provisioned.name, names: provisioned.names }).toEqual(provisioned);
    }
    const onTheHouse = after.find((reason) => reason.names.en === "On the house")!;
    expect(onTheHouse.names).toEqual({ en: "On the house" });
    expect(onTheHouse.name).toBe("On the house");
  });

  it("seeds the owner's nine example reasons, in order, named in the seed's language", async () => {
    const reasons = await withTransaction(suite.db, async (tx) => {
      await seedAdjustmentReasons(tx, {
        locale: "es",
        dataSet: CASA_DELGADO_ES,
        languages: ["es", "en"],
      });
      return listAdjustmentReasons(tx);
    });
    expect(reasons.map((reason) => reason.names.en)).toEqual(ENGLISH);
    expect(reasons.map((reason) => reason.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const reason of reasons) {
      expect(reason.name).toBe(reason.names.es);
      expect(reason.names.es).not.toBe(reason.names.en);
    }
    expect(reasons.map((reason) => reason.kind)).toEqual([
      "void",
      "void",
      "void",
      "void",
      "void",
      "comp",
      "comp",
      "comp",
      "comp",
    ]);
    for (const reason of reasons) {
      if (reason.kind === "void") expect(reason.actions, reason.name).toEqual(["cancel"]);
      else {
        expect(reason.actions, reason.name).not.toContain("cancel");
        expect(reason.applyRoles.length, reason.name).toBeGreaterThan(0);
        expect(reason.approverRoles.length, reason.name).toBeGreaterThan(0);
      }
    }
    const byEnglish = (english: string) => reasons.find((reason) => reason.names.en === english);
    expect(byEnglish("Not served")).toMatchObject({ kind: "void", noteRequired: false });
    expect(byEnglish("Other")).toMatchObject({ kind: "void", noteRequired: true });
    expect(byEnglish("Complaint")).toMatchObject({
      kind: "comp",
      actions: ["comp", "discount_percent"],
      maxPercentBp: null,
      maxAmount: "30.00",
      applyRoles: ["supervisor", "manager", "admin"],
      approverRoles: ["manager", "admin"],
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

  it("keeps every Void reason free of role lists and every Comp reason under a limit", async () => {
    const reasons = await withTransaction(suite.db, async (tx) => {
      await seedAdjustmentReasons(tx, {
        locale: "en",
        dataSet: CASA_DELGADO_ES,
        languages: ["en", "es"],
      });
      return listAdjustmentReasons(tx);
    });
    for (const reason of reasons) {
      if (reason.kind === "void") {
        expect([reason.applyRoles, reason.approverRoles], reason.name).toEqual([[], []]);
      } else {
        expect(reason.maxAmount, reason.name).not.toBeNull();
      }
    }
  });
});
