/** The adjustment reasons seed, against a database every module set has migrated. */

import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { seedAdjustmentReasons } from "./seed-adjustments.js";

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
  it("seeds the owner's seven example reasons, in order, named in the seed's language", async () => {
    const reasons = await withTransaction(suite.db, async (tx) => {
      await seedAdjustmentReasons(tx, { locale: "es" });
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
      await seedAdjustmentReasons(tx, { locale: "en" });
      await seedAdjustmentReasons(tx, { locale: "en" });
      return listAdjustmentReasons(tx, { includeInactive: true });
    });
    expect(reasons.map((reason) => reason.name)).toEqual(ENGLISH);
  });

  it("keeps every cancel-only reason free of approval and every reduction under a limit", async () => {
    const reasons = await withTransaction(suite.db, async (tx) => {
      await seedAdjustmentReasons(tx, { locale: "en" });
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
