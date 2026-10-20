import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { PersonRoleValue } from "@waitron/identity";
import { decimal } from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import {
  createAdjustmentReason,
  deleteAdjustmentReason,
  findAdjustmentReason,
  listAdjustmentReasons,
  readAdjustmentReasonDeleteImpact,
  reorderAdjustmentReasons,
  updateAdjustmentReason,
  type AdjustmentReasonInput,
} from "./operations.js";
import { policySnapshotOf } from "./policy.js";
import { recordAdjustment } from "./record.js";
import { seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const MISSING = "00000000-0000-4000-8000-00000000dead";

function complaint(overrides: Partial<AdjustmentReasonInput> = {}): AdjustmentReasonInput {
  return {
    name: "Complaint",
    names: { en: "Complaint", es: "Complaint (es)" },
    kind: "comp",
    actions: ["comp", "discount_percent"],
    maxPercentBp: null,
    maxAmount: decimal("30.00"),
    applyRoles: ["supervisor", "manager", "admin"],
    approverRoles: ["manager", "admin"],
    noteRequired: true,
    ...overrides,
  };
}

function voidReason(overrides: Partial<AdjustmentReasonInput> = {}): AdjustmentReasonInput {
  return {
    name: "Other",
    names: { en: "Other", es: "Other (es)" },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    noteRequired: true,
    ...overrides,
  };
}

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

describe("adjustment reason operations", () => {
  it("creates, updates, reorders and deletes reasons, and lists what each step left", async () => {
    const created = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    expect(created).toEqual({
      id: expect.any(String),
      name: "Complaint",
      names: { en: "Complaint", es: "Complaint (es)" },
      kind: "comp",
      actions: ["comp", "discount_percent"],
      maxPercentBp: null,
      maxAmount: "30.00",
      applyRoles: ["supervisor", "manager", "admin"],
      approverRoles: ["manager", "admin"],
      noteRequired: true,
      position: 0,
    });
    const error = await inTx((tx) =>
      createAdjustmentReason(
        tx,
        voidReason({ name: "  Entry error  ", names: {}, noteRequired: false }),
      ),
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
          applyRoles: ["manager", "admin"],
          approverRoles: ["admin"],
          noteRequired: false,
        }),
      ),
    );
    expect(updated).toEqual({
      id: created.id,
      name: "Guest complaint",
      names: { en: "Guest complaint" },
      kind: "comp",
      actions: ["comp"],
      maxPercentBp: null,
      maxAmount: "45.50",
      applyRoles: ["manager", "admin"],
      approverRoles: ["admin"],
      noteRequired: false,
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

    await inTx((tx) => deleteAdjustmentReason(tx, created.id));
    expect((await inTx((tx) => listAdjustmentReasons(tx))).map((r) => r.name)).toEqual([
      "Entry error",
    ]);
  });

  it("deletes a reason that past adjustments name, leaving them as they were", async () => {
    const reason = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    const workingOrderId = await seedWorkingOrder(db);
    const adjustmentId = await inTx((tx) =>
      recordAdjustment(tx, {
        workingOrderId,
        line: {
          id: randomUUID(),
          name: "Burger",
          quantity: "1",
          listUnitPriceGross: decimal("12.00"),
          creditedTo: null,
          stage: "served",
        },
        quantity: "1",
        reason: { id: reason.id, name: reason.name, policy: policySnapshotOf(reason) },
        action: "comp",
        percentBp: null,
        beforeAmount: decimal("12.00"),
        afterAmount: decimal("0.00"),
        reduction: decimal("12.00"),
        nominalValue: decimal("12.00"),
        requestedBy: randomUUID(),
        approvedBy: null,
        note: "Cold",
      }),
    );
    const recorded = sql`select id, reason_id, reason_name from adjustments`;
    const before = (await db.execute(recorded)).rows;
    expect(before).toEqual([{ id: adjustmentId, reason_id: reason.id, reason_name: "Complaint" }]);

    await inTx((tx) => deleteAdjustmentReason(tx, reason.id));

    expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([]);
    await expect(inTx((tx) => findAdjustmentReason(tx, reason.id))).rejects.toMatchObject({
      code: "adjustment_reason.not_found",
    });
    expect((await db.execute(recorded)).rows).toEqual(before);
  });

  it("refuses a name another reason holds, and frees it once that reason is deleted", async () => {
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

    await inTx((tx) => deleteAdjustmentReason(tx, first.id));
    const again = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    expect(again.name).toBe("Complaint");
  });

  it("refuses an id that names no reason", async () => {
    await expect(
      inTx((tx) => updateAdjustmentReason(tx, MISSING, complaint())),
    ).rejects.toMatchObject({ code: "adjustment_reason.not_found", params: { reasonId: MISSING } });
    await expect(inTx((tx) => deleteAdjustmentReason(tx, MISSING))).rejects.toMatchObject({
      code: "adjustment_reason.not_found",
    });
  });

  it("reorders only the full list of reasons, each named once", async () => {
    const a = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "A" })));
    const b = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "B" })));
    const gone = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "Gone" })));
    await inTx((tx) => deleteAdjustmentReason(tx, gone.id));

    await expect(inTx((tx) => reorderAdjustmentReasons(tx, [a.id]))).rejects.toMatchObject({
      code: "adjustment_reason.invalid",
      params: { field: "ids" },
    });
    await expect(inTx((tx) => reorderAdjustmentReasons(tx, [a.id, a.id]))).rejects.toMatchObject({
      code: "adjustment_reason.invalid",
      params: { field: "ids" },
    });
    await expect(
      inTx((tx) => reorderAdjustmentReasons(tx, [b.id, a.id, gone.id])),
    ).rejects.toMatchObject({ code: "adjustment_reason.not_found", params: { reasonId: gone.id } });
    await expect(inTx((tx) => reorderAdjustmentReasons(tx, [b.id, MISSING]))).rejects.toMatchObject(
      { code: "adjustment_reason.not_found", params: { reasonId: MISSING } },
    );

    await inTx((tx) => reorderAdjustmentReasons(tx, [b.id, a.id]));
    expect((await inTx((tx) => listAdjustmentReasons(tx))).map((r) => r.name)).toEqual(["B", "A"]);
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
    ["actions", { actions: ["cancel"] }],
    ["actions", { actions: ["discount_amount", "cancel"] }],
    ["applyRoles", { applyRoles: [] }],
    ["applyRoles", { applyRoles: ["staff", "staff"] }],
    ["applyRoles", { applyRoles: ["chef" as PersonRoleValue] }],
    ["approverRoles", { approverRoles: [] }],
    ["approverRoles", { approverRoles: ["manager", "manager"] }],
    ["approverRoles", { approverRoles: ["owner" as PersonRoleValue] }],
    ["maxPercentBp", { actions: ["comp"], maxPercentBp: 5000 }],
    ["maxPercentBp", { actions: ["discount_percent", "comp"], maxPercentBp: 9999 }],
  ])("refuses a Comp reason whose %s is out of bounds (%o)", async (field, overrides) => {
    await expect(
      inTx((tx) => createAdjustmentReason(tx, complaint(overrides))),
    ).rejects.toMatchObject({ code: "adjustment_reason.invalid", params: { field } });
    const reason = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "Valid" })));
    await expect(
      inTx((tx) => updateAdjustmentReason(tx, reason.id, complaint(overrides))),
    ).rejects.toMatchObject({ code: "adjustment_reason.invalid", params: { field } });
  });

  it.each<[string, Partial<AdjustmentReasonInput>]>([
    ["actions", { actions: [] }],
    ["actions", { actions: ["comp"] }],
    ["actions", { actions: ["cancel", "comp"] }],
    ["actions", { actions: ["cancel", "cancel"] }],
    ["applyRoles", { applyRoles: ["staff"] }],
    ["approverRoles", { approverRoles: ["manager"] }],
    ["maxPercentBp", { maxPercentBp: 5000 }],
    ["maxAmount", { maxAmount: decimal("10.00") }],
  ])("refuses a Void reason whose %s it cannot hold (%o)", async (field, overrides) => {
    await expect(
      inTx((tx) => createAdjustmentReason(tx, voidReason(overrides))),
    ).rejects.toMatchObject({ code: "adjustment_reason.invalid", params: { field } });
    const reason = await inTx((tx) => createAdjustmentReason(tx, voidReason({ name: "Valid" })));
    await expect(
      inTx((tx) => updateAdjustmentReason(tx, reason.id, voidReason(overrides))),
    ).rejects.toMatchObject({ code: "adjustment_reason.invalid", params: { field } });
  });

  it("creates a Void reason and a Comp reason and reads each back in its own shape", async () => {
    const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
    const staffMeal = await inTx((tx) =>
      createAdjustmentReason(
        tx,
        complaint({
          name: "Staff meal",
          names: { en: "Staff meal" },
          actions: ["discount_percent"],
          maxPercentBp: 5000,
          maxAmount: null,
          applyRoles: ["staff"],
          approverRoles: ["supervisor", "manager"],
          noteRequired: false,
        }),
      ),
    );
    expect(await inTx((tx) => findAdjustmentReason(tx, other.id))).toEqual({
      id: other.id,
      name: "Other",
      names: { en: "Other", es: "Other (es)" },
      kind: "void",
      actions: ["cancel"],
      maxPercentBp: null,
      maxAmount: null,
      applyRoles: [],
      approverRoles: [],
      noteRequired: true,
      position: 0,
    });
    expect(await inTx((tx) => findAdjustmentReason(tx, staffMeal.id))).toEqual({
      id: staffMeal.id,
      name: "Staff meal",
      names: { en: "Staff meal" },
      kind: "comp",
      actions: ["discount_percent"],
      maxPercentBp: 5000,
      maxAmount: null,
      applyRoles: ["staff"],
      approverRoles: ["supervisor", "manager"],
      noteRequired: false,
      position: 1,
    });
    // Free under a full item limit is a Comp reason's to offer.
    await inTx((tx) =>
      updateAdjustmentReason(
        tx,
        staffMeal.id,
        complaint({ actions: ["comp"], maxPercentBp: 10000 }),
      ),
    );
  });

  describe("keeping a Void reason", () => {
    it("refuses to delete the last Void reason, and keeps it", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      await inTx((tx) => createAdjustmentReason(tx, complaint()));
      const retired = await inTx((tx) =>
        createAdjustmentReason(tx, voidReason({ name: "Retired" })),
      );
      await inTx((tx) => deleteAdjustmentReason(tx, retired.id));

      await expect(inTx((tx) => deleteAdjustmentReason(tx, other.id))).rejects.toMatchObject({
        code: "adjustment_reason.void_required",
        params: { withNote: false },
      });
      expect(await inTx((tx) => findAdjustmentReason(tx, other.id))).toEqual(other);
    });

    it("refuses to turn the last Void reason into a Comp", async () => {
      const other = await inTx((tx) =>
        createAdjustmentReason(tx, voidReason({ noteRequired: false })),
      );
      await expect(
        inTx((tx) => updateAdjustmentReason(tx, other.id, complaint({ name: "Other" }))),
      ).rejects.toMatchObject({
        code: "adjustment_reason.void_required",
        params: { withNote: false },
      });
      expect(await inTx((tx) => findAdjustmentReason(tx, other.id))).toEqual(other);
    });

    it("refuses to switch the note off on the last Void reason that asks for one, and allows it once another Void reason asks for a note", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      await inTx((tx) =>
        createAdjustmentReason(tx, voidReason({ name: "Mistake", noteRequired: false })),
      );

      await expect(
        inTx((tx) => updateAdjustmentReason(tx, other.id, voidReason({ noteRequired: false }))),
      ).rejects.toMatchObject({
        code: "adjustment_reason.void_required",
        params: { withNote: true },
      });
      expect(await inTx((tx) => findAdjustmentReason(tx, other.id))).toEqual(other);

      await inTx((tx) => createAdjustmentReason(tx, voidReason({ name: "Wrong table" })));
      expect(
        await inTx((tx) =>
          updateAdjustmentReason(tx, other.id, voidReason({ noteRequired: false })),
        ),
      ).toMatchObject({ id: other.id, noteRequired: false });
    });

    it("refuses to delete the last Void reason that asks for a note while one that does not stays", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      await inTx((tx) =>
        createAdjustmentReason(tx, voidReason({ name: "Mistake", noteRequired: false })),
      );
      await expect(inTx((tx) => deleteAdjustmentReason(tx, other.id))).rejects.toMatchObject({
        code: "adjustment_reason.void_required",
        params: { withNote: true },
      });
      expect(await inTx((tx) => findAdjustmentReason(tx, other.id))).toEqual(other);
    });

    it("allows Other to be deleted while another Void reason asks for a note", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      const wrongTable = await inTx((tx) =>
        createAdjustmentReason(tx, voidReason({ name: "Wrong table" })),
      );
      await inTx((tx) => deleteAdjustmentReason(tx, other.id));
      expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([wrongTable]);
    });

    it("edits the last Void reason while it stays a Void reason asking for a note", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      expect(
        await inTx((tx) =>
          updateAdjustmentReason(tx, other.id, voidReason({ name: "Anything else" })),
        ),
      ).toMatchObject({ id: other.id, name: "Anything else", kind: "void", noteRequired: true });
    });

    it("edits and deletes Comp reasons in a venue holding no Void reason", async () => {
      const reason = await inTx((tx) => createAdjustmentReason(tx, complaint()));
      await inTx((tx) => updateAdjustmentReason(tx, reason.id, complaint({ noteRequired: false })));
      await inTx((tx) => deleteAdjustmentReason(tx, reason.id));
      expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([]);
    });
  });

  it("reads what deleting a reason would do", async () => {
    const comp = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));

    expect(await inTx((tx) => readAdjustmentReasonDeleteImpact(tx, comp.id))).toEqual({
      target: { id: comp.id, name: "Complaint" },
      refusals: [],
      ends: [],
      removes: [],
    });
    expect(await inTx((tx) => readAdjustmentReasonDeleteImpact(tx, other.id))).toEqual({
      target: { id: other.id, name: "Other" },
      refusals: [{ code: "adjustment_reason.void_required", params: { withNote: 0 }, targets: [] }],
      ends: [],
      removes: [],
    });

    await inTx((tx) =>
      createAdjustmentReason(tx, voidReason({ name: "Mistake", noteRequired: false })),
    );
    expect(await inTx((tx) => readAdjustmentReasonDeleteImpact(tx, other.id))).toEqual({
      target: { id: other.id, name: "Other" },
      refusals: [{ code: "adjustment_reason.void_required", params: { withNote: 1 }, targets: [] }],
      ends: [],
      removes: [],
    });

    await expect(inTx((tx) => readAdjustmentReasonDeleteImpact(tx, MISSING))).rejects.toMatchObject(
      {
        code: "adjustment_reason.not_found",
        params: { reasonId: MISSING },
      },
    );
  });

  it("refuses a name keyed by something that is not a language, on create and on update", async () => {
    const names = { en: "Complaint", "not a language": "Complaint (es)" };
    await expect(
      inTx((tx) => createAdjustmentReason(tx, complaint({ names }))),
    ).rejects.toMatchObject({ code: "adjustment_reason.invalid", params: { field: "names" } });
    const reason = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    await expect(
      inTx((tx) => updateAdjustmentReason(tx, reason.id, complaint({ names }))),
    ).rejects.toMatchObject({ code: "adjustment_reason.invalid", params: { field: "names" } });
    expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([reason]);
  });

  it("stores no name in a language left blank", async () => {
    const created = await inTx((tx) =>
      createAdjustmentReason(tx, complaint({ names: { en: "Complaint", es: "   ", ca: "" } })),
    );
    expect(created.names).toEqual({ en: "Complaint" });
    const updated = await inTx((tx) =>
      updateAdjustmentReason(
        tx,
        created.id,
        complaint({ names: { en: " ", es: "Complaint (es)" } }),
      ),
    );
    expect(updated.names).toEqual({ es: "Complaint (es)" });
  });

  it("reads one reason by its id, and refuses an id that names none", async () => {
    const reason = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "Read" })));

    expect(await inTx((tx) => findAdjustmentReason(tx, reason.id))).toEqual(reason);
    await expect(inTx((tx) => findAdjustmentReason(tx, MISSING))).rejects.toMatchObject({
      code: "adjustment_reason.not_found",
      params: { reasonId: MISSING },
    });
  });
});
