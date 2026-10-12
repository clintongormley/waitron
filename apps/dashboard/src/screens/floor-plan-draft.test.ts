import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../api/client.js";
import {
  addJoinedTable,
  addTables,
  changePlacement,
  checkDraft,
  deleteTable,
  draftFromPlan,
  freeTables,
  joinedTableOf,
  madeOfText,
  patchTable,
  placeTable,
  rekeyDraft,
  restoreTable,
  sameDraft,
  saveFromDraft,
  setParts,
  withLiveTables,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";

const m1Placement = { x: 2, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

const plan: FloorPlan = {
  zoneId: "z1",
  revision: 3,
  savedAt: "2026-10-01T10:00:00.000Z",
  tables: [
    {
      id: "m1",
      liveTableId: "l1",
      label: "T1",
      seats: 4,
      fixed: false,
      placement: m1Placement,
      partIds: [],
    },
    {
      id: "m2",
      liveTableId: "l2",
      label: "T2",
      seats: 2,
      fixed: true,
      placement: null,
      partIds: [],
    },
    {
      id: "m9",
      liveTableId: "l9",
      label: "T9",
      seats: null,
      fixed: false,
      placement: null,
      partIds: [],
    },
  ],
};

/** Long table (10 seats) made of Counter 3 (2), Counter 4 (6) and Counter 5 (4), beside T1. */
const joinedPlan: FloorPlan = {
  zoneId: "z1",
  revision: 3,
  savedAt: "2026-10-01T10:00:00.000Z",
  tables: [
    plan.tables[0]!,
    {
      id: "c3",
      liveTableId: "lc3",
      label: "Counter 3",
      seats: 2,
      fixed: false,
      placement: null,
      partIds: [],
    },
    {
      id: "c4",
      liveTableId: "lc4",
      label: "Counter 4",
      seats: 6,
      fixed: false,
      placement: null,
      partIds: [],
    },
    {
      id: "c5",
      liveTableId: "lc5",
      label: "Counter 5",
      seats: 4,
      fixed: false,
      placement: null,
      partIds: [],
    },
    {
      id: "long",
      liveTableId: "llong",
      label: "Long table",
      seats: 10,
      fixed: false,
      placement: m1Placement,
      partIds: ["c3", "c4", "c5"],
    },
  ],
};

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}:${++n}`;
}

function open(): FloorPlanDraft {
  return draftFromPlan(plan);
}

function table(draft: FloorPlanDraft, key: string) {
  return draft.tables.find((t) => t.key === key)!;
}

describe("floor plan draft", () => {
  it("keys every master table by id", () => {
    const d = open();
    expect(d.tables.map((t) => t.key)).toEqual(["m1", "m2", "m9"]);
    expect(table(d, "m9")).toEqual({
      key: "m9",
      id: "m9",
      liveTableId: "l9",
      label: "T9",
      seats: null,
      fixed: false,
      placement: null,
      parts: null,
    });
    expect(table(d, "m1")).toEqual({
      key: "m1",
      id: "m1",
      liveTableId: "l1",
      label: "T1",
      seats: 4,
      fixed: false,
      placement: m1Placement,
      parts: null,
    });
    expect(Object.keys(d)).toEqual(["tables"]);
  });

  it("sends a save with a key per table", () => {
    const save = saveFromDraft(3, open());
    expect(save).toEqual({
      revision: 3,
      tables: [
        {
          id: "m1",
          key: "m1",
          label: "T1",
          seats: 4,
          fixed: false,
          placement: m1Placement,
          partKeys: [],
        },
        { id: "m2", key: "m2", label: "T2", seats: 2, fixed: true, placement: null, partKeys: [] },
        {
          id: "m9",
          key: "m9",
          label: "T9",
          seats: null,
          fixed: false,
          placement: null,
          partKeys: [],
        },
      ],
    });
    expect("liveTableId" in save.tables[0]!).toBe(false);
    expect("liveTableId" in save.tables[2]!).toBe(false);
  });

  it("never sends a live-table adoption field for an unsaved draft table", () => {
    const d = addTables(open(), [{ label: "T5", seats: 3, fixed: true }], counter("new"));
    d.tables[3]!.liveTableId = "linked";
    expect(saveFromDraft(3, d).tables[3]).toEqual({
      key: "new:1",
      label: "T5",
      seats: 3,
      fixed: true,
      placement: null,
      partKeys: [],
    });
  });

  it("sends a new table with neither id nor live table", () => {
    const d = addTables(open(), [{ label: "T5", seats: 3, fixed: true }], counter("new"));
    const sent = saveFromDraft(3, d).tables[3]!;
    expect(sent).toEqual({
      key: "new:1",
      label: "T5",
      seats: 3,
      fixed: true,
      placement: null,
      partKeys: [],
    });
    expect("id" in sent).toBe(false);
    expect("liveTableId" in sent).toBe(false);
  });

  it("re-keys a saved draft from the answer's ids", () => {
    const d = addTables(open(), [{ label: "T5", seats: 3, fixed: false }], counter("new"));
    const before = structuredClone(d);
    const r = rekeyDraft(d, { m1: "m1", m2: "m2", m9: "m9", "new:1": "m5" });
    expect(d).toEqual(before);
    expect(r.tables.map((t) => [t.key, t.id, t.liveTableId])).toEqual([
      ["m1", "m1", "l1"],
      ["m2", "m2", "l2"],
      ["m9", "m9", "l9"],
      ["m5", "m5", null],
    ]);
    const sent = saveFromDraft(4, r).tables;
    expect(sent[2]).toEqual({
      id: "m9",
      key: "m9",
      label: "T9",
      seats: null,
      fixed: false,
      placement: null,
      partKeys: [],
    });
    expect("liveTableId" in sent[2]!).toBe(false);
    expect(sent[3]).toEqual({
      id: "m5",
      key: "m5",
      label: "T5",
      seats: 3,
      fixed: false,
      placement: null,
      partKeys: [],
    });
  });

  it("leaves a key the answer does not name as it was", () => {
    const d = addTables(open(), [{ label: "T5", seats: 3, fixed: false }], counter("new"));
    const r = rekeyDraft(d, { m9: "m9" });
    expect(r.tables.map((t) => t.key)).toEqual(["m1", "m2", "m9", "new:1"]);
    expect(table(r, "new:1").id).toBeNull();
  });

  it("counts a draft moved and moved back as unchanged", () => {
    const d = open();
    expect(
      sameDraft(d, changePlacement(changePlacement(d, "m1", { x: 5, y: 4 }), "m1", { x: 2, y: 3 })),
    ).toBe(true);
    expect(sameDraft(d, changePlacement(d, "m1", { x: 5, y: 4 }))).toBe(false);
  });

  it("counts a seat, a name, a turn or Fixed as a change", () => {
    const d = open();
    expect(sameDraft(d, patchTable(d, "m1", { seats: 5 }))).toBe(false);
    expect(sameDraft(d, patchTable(d, "m1", { label: "T1a" }))).toBe(false);
    expect(sameDraft(d, changePlacement(d, "m1", { rotation: 45 }))).toBe(false);
    expect(sameDraft(d, patchTable(d, "m1", { fixed: true }))).toBe(false);
    expect(sameDraft(d, patchTable(d, "m2", { placement: m1Placement }))).toBe(false);
    expect(
      sameDraft(d, patchTable(d, "m1", { placement: { ...m1Placement, shape: "round" } })),
    ).toBe(false);
    expect(sameDraft(d, patchTable(d, "m1", { placement: { ...m1Placement, width: 9 } }))).toBe(
      false,
    );
    expect(sameDraft(d, patchTable(d, "m1", { placement: { ...m1Placement, height: 9 } }))).toBe(
      false,
    );
    expect(sameDraft(d, patchTable(d, "m1", { placement: null }))).toBe(false);
  });

  it("compares tables by key, not by order", () => {
    const d = open();
    const reordered = { ...d, tables: [...d.tables].reverse() };
    expect(sameDraft(d, reordered)).toBe(true);
  });

  it("counts a deleted table added back as new as a change", () => {
    const d = open();
    const back = addTables(
      deleteTable(d, "m1"),
      [{ label: "T1", seats: 4, fixed: false }],
      counter("new"),
    );
    expect(table(back, "new:1").label).toBe("T1");
    expect(sameDraft(d, back)).toBe(false);
  });

  it("finds an empty or repeated name, first in table order", () => {
    const d = open();
    expect(checkDraft(patchTable(d, "m2", { label: "  " }))).toEqual({
      key: "m2",
      problem: "label_missing",
    });
    expect(checkDraft(patchTable(d, "m9", { label: " T1 " }))).toEqual({
      key: "m9",
      problem: "label_repeated",
    });
    expect(
      checkDraft(patchTable(patchTable(d, "m2", { label: "" }), "m9", { label: "T1" })),
    ).toEqual({ key: "m2", problem: "label_missing" });
    expect(checkDraft(d)).toBeNull();
  });

  it("moves a placed table and keeps its size, shape and turn", () => {
    const d = changePlacement(
      patchTable(open(), "m1", { placement: { ...m1Placement, width: 6, shape: "round" } }),
      "m1",
      { rotation: 30 },
    );
    const before = structuredClone(d);
    const moved = changePlacement(d, "m1", { x: 5, y: 4 });
    expect(table(moved, "m1").placement).toEqual({
      x: 5,
      y: 4,
      width: 6,
      height: 8,
      shape: "round",
      rotation: 30,
    });
    expect(d).toEqual(before);
    expect(table(changePlacement(open(), "m1", { x: 5, y: 4 }), "m1").placement).toEqual({
      x: 5,
      y: 4,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
    });
  });

  it("leaves an unplaced table where it is when asked to move or turn it", () => {
    const d = open();
    expect(changePlacement(d, "m2", { x: 5, y: 4 })).toEqual(d);
    expect(changePlacement(d, "m2", { rotation: 45 })).toEqual(d);
  });

  it("turns a placed table and keeps its place", () => {
    const d = open();
    expect(table(changePlacement(d, "m1", { rotation: 45 }), "m1").placement).toEqual({
      ...m1Placement,
      rotation: 45,
    });
    expect(table(d, "m1").placement).toEqual(m1Placement);
  });

  it("resizes a placed table, keeping its shape and turn, and leaves a spare as it was", () => {
    const d = changePlacement(
      patchTable(open(), "m1", { placement: { ...m1Placement, shape: "round" } }),
      "m1",
      { rotation: 30 },
    );
    const before = structuredClone(d);
    const resized = changePlacement(d, "m1", { x: 1, y: 4, width: 9, height: 3 });
    expect(table(resized, "m1").placement).toEqual({
      x: 1,
      y: 4,
      width: 9,
      height: 3,
      shape: "round",
      rotation: 30,
    });
    expect({ ...table(resized, "m1"), placement: null }).toEqual({
      ...table(d, "m1"),
      placement: null,
    });
    expect(table(resized, "m9")).toBe(table(d, "m9"));
    expect(d).toEqual(before);
    expect(changePlacement(d, "m2", { x: 1, y: 4, width: 9, height: 3 })).toEqual(d);
  });

  it("places a table at the first free spot as an 8 × 8 rectangle", () => {
    const d = open();
    const placed = placeTable(d, "m2");
    expect(table(placed, "m2").placement).toEqual({
      x: 11,
      y: 0,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
    });
    expect(table(d, "m2").placement).toBeNull();
    expect(table(placed, "m1").placement).toEqual(m1Placement);
  });

  it("places a table beside a band whose rows 0–999 are all taken, inside the grid", () => {
    const wall = { x: 0, y: 0, width: 40, height: 999, shape: "rect" as const, rotation: 0 };
    const d = patchTable(open(), "m1", { placement: wall });
    expect(table(placeTable(d, "m2"), "m2").placement).toEqual({
      x: 41,
      y: 0,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
    });
  });

  it("deletes every selected master or new table, even one with a live link", () => {
    const d = open();
    const fresh = addTables(d, [{ label: "T5", seats: 3, fixed: false }], counter("new"));
    expect(deleteTable(d, "m9").tables.map((t) => t.key)).toEqual(["m1", "m2"]);
    expect(deleteTable(fresh, "new:1").tables.map((t) => t.key)).toEqual(["m1", "m2", "m9"]);
    fresh.tables[3]!.liveTableId = "linked";
    expect(deleteTable(fresh, "new:1").tables.map((t) => t.key)).toEqual(["m1", "m2", "m9"]);
  });

  it("adds tables unplaced with fresh keys", () => {
    const d = addTables(
      open(),
      [
        { label: "T5", seats: 3, fixed: false },
        { label: "T6", seats: null, fixed: true },
      ],
      counter("new"),
    );
    expect(d.tables.slice(3)).toEqual([
      {
        key: "new:1",
        id: null,
        liveTableId: null,
        label: "T5",
        seats: 3,
        fixed: false,
        placement: null,
        parts: null,
      },
      {
        key: "new:2",
        id: null,
        liveTableId: null,
        label: "T6",
        seats: null,
        fixed: true,
        placement: null,
        parts: null,
      },
    ]);
    expect(d.tables.slice(0, 3).map((t) => t.key)).toEqual(["m1", "m2", "m9"]);
  });

  it("stores a copy of the placement it is given", () => {
    const placement = { ...m1Placement, x: 9 };
    const p = patchTable(open(), "m1", { placement });
    placement.x = 20;
    expect(table(p, "m1").placement?.x).toBe(9);
  });

  it("leaves a table unplaced when the plan has no free spot for it", () => {
    const floor = { x: 0, y: 0, width: 999, height: 999, shape: "rect" as const, rotation: 0 };
    const d = patchTable(open(), "m1", { placement: floor });
    expect(placeTable(d, "m2")).toBe(d);
  });

  it("puts a table back exactly at a remembered place, even over another table", () => {
    const at = { x: 2, y: 3, width: 5, height: 7, shape: "round" as const, rotation: 30 };
    expect(table(placeTable(open(), "m2", at), "m2").placement).toEqual(at);
  });

  it("control: leaves a table unplaced when ten rows of ten 99 × 99 tables fill the grid", () => {
    const tables = Array.from({ length: 100 }, (_, i) => ({
      key: `f${i}`,
      id: null,
      liveTableId: null,
      label: `F${i}`,
      seats: null,
      fixed: false,
      placement: {
        x: (i % 10) * 100,
        y: Math.floor(i / 10) * 100,
        width: 99,
        height: 99,
        shape: "rect" as const,
        rotation: 0,
      },
      parts: null,
    }));
    const d = { ...open(), tables: [...open().tables, ...tables] };
    const full = patchTable(d, "m1", { placement: null });
    expect(placeTable(full, "m2")).toBe(full);
  });

  it("returns the same draft when placing a table that already has a place", () => {
    const d = open();
    expect(placeTable(d, "m1")).toBe(d);
  });

  it("patches only the named table", () => {
    const d = open();
    const p = patchTable(d, "m1", { label: "Bar", seats: null });
    expect(table(p, "m1")).toEqual({ ...table(d, "m1"), label: "Bar", seats: null });
    expect(table(p, "m2")).toEqual(table(d, "m2"));
    expect(table(d, "m1").label).toBe("T1");
  });

  it("restores a deleted table as it was opened, at the end, leaving the rest alone", () => {
    const opened = open();
    const moved = changePlacement(deleteTable(opened, "m1"), "m2", { x: 0, y: 0 });
    const restored = restoreTable(moved, table(opened, "m1"), opened);
    expect(restored.tables.map((t) => t.key)).toEqual(["m2", "m9", "m1"]);
    expect(table(restored, "m1")).toEqual(table(opened, "m1"));
    expect(table(restored, "m1").placement).not.toBe(table(opened, "m1").placement);
    expect(moved.tables.some((t) => t.key === "m1")).toBe(false);
  });

  it("gives tables keyed as in another draft that draft's live tables, and leaves the rest", () => {
    const d = addTables(open(), [{ label: "T5", seats: 3, fixed: false }], counter("new"));
    const from: FloorPlanDraft = {
      tables: [
        { ...table(d, "m1"), liveTableId: "l7" },
        { ...table(d, "m2"), liveTableId: null },
        { ...table(d, "m9") },
      ],
    };
    const merged = withLiveTables(d, from);
    expect(merged.tables.map((t) => t.liveTableId)).toEqual(["l7", "l2", "l9", null]);
    expect(d.tables[0]!.liveTableId).toBe("l1");
    expect(withLiveTables(merged, from)).toBe(merged);
  });

  it("reads a joined table's parts as keys, and a plain table as none", () => {
    const d = draftFromPlan(joinedPlan);
    expect(table(d, "long").parts).toEqual(["c3", "c4", "c5"]);
    expect(table(d, "c3").parts).toBeNull();
    expect(table(d, "m1").parts).toBeNull();
    expect(table(d, "long").parts).not.toBe(joinedPlan.tables[4]!.partIds);
  });

  it("sends each joined table's parts as keys, and none for a plain table", () => {
    const sent = saveFromDraft(3, draftFromPlan(joinedPlan)).tables;
    expect(sent.map((t) => [t.key, t.partKeys])).toEqual([
      ["m1", []],
      ["c3", []],
      ["c4", []],
      ["c5", []],
      ["long", ["c3", "c4", "c5"]],
    ]);
  });

  it("re-keys a new joined table's new parts from the answer's ids", () => {
    const d = addTables(
      draftFromPlan(joinedPlan),
      [
        { label: "Counter 6", seats: 2, fixed: false },
        { label: "Counter 7", seats: 2, fixed: false },
        { label: "Short table", seats: 4, fixed: false },
      ],
      counter("new"),
    );
    const joined: FloorPlanDraft = {
      tables: d.tables.map((t) =>
        t.key === "new:3" ? { ...t, parts: ["new:1", "new:2", "c3"] } : t,
      ),
    };
    const r = rekeyDraft(joined, { "new:1": "m6", "new:2": "m7", "new:3": "m8" });
    expect(table(r, "m8").parts).toEqual(["m6", "m7", "c3"]);
    expect(table(r, "long").parts).toEqual(["c3", "c4", "c5"]);
    expect(table(joined, "new:3").parts).toEqual(["new:1", "new:2", "c3"]);
  });

  it("compares parts as sets", () => {
    const d = draftFromPlan(joinedPlan);
    const reordered = {
      tables: d.tables.map((t) => (t.key === "long" ? { ...t, parts: ["c5", "c3", "c4"] } : t)),
    };
    expect(sameDraft(d, reordered)).toBe(true);
    const fewer = {
      tables: d.tables.map((t) => (t.key === "long" ? { ...t, parts: ["c3", "c4"] } : t)),
    };
    expect(sameDraft(d, fewer)).toBe(false);
    const swapped = {
      tables: d.tables.map((t) => (t.key === "long" ? { ...t, parts: ["c3", "c4", "m1"] } : t)),
    };
    expect(sameDraft(d, swapped)).toBe(false);
    const emptied = { tables: d.tables.map((t) => (t.key === "c3" ? { ...t, parts: [] } : t)) };
    expect(sameDraft(d, emptied)).toBe(false);
  });

  it("deleting a part takes it out of its joined table", () => {
    const d = deleteTable(draftFromPlan(joinedPlan), "c4");
    expect(d.tables.map((t) => t.key)).toEqual(["m1", "c3", "c5", "long"]);
    expect(table(d, "long").parts).toEqual(["c3", "c5"]);
    expect(joinedTableOf(d, "c3")?.key).toBe("long");
    expect(joinedTableOf(d, "c4")).toBeUndefined();
  });

  it("deleting a joined table leaves its parts as plain tables", () => {
    const d = deleteTable(draftFromPlan(joinedPlan), "long");
    expect(d.tables.map((t) => [t.key, t.parts])).toEqual([
      ["m1", null],
      ["c3", null],
      ["c4", null],
      ["c5", null],
    ]);
    expect(joinedTableOf(d, "c3")).toBeUndefined();
  });

  it("a restored part re-joins Long table when Long table is still in the draft", () => {
    const opened = draftFromPlan(joinedPlan);
    const deleted = deleteTable(opened, "c5");
    const restored = restoreTable(deleted, table(opened, "c5"), opened);
    expect(table(restored, "c5")).toEqual(table(opened, "c5"));
    expect([...table(restored, "long").parts!].sort()).toEqual(["c3", "c4", "c5"]);
    expect(sameDraft(restored, opened)).toBe(true);
  });

  it("a restored part comes back on its own when its joined table is gone", () => {
    const opened = draftFromPlan(joinedPlan);
    const deleted = deleteTable(deleteTable(opened, "long"), "c5");
    const restored = restoreTable(deleted, table(opened, "c5"), opened);
    expect(table(restored, "c5").parts).toBeNull();
    expect(restored.tables.filter((t) => t.parts !== null)).toEqual([]);
  });

  it("a restored part stays out of Long table when another joined table holds it", () => {
    const opened = draftFromPlan(joinedPlan);
    const deleted = deleteTable(opened, "c5");
    const other: FloorPlanDraft = {
      tables: [
        ...deleted.tables,
        {
          ...table(opened, "c3"),
          key: "new:1",
          id: null,
          liveTableId: null,
          label: "Bar",
          parts: ["c5"],
        },
      ],
    };
    const restored = restoreTable(other, table(opened, "c5"), opened);
    expect(table(restored, "long").parts).toEqual(["c3", "c4"]);
    expect(table(restored, "new:1").parts).toEqual(["c5"]);
  });

  it("a restored joined table keeps only parts that are still free", () => {
    const opened = draftFromPlan(joinedPlan);
    const deleted = deleteTable(deleteTable(opened, "long"), "c4");
    const other: FloorPlanDraft = {
      tables: [
        ...deleted.tables,
        {
          ...table(opened, "m1"),
          key: "new:1",
          id: null,
          liveTableId: null,
          label: "Bar",
          parts: ["c3"],
        },
      ],
    };
    const restored = restoreTable(other, table(opened, "long"), opened);
    expect(table(restored, "long").parts).toEqual(["c5"]);
    expect(table(restored, "new:1").parts).toEqual(["c3"]);
  });

  it("returns the draft itself when the key is already in it", () => {
    const d = open();
    expect(restoreTable(d, { ...table(d, "m2"), label: "Other" }, d)).toBe(d);
  });

  it("adds Long table not placed, made of the tables chosen", () => {
    const opened = draftFromPlan(joinedPlan);
    const d = addJoinedTable(
      deleteTable(opened, "long"),
      { label: "Long table", seats: 10, parts: ["c3", "c4", "c5"] },
      counter("new"),
    );
    expect(d.tables.at(-1)).toEqual({
      key: "new:1",
      id: null,
      liveTableId: null,
      label: "Long table",
      seats: 10,
      fixed: false,
      placement: null,
      parts: ["c3", "c4", "c5"],
    });
    expect(joinedTableOf(d, "c4")?.key).toBe("new:1");
    expect(d.tables.slice(0, -1).map((t) => t.key)).toEqual(["m1", "c3", "c4", "c5"]);
    const parts = ["c3", "c4"];
    const own = addJoinedTable(opened, { label: "Bar", seats: 8, parts }, counter("new"));
    expect(table(own, "new:1").parts).not.toBe(parts);
    const set = setParts(d, "new:1", ["c3", "c5"]);
    expect(table(set, "new:1").parts).toEqual(["c3", "c5"]);
    expect(table(d, "new:1").parts).toEqual(["c3", "c4", "c5"]);
    expect(setParts(d, "missing", ["c3"])).toBe(d);
  });

  it("lists the free tables in number order, a joined table's own parts included for it", () => {
    const d = addTables(
      draftFromPlan(joinedPlan),
      [
        { label: "Counter 10", seats: 2, fixed: false },
        { label: "Counter 9", seats: 2, fixed: false },
        { label: "Counter 11", seats: 2, fixed: false },
      ],
      counter("new"),
    );
    const withBar = addJoinedTable(d, { label: "Bar", seats: 4, parts: ["new:3"] }, () => "bar");
    const names = (key?: string) => freeTables(withBar, key).map((t) => t.label);
    expect(names()).toEqual(["Counter 9", "Counter 10"]);
    expect(names("long")).toEqual([
      "Counter 3",
      "Counter 4",
      "Counter 5",
      "Counter 9",
      "Counter 10",
    ]);
    expect(names("bar")).toEqual(["Counter 9", "Counter 10", "Counter 11"]);
  });

  it.each([
    [["Counter 3", "Counter 5", "Counter 4"], "Counter 3, 4, 5"],
    [["Window 1", "Stool 2"], "Window 1, Stool 2"],
    [["T1", "T2"], "T1, T2"],
    [["Bar 2", "Bar 10"], "Bar 2, 10"],
    [[], ""],
  ])("writes %s as %s", (names, text) => {
    expect(madeOfText(names)).toBe(text);
  });

  it("finds a joined table with fewer than two parts", () => {
    const d = draftFromPlan(joinedPlan);
    expect(checkDraft(d)).toBeNull();
    expect(checkDraft(setParts(d, "long", ["c3"]))).toEqual({
      key: "long",
      problem: "parts_too_few",
    });
    expect(checkDraft(setParts(d, "long", []))).toEqual({ key: "long", problem: "parts_too_few" });
  });
});
