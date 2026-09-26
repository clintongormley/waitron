import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import {
  createAdjustmentReason,
  deactivateAdjustmentReason,
  listAdjustmentReasons,
  reorderAdjustmentReasons,
  updateAdjustmentReason,
  type AdjustmentReasonInput,
} from "./operations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const MISSING = "00000000-0000-4000-8000-00000000dead";

function complaint(overrides: Partial<AdjustmentReasonInput> = {}): AdjustmentReasonInput {
  return {
    name: "Complaint",
    names: { en: "Complaint", es: "Queja" },
    actions: ["comp", "discount_percent"],
    maxPercentBp: 5000,
    maxAmount: decimal("30.00"),
    applyRole: "supervisor",
    approverRole: "manager",
    noteRequired: true,
    ...overrides,
  };
}

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

describe("adjustment reason operations", () => {
  it("creates, updates, reorders and deactivates reasons, and lists what each step left", async () => {
    const created = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    expect(created).toEqual({
      id: expect.any(String),
      name: "Complaint",
      names: { en: "Complaint", es: "Queja" },
      actions: ["comp", "discount_percent"],
      maxPercentBp: 5000,
      maxAmount: "30.00",
      applyRole: "supervisor",
      approverRole: "manager",
      noteRequired: true,
      active: true,
      position: 0,
    });
    const error = await inTx((tx) =>
      createAdjustmentReason(tx, {
        name: "  Entry error  ",
        names: {},
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRole: "staff",
        approverRole: "staff",
        noteRequired: false,
      }),
    );
    expect(error).toMatchObject({ name: "Entry error", position: 1, maxAmount: null });

    const updated = await inTx((tx) =>
      updateAdjustmentReason(
        tx,
        created.id,
        complaint({
          name: "Guest complaint",
          names: { en: "Guest complaint" },
          actions: ["comp"],
          maxPercentBp: null,
          maxAmount: decimal("45.50"),
          applyRole: "manager",
          approverRole: "admin",
          noteRequired: false,
        }),
      ),
    );
    expect(updated).toEqual({
      id: created.id,
      name: "Guest complaint",
      names: { en: "Guest complaint" },
      actions: ["comp"],
      maxPercentBp: null,
      maxAmount: "45.50",
      applyRole: "manager",
      approverRole: "admin",
      noteRequired: false,
      active: true,
      position: 0,
    });
    expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([updated, error]);

    await inTx((tx) => reorderAdjustmentReasons(tx, [error.id, created.id]));
    expect(
      (await inTx((tx) => listAdjustmentReasons(tx))).map((r) => [r.name, r.position]),
    ).toEqual([
      ["Entry error", 0],
      ["Guest complaint", 1],
    ]);

    await inTx((tx) => deactivateAdjustmentReason(tx, error.id));
    expect((await inTx((tx) => listAdjustmentReasons(tx))).map((r) => r.name)).toEqual([
      "Guest complaint",
    ]);
  });

  it("keeps a deactivated reason listed when asked to include inactive ones", async () => {
    const reason = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    await inTx((tx) => deactivateAdjustmentReason(tx, reason.id));
    expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([]);
    expect(await inTx((tx) => listAdjustmentReasons(tx, { includeInactive: false }))).toEqual([]);
    expect(await inTx((tx) => listAdjustmentReasons(tx, { includeInactive: true }))).toEqual([
      { ...reason, active: false },
    ]);
    // Deactivating twice changes nothing more.
    await inTx((tx) => deactivateAdjustmentReason(tx, reason.id));
    expect(await inTx((tx) => listAdjustmentReasons(tx, { includeInactive: true }))).toEqual([
      { ...reason, active: false },
    ]);
  });

  it("refuses a name another active reason holds, and frees it once that reason is deactivated", async () => {
    const first = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    await expect(
      inTx((tx) => createAdjustmentReason(tx, complaint({ name: " Complaint " }))),
    ).rejects.toMatchObject({
      code: "adjustment_reason.name_taken",
      params: { name: "Complaint" },
    });

    const other = await inTx((tx) =>
      createAdjustmentReason(tx, complaint({ name: "Unavailable" })),
    );
    await expect(
      inTx((tx) => updateAdjustmentReason(tx, other.id, complaint({ name: "Complaint" }))),
    ).rejects.toMatchObject({ code: "adjustment_reason.name_taken" });
    // A reason keeps its own name through an update.
    await inTx((tx) => updateAdjustmentReason(tx, first.id, complaint({ noteRequired: false })));

    await inTx((tx) => deactivateAdjustmentReason(tx, first.id));
    const again = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    expect(again.name).toBe("Complaint");
    // The inactive reason may be edited to a name an active one holds: only active names are unique.
    await inTx((tx) => updateAdjustmentReason(tx, first.id, complaint()));
  });

  it("refuses an id that names no reason", async () => {
    await expect(
      inTx((tx) => updateAdjustmentReason(tx, MISSING, complaint())),
    ).rejects.toMatchObject({ code: "adjustment_reason.not_found", params: { reasonId: MISSING } });
    await expect(inTx((tx) => deactivateAdjustmentReason(tx, MISSING))).rejects.toMatchObject({
      code: "adjustment_reason.not_found",
    });
  });

  it("reorders only the full list of active reasons, each named once", async () => {
    const a = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "A" })));
    const b = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "B" })));
    const gone = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "Gone" })));
    await inTx((tx) => deactivateAdjustmentReason(tx, gone.id));

    await expect(inTx((tx) => reorderAdjustmentReasons(tx, [a.id]))).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "ids" },
    });
    await expect(inTx((tx) => reorderAdjustmentReasons(tx, [a.id, a.id]))).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "ids" },
    });
    await expect(
      inTx((tx) => reorderAdjustmentReasons(tx, [b.id, a.id, gone.id])),
    ).rejects.toMatchObject({ code: "adjustment_reason.not_found", params: { reasonId: gone.id } });
    await expect(inTx((tx) => reorderAdjustmentReasons(tx, [b.id, MISSING]))).rejects.toMatchObject(
      { code: "adjustment_reason.not_found", params: { reasonId: MISSING } },
    );

    await inTx((tx) => reorderAdjustmentReasons(tx, [b.id, a.id]));
    expect(
      (await inTx((tx) => listAdjustmentReasons(tx, { includeInactive: true }))).map((r) => r.name),
    ).toEqual(["B", "A", "Gone"]);
  });

  it("renumbers inactive reasons after the reordered active ones, keeping their own order", async () => {
    const retiredFirst = await inTx((tx) =>
      createAdjustmentReason(tx, complaint({ name: "Old A" })),
    );
    const x = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "X" })));
    const retiredSecond = await inTx((tx) =>
      createAdjustmentReason(tx, complaint({ name: "Old B" })),
    );
    const y = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "Y" })));
    await inTx((tx) => deactivateAdjustmentReason(tx, retiredSecond.id));
    await inTx((tx) => deactivateAdjustmentReason(tx, retiredFirst.id));

    await inTx((tx) => reorderAdjustmentReasons(tx, [y.id, x.id]));
    expect(
      (await inTx((tx) => listAdjustmentReasons(tx, { includeInactive: true }))).map((r) => [
        r.name,
        r.position,
      ]),
    ).toEqual([
      ["Y", 0],
      ["X", 1],
      ["Old A", 2],
      ["Old B", 3],
    ]);
  });

  it.each<[string, Partial<AdjustmentReasonInput>]>([
    ["name", { name: "   " }],
    ["actions", { actions: [] }],
    ["actions", { actions: ["comp", "comp"] }],
    ["maxPercentBp", { maxPercentBp: 0 }],
    ["maxPercentBp", { maxPercentBp: 10001 }],
    ["maxPercentBp", { maxPercentBp: 12.5 }],
    ["maxAmount", { maxAmount: decimal("0.00") }],
    ["maxAmount", { maxAmount: decimal("-1.00") }],
    ["maxAmount", { maxAmount: decimal("1.005") }],
    ["approverRole", { applyRole: "manager", approverRole: "supervisor" }],
  ])("refuses a reason whose %s is out of bounds (%o)", async (field, overrides) => {
    await expect(
      inTx((tx) => createAdjustmentReason(tx, complaint(overrides))),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field } });
    const reason = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "Valid" })));
    await expect(
      inTx((tx) => updateAdjustmentReason(tx, reason.id, complaint(overrides))),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field } });
  });
});
