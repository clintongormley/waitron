import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { PersonRoleValue } from "@waitron/identity";
import { decimal } from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import {
  createAdjustmentReason,
  deactivateAdjustmentReason,
  findAdjustmentReason,
  listAdjustmentReasons,
  reactivateAdjustmentReason,
  reorderAdjustmentReasons,
  updateAdjustmentReason,
  type AdjustmentReasonInput,
} from "./operations.js";
import { adjustmentReasons } from "./schema/reasons.js";

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
    names: { en: "Other", es: "Otro" },
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
  it("creates, updates, reorders and deactivates reasons, and lists what each step left", async () => {
    const created = await inTx((tx) => createAdjustmentReason(tx, complaint()));
    expect(created).toEqual({
      id: expect.any(String),
      name: "Complaint",
      names: { en: "Complaint", es: "Queja" },
      kind: "comp",
      actions: ["comp", "discount_percent"],
      maxPercentBp: null,
      maxAmount: "30.00",
      applyRoles: ["supervisor", "manager", "admin"],
      approverRoles: ["manager", "admin"],
      noteRequired: true,
      active: true,
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

    await inTx((tx) => deactivateAdjustmentReason(tx, created.id));
    expect((await inTx((tx) => listAdjustmentReasons(tx))).map((r) => r.name)).toEqual([
      "Entry error",
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
      names: { en: "Other", es: "Otro" },
      kind: "void",
      actions: ["cancel"],
      maxPercentBp: null,
      maxAmount: null,
      applyRoles: [],
      approverRoles: [],
      noteRequired: true,
      active: true,
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
      active: true,
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

  describe("keeping a Void reason switched on", () => {
    it("refuses to switch off the last Void reason, and leaves it on", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      await inTx((tx) => createAdjustmentReason(tx, complaint()));
      const retired = await inTx((tx) =>
        createAdjustmentReason(tx, voidReason({ name: "Retired" })),
      );
      await inTx((tx) => deactivateAdjustmentReason(tx, retired.id));

      await expect(inTx((tx) => deactivateAdjustmentReason(tx, other.id))).rejects.toMatchObject({
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

    it("refuses to switch off the last Void reason that asks for a note while one that does not stays on", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      await inTx((tx) =>
        createAdjustmentReason(tx, voidReason({ name: "Mistake", noteRequired: false })),
      );
      await expect(inTx((tx) => deactivateAdjustmentReason(tx, other.id))).rejects.toMatchObject({
        code: "adjustment_reason.void_required",
        params: { withNote: true },
      });
      expect(await inTx((tx) => findAdjustmentReason(tx, other.id))).toEqual(other);
    });

    it("allows Other to be switched off while another Void reason asks for a note", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      const wrongTable = await inTx((tx) =>
        createAdjustmentReason(tx, voidReason({ name: "Wrong table" })),
      );
      await inTx((tx) => deactivateAdjustmentReason(tx, other.id));
      expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([wrongTable]);
    });

    it("edits the last Void reason while it stays a switched-on Void reason asking for a note", async () => {
      const other = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      expect(
        await inTx((tx) =>
          updateAdjustmentReason(tx, other.id, voidReason({ name: "Anything else" })),
        ),
      ).toMatchObject({ id: other.id, name: "Anything else", kind: "void", noteRequired: true });
    });

    it("edits and switches off Comp reasons in a venue holding no Void reason", async () => {
      const reason = await inTx((tx) => createAdjustmentReason(tx, complaint()));
      await inTx((tx) => updateAdjustmentReason(tx, reason.id, complaint({ noteRequired: false })));
      await inTx((tx) => deactivateAdjustmentReason(tx, reason.id));
      expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([]);
    });

    it("lets a switched-off Void reason be edited, or switched off again, while no Void reason is on", async () => {
      const old = await inTx((tx) => createAdjustmentReason(tx, voidReason()));
      const spare = await inTx((tx) => createAdjustmentReason(tx, voidReason({ name: "Spare" })));
      await inTx((tx) => deactivateAdjustmentReason(tx, old.id));
      // A venue the guard never saw, such as one imported before it: no Void reason switched on.
      await db
        .update(adjustmentReasons)
        .set({ active: false })
        .where(eq(adjustmentReasons.id, spare.id));

      await inTx((tx) => deactivateAdjustmentReason(tx, old.id));
      expect(
        await inTx((tx) => updateAdjustmentReason(tx, old.id, complaint({ name: "Old" }))),
      ).toMatchObject({ id: old.id, kind: "comp", active: false });
    });
  });

  it("refuses a name keyed by something that is not a language, on create and on update", async () => {
    const names = { en: "Complaint", "not a language": "Queja" };
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
      updateAdjustmentReason(tx, created.id, complaint({ names: { en: " ", es: "Queja" } })),
    );
    expect(updated.names).toEqual({ es: "Queja" });
  });

  it("reads one reason by its id, an inactive one included, and refuses an id that names none", async () => {
    const reason = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "Read" })));
    await inTx((tx) => deactivateAdjustmentReason(tx, reason.id));

    expect(await inTx((tx) => findAdjustmentReason(tx, reason.id))).toEqual({
      ...reason,
      active: false,
    });
    await expect(inTx((tx) => findAdjustmentReason(tx, MISSING))).rejects.toMatchObject({
      code: "adjustment_reason.not_found",
      params: { reasonId: MISSING },
    });
  });

  describe("reactivating a reason", () => {
    it("makes a deactivated reason active again under the same id", async () => {
      const reason = await inTx((tx) => createAdjustmentReason(tx, complaint()));
      await inTx((tx) => deactivateAdjustmentReason(tx, reason.id));

      expect(await inTx((tx) => reactivateAdjustmentReason(tx, reason.id))).toEqual(reason);
      expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([reason]);
    });

    it("refuses a name an active reason now holds, and leaves the reason deactivated", async () => {
      const old = await inTx((tx) => createAdjustmentReason(tx, complaint()));
      await inTx((tx) => deactivateAdjustmentReason(tx, old.id));
      const taken = await inTx((tx) => createAdjustmentReason(tx, complaint()));

      await expect(inTx((tx) => reactivateAdjustmentReason(tx, old.id))).rejects.toMatchObject({
        code: "adjustment_reason.name_taken",
        params: { name: "Complaint" },
      });
      expect(await inTx((tx) => findAdjustmentReason(tx, old.id))).toEqual({
        ...old,
        active: false,
      });
      expect(await inTx((tx) => listAdjustmentReasons(tx))).toEqual([taken]);
    });

    it("refuses an id that names no reason", async () => {
      await expect(inTx((tx) => reactivateAdjustmentReason(tx, MISSING))).rejects.toMatchObject({
        code: "adjustment_reason.not_found",
        params: { reasonId: MISSING },
      });
    });

    it("changes nothing on a reason that is already active", async () => {
      const reason = await inTx((tx) => createAdjustmentReason(tx, complaint()));
      expect(await inTx((tx) => reactivateAdjustmentReason(tx, reason.id))).toEqual(reason);
      expect(await inTx((tx) => listAdjustmentReasons(tx, { includeInactive: true }))).toEqual([
        reason,
      ]);
    });

    it("keeps the position it had, so it returns to its place among the active reasons", async () => {
      const a = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "A" })));
      const b = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "B" })));
      const c = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "C" })));
      await inTx((tx) => deactivateAdjustmentReason(tx, b.id));
      const d = await inTx((tx) => createAdjustmentReason(tx, complaint({ name: "D" })));

      await inTx((tx) => reactivateAdjustmentReason(tx, b.id));
      expect(
        (await inTx((tx) => listAdjustmentReasons(tx, { includeInactive: true }))).map((r) => [
          r.id,
          r.position,
          r.active,
        ]),
      ).toEqual([
        [a.id, 0, true],
        [b.id, 1, true],
        [c.id, 2, true],
        [d.id, 3, true],
      ]);
    });
  });
});
