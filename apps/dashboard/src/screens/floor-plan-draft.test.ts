import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../api/client.js";
import {
  addJoin,
  addTables,
  checkDraft,
  deleteTable,
  draftFromPlan,
  isAdoptable,
  moveTable,
  patchTable,
  placeTable,
  rekeyDraft,
  removeJoin,
  restoreTable,
  rotateTable,
  sameDraft,
  saveFromDraft,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";

const m1Placement = { x: 2, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

const plan: FloorPlan = {
  zoneId: "z1",
  revision: 3,
  savedAt: "2026-10-01T10:00:00.000Z",
  tables: [
    { id: "m1", liveTableId: "l1", label: "T1", seats: 4, fixed: false, placement: m1Placement },
    { id: "m2", liveTableId: "l2", label: "T2", seats: 2, fixed: true, placement: null },
    { id: null, liveTableId: "l9", label: "T9", seats: null, fixed: false, placement: null },
  ],
  joins: [{ id: "j1", seats: 6, tableIds: ["m1", "m2"] }],
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
  it("keys master tables by id, adoptable ones by their live table, joins by id", () => {
    const d = open();
    expect(d.tables.map((t) => t.key)).toEqual(["m1", "m2", "live:l9"]);
    expect(table(d, "live:l9")).toEqual({
      key: "live:l9",
      id: null,
      liveTableId: "l9",
      label: "T9",
      seats: null,
      fixed: false,
      placement: null,
    });
    expect(table(d, "m1")).toEqual({
      key: "m1",
      id: "m1",
      liveTableId: "l1",
      label: "T1",
      seats: 4,
      fixed: false,
      placement: m1Placement,
    });
    expect(d.joins).toEqual([{ key: "j1", seats: 6, tableKeys: ["m1", "m2"] }]);
  });

  it("sends a save with a key per table and each join as keys", () => {
    const save = saveFromDraft(3, open());
    expect(save).toEqual({
      revision: 3,
      tables: [
        { id: "m1", key: "m1", label: "T1", seats: 4, fixed: false, placement: m1Placement },
        { id: "m2", key: "m2", label: "T2", seats: 2, fixed: true, placement: null },
        {
          liveTableId: "l9",
          key: "live:l9",
          label: "T9",
          seats: null,
          fixed: false,
          placement: null,
        },
      ],
      joins: [{ seats: 6, tableKeys: ["m1", "m2"] }],
    });
    expect("liveTableId" in save.tables[0]!).toBe(false);
    expect("id" in save.tables[2]!).toBe(false);
  });

  it("sends a new table with neither id nor live table", () => {
    const d = addTables(open(), [{ label: "T5", seats: 3, fixed: true }], counter("new"));
    const sent = saveFromDraft(3, d).tables[3]!;
    expect(sent).toEqual({ key: "new:1", label: "T5", seats: 3, fixed: true, placement: null });
    expect("id" in sent).toBe(false);
    expect("liveTableId" in sent).toBe(false);
  });

  it("re-keys a saved draft from the answer's ids", () => {
    let d = addTables(open(), [{ label: "T5", seats: 3, fixed: false }], counter("new"));
    d = addJoin(d, ["m1", "new:1"], 5, "join:1");
    const before = structuredClone(d);
    const r = rekeyDraft(d, { m1: "m1", m2: "m2", "live:l9": "m9", "new:1": "m5" });
    expect(d).toEqual(before);
    expect(r.tables.map((t) => [t.key, t.id, t.liveTableId])).toEqual([
      ["m1", "m1", "l1"],
      ["m2", "m2", "l2"],
      ["m9", "m9", "l9"],
      ["m5", "m5", null],
    ]);
    expect(r.joins).toEqual([
      { key: "j1", seats: 6, tableKeys: ["m1", "m2"] },
      { key: "join:1", seats: 5, tableKeys: ["m1", "m5"] },
    ]);
    const sent = saveFromDraft(4, r).tables;
    expect(sent[2]).toEqual({
      id: "m9",
      key: "m9",
      label: "T9",
      seats: null,
      fixed: false,
      placement: null,
    });
    expect("liveTableId" in sent[2]!).toBe(false);
    expect(sent[3]).toEqual({
      id: "m5",
      key: "m5",
      label: "T5",
      seats: 3,
      fixed: false,
      placement: null,
    });
  });

  it("leaves a key the answer does not name as it was", () => {
    const d = addTables(open(), [{ label: "T5", seats: 3, fixed: false }], counter("new"));
    const r = rekeyDraft(d, { "live:l9": "m9" });
    expect(r.tables.map((t) => t.key)).toEqual(["m1", "m2", "m9", "new:1"]);
    expect(table(r, "new:1").id).toBeNull();
  });

  it("counts a draft moved and moved back as unchanged", () => {
    const d = open();
    expect(sameDraft(d, moveTable(moveTable(d, "m1", 5, 4), "m1", 2, 3))).toBe(true);
    expect(sameDraft(d, moveTable(d, "m1", 5, 4))).toBe(false);
  });

  it("counts a seat, a name, a turn or Fixed as a change", () => {
    const d = open();
    expect(sameDraft(d, patchTable(d, "m1", { seats: 5 }))).toBe(false);
    expect(sameDraft(d, patchTable(d, "m1", { label: "T1a" }))).toBe(false);
    expect(sameDraft(d, rotateTable(d, "m1", 45))).toBe(false);
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

  it("compares joins as sets", () => {
    const d = open();
    expect(sameDraft(d, { ...d, joins: [{ key: "j1", seats: 6, tableKeys: ["m2", "m1"] }] })).toBe(
      true,
    );
    expect(sameDraft(d, { ...d, joins: [{ key: "j1", seats: 7, tableKeys: ["m1", "m2"] }] })).toBe(
      false,
    );
    expect(sameDraft(d, removeJoin(d, "j1"))).toBe(false);
    expect(
      sameDraft(d, { ...d, joins: [{ key: "j1", seats: 6, tableKeys: ["m1", "live:l9"] }] }),
    ).toBe(false);
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
    expect(checkDraft(patchTable(d, "live:l9", { label: " T1 " }))).toEqual({
      key: "live:l9",
      problem: "label_repeated",
    });
    expect(
      checkDraft(patchTable(patchTable(d, "m2", { label: "" }), "live:l9", { label: "T1" })),
    ).toEqual({ key: "m2", problem: "label_missing" });
    expect(checkDraft(d)).toBeNull();
  });

  it("moves a placed table and keeps its size, shape and turn", () => {
    const d = rotateTable(
      patchTable(open(), "m1", { placement: { ...m1Placement, width: 6, shape: "round" } }),
      "m1",
      30,
    );
    const before = structuredClone(d);
    const moved = moveTable(d, "m1", 5, 4);
    expect(table(moved, "m1").placement).toEqual({
      x: 5,
      y: 4,
      width: 6,
      height: 8,
      shape: "round",
      rotation: 30,
    });
    expect(d).toEqual(before);
    expect(table(moveTable(open(), "m1", 5, 4), "m1").placement).toEqual({
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
    expect(moveTable(d, "m2", 5, 4)).toEqual(d);
    expect(rotateTable(d, "m2", 45)).toEqual(d);
  });

  it("turns a placed table and keeps its place", () => {
    const d = open();
    expect(table(rotateTable(d, "m1", 45), "m1").placement).toEqual({
      ...m1Placement,
      rotation: 45,
    });
    expect(table(d, "m1").placement).toEqual(m1Placement);
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

  it("keeps a placed table's y inside the grid when rows 0–999 are all taken", () => {
    const wall = { x: 0, y: 0, width: 40, height: 999, shape: "rect" as const, rotation: 0 };
    const d = patchTable(open(), "m1", { placement: wall });
    expect(table(placeTable(d, "m2"), "m2").placement).toEqual({
      x: 0,
      y: 999,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
    });
  });

  it("deletes a table from its joins, and a join left with one table goes", () => {
    let d = addTables(open(), [{ label: "T5", seats: 3, fixed: false }], counter("new"));
    d = { ...d, joins: [{ key: "j1", seats: 6, tableKeys: ["m1", "m2", "new:1"] }] };
    const before = structuredClone(d);
    const three = deleteTable(d, "new:1");
    expect(d).toEqual(before);
    expect(three.tables.map((t) => t.key)).toEqual(["m1", "m2", "live:l9"]);
    expect(three.joins).toEqual([{ key: "j1", seats: 6, tableKeys: ["m1", "m2"] }]);
    const two = deleteTable(open(), "m2");
    expect(two.tables.map((t) => t.key)).toEqual(["m1", "live:l9"]);
    expect(two.joins).toEqual([]);
  });

  it("does not delete a table offered for adoption", () => {
    const d = open();
    expect(isAdoptable(table(d, "live:l9"))).toBe(true);
    expect(isAdoptable(table(d, "m1"))).toBe(false);
    const fresh = addTables(d, [{ label: "T5", seats: 3, fixed: false }], counter("new"));
    expect(isAdoptable(table(fresh, "new:1"))).toBe(false);
    expect(deleteTable(d, "live:l9")).toEqual(d);
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
      },
      {
        key: "new:2",
        id: null,
        liveTableId: null,
        label: "T6",
        seats: null,
        fixed: true,
        placement: null,
      },
    ]);
    expect(d.tables.slice(0, 3).map((t) => t.key)).toEqual(["m1", "m2", "live:l9"]);
  });

  it("adds and removes a join", () => {
    const d = open();
    const r = removeJoin(addJoin(d, ["m1", "live:l9"], 4, "join:1"), "j1");
    expect(r.joins).toEqual([{ key: "join:1", seats: 4, tableKeys: ["m1", "live:l9"] }]);
    expect(d.joins).toHaveLength(1);
  });

  it("returns the same draft when removing a join it does not have", () => {
    const d = open();
    expect(removeJoin(d, "join:9")).toBe(d);
  });

  it("stores a copy of the placement it is given", () => {
    const placement = { ...m1Placement, x: 9 };
    const p = patchTable(open(), "m1", { placement });
    placement.x = 20;
    expect(table(p, "m1").placement?.x).toBe(9);
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
    const moved = moveTable(deleteTable(opened, "m1"), "m2", 0, 0);
    const restored = restoreTable(moved, table(opened, "m1"));
    expect(restored.tables.map((t) => t.key)).toEqual(["m2", "live:l9", "m1"]);
    expect(table(restored, "m1")).toEqual(table(opened, "m1"));
    expect(table(restored, "m1").placement).not.toBe(table(opened, "m1").placement);
    expect(restored.joins).toEqual(moved.joins);
    expect(moved.tables.some((t) => t.key === "m1")).toBe(false);
  });

  it("puts back only the opened joins through the restored table whose other tables are there", () => {
    const m3 = { key: "m3", id: "m3", liveTableId: "l3", label: "T3", seats: 2, fixed: false };
    const opened: FloorPlanDraft = {
      tables: [...open().tables, { ...m3, placement: null }],
      joins: [
        { key: "j1", seats: 6, tableKeys: ["m1", "m2"] },
        { key: "j2", seats: 5, tableKeys: ["m2", "m3"] },
        { key: "j3", seats: 4, tableKeys: ["m1", "live:l9"] },
      ],
    };
    const deleted = removeJoin(deleteTable(deleteTable(opened, "m2"), "m3"), "j3");
    expect(deleted.joins).toEqual([]);
    const restored = restoreTable(deleted, table(opened, "m2"), opened.joins);
    expect(restored.joins).toEqual([opened.joins[0]]);
    expect(restored.joins[0]!.tableKeys).not.toBe(opened.joins[0]!.tableKeys);
    const onlyM2 = restoreTable(deleteTable(opened, "m2"), table(opened, "m2"), opened.joins);
    expect(sameDraft(onlyM2, opened)).toBe(true);
  });

  it("replaces a join of three that kept its key when the table left it with the saved one", () => {
    const m3 = { key: "m3", id: "m3", liveTableId: "l3", label: "T3", seats: 2, fixed: false };
    const saved: FloorPlanDraft = {
      tables: [...open().tables, { ...m3, placement: null }],
      joins: [{ key: "j1", seats: 8, tableKeys: ["m1", "m2", "m3"] }],
    };
    const deleted = deleteTable(saved, "m2");
    expect(deleted.joins).toEqual([{ key: "j1", seats: 8, tableKeys: ["m1", "m3"] }]);
    const restored = restoreTable(deleted, table(saved, "m2"), saved.joins);
    expect(restored.joins).toEqual(saved.joins);
    expect(sameDraft(restored, saved)).toBe(true);
  });

  it("returns the draft itself when the key is already in it", () => {
    const d = open();
    expect(restoreTable(d, { ...table(d, "m2"), label: "Other" })).toBe(d);
  });
});
