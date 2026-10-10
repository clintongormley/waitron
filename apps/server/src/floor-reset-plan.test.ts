import { describe, expect, it } from "vitest";
import { type LiveTable, planReset, type Target, targetsFromMaster } from "./floor-reset-plan.js";

const t = (tableId: string | null, label: string, over: Partial<Target> = {}): Target => ({
  tableId,
  planTableId: null,
  label,
  seats: 4,
  fixed: false,
  placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 },
  remove: false,
  ...over,
});
const l = (id: string, label: string, over: Partial<LiveTable> = {}): LiveTable => ({
  id,
  label,
  held: false,
  tied: false,
  hasToday: true,
  mergedWithHeld: false,
  ...over,
});
const none = new Set<string>();
const sorted = <T>(xs: T[]) =>
  [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe("planReset", () => {
  it("copies the target onto every free table", () => {
    expect(
      planReset({ targets: [t("a", "T1")], live: [l("a", "T1")], takenElsewhere: none }).apply,
    ).toEqual([{ target: t("a", "T1"), label: "T1" }]);
  });

  it("leaves a seated table, and the free table merged with it, pending", () => {
    const plan = planReset({
      targets: [t("a", "T1"), t("b", "T2")],
      live: [l("a", "T1", { held: true, tied: true }), l("b", "T2", { mergedWithHeld: true })],
      takenElsewhere: none,
    });
    expect(plan.apply).toEqual([]);
    expect(plan.pending.map((x) => x.tableId)).toEqual(["a", "b"]);
    expect(plan.seed).toEqual([]);
  });

  it("seeds a seated table that has no today's row, keeping its name", () => {
    const plan = planReset({
      targets: [t("a", "Patio 1")],
      live: [l("a", "T1", { held: true, tied: true, hasToday: false })],
      takenElsewhere: none,
    });
    expect(plan.seed).toEqual([t("a", "Patio 1")]);
    expect(plan.pending).toEqual([t("a", "Patio 1")]);
  });

  it("creates a table the target adds", () => {
    expect(planReset({ targets: [t(null, "T2")], live: [], takenElsewhere: none }).create).toEqual([
      t(null, "T2"),
    ]);
  });

  it("removes a free table, and hides one still tied", () => {
    const plan = planReset({
      targets: [t("a", "T1", { remove: true }), t("b", "T2", { remove: true })],
      live: [l("a", "T1"), l("b", "T2", { tied: true })],
      takenElsewhere: none,
    });
    expect(plan).toMatchObject({ remove: ["a"], hide: ["b"] });
    expect(plan.pending).toEqual([t("b", "T2", { remove: true })]);
  });

  it("leaves a removal waiting while a party sits at the table", () => {
    const plan = planReset({
      targets: [t("a", "T1", { remove: true }), t(null, "T1")],
      live: [l("a", "T1", { held: true, tied: true })],
      takenElsewhere: none,
    });
    expect(plan).toMatchObject({ remove: [], hide: [], create: [] });
    expect(plan.pending).toEqual([t("a", "T1", { remove: true }), t(null, "T1")]);
  });

  it("swaps two names in one plan", () => {
    const plan = planReset({
      targets: [t("a", "T2"), t("b", "T1")],
      live: [l("a", "T1"), l("b", "T2")],
      takenElsewhere: none,
    });
    expect(plan.apply.map((x) => x.label)).toEqual(["T2", "T1"]);
  });

  it("makes a new table wait for a name a seated table still uses", () => {
    const plan = planReset({
      targets: [t("a", "Terrace 9"), t(null, "Terrace 4")],
      live: [l("a", "Terrace 4", { held: true, tied: true })],
      takenElsewhere: none,
    });
    expect(plan.create).toEqual([]);
    expect(plan.pending.map((x) => x.label)).toEqual(["Terrace 9", "Terrace 4"]);
  });

  it("does not hand a removed table's name on in the same pass", () => {
    const plan = planReset({
      targets: [
        t("a", "T1", { remove: true }),
        t("b", "T1"),
        t(null, "T3"),
        t("c", "T3", { remove: true }),
      ],
      live: [l("a", "T1"), l("b", "T2"), l("c", "T3")],
      takenElsewhere: none,
    });
    expect(plan.remove).toEqual(["a", "c"]);
    expect(plan.apply).toEqual([{ target: t("b", "T1"), label: null }]);
    expect(plan.create).toEqual([]);
    expect(plan.pending).toEqual([t("b", "T1"), t(null, "T3")]);
  });

  it("never gives two tables one name", () => {
    // b is seated as T2, so a keeps T1; c may not then take T1
    const plan = planReset({
      targets: [t("a", "T2"), t("b", "T3"), t("c", "T1")],
      live: [l("a", "T1"), l("b", "T2", { held: true, tied: true }), l("c", "T4")],
      takenElsewhere: none,
    });
    expect(sorted(plan.apply.map((x) => [x.target.tableId, x.label]))).toEqual(
      sorted([
        ["a", null],
        ["c", null],
      ]),
    );
  });

  it("gives a name two tables want to the one listed first", () => {
    const plan = planReset({
      targets: [t("a", "T9"), t(null, "T9"), t("b", "T9")],
      live: [l("a", "T1"), l("b", "T2")],
      takenElsewhere: none,
    });
    expect(plan.apply).toEqual([
      { target: t("a", "T9"), label: "T9" },
      { target: t("b", "T9"), label: null },
    ]);
    expect(plan.create).toEqual([]);
  });

  it("treats a name used in another zone as in use", () => {
    expect(
      planReset({ targets: [t(null, "Bar 1")], live: [], takenElsewhere: new Set(["Bar 1"]) })
        .create,
    ).toEqual([]);
  });

  it("treats the name of a live table outside the plan as in use", () => {
    expect(
      planReset({ targets: [t(null, "Spare")], live: [l("s", "Spare")], takenElsewhere: none })
        .create,
    ).toEqual([]);
  });

  it("leaves a target whose table is not live pending, its name kept from every other table", () => {
    const plan = planReset({
      targets: [t("gone", "T1"), t("old", "T2", { remove: true }), t(null, "T1"), t("a", "T2")],
      live: [l("a", "T3")],
      takenElsewhere: none,
    });
    expect(plan).toMatchObject({ seed: [], create: [], remove: [], hide: [] });
    expect(plan.apply).toEqual([{ target: t("a", "T2"), label: null }]);
    expect(plan.pending).toEqual([
      t("gone", "T1"),
      t("old", "T2", { remove: true }),
      t(null, "T1"),
      t("a", "T2"),
    ]);
  });

  it("ignores a removal that names no table", () => {
    const plan = planReset({
      targets: [t(null, "T1", { remove: true })],
      live: [],
      takenElsewhere: none,
    });
    expect(plan).toEqual({ apply: [], seed: [], create: [], remove: [], hide: [], pending: [] });
  });
});

describe("targetsFromMaster", () => {
  it("builds targets from the master, leaving out a table the master never had", () => {
    const master = [
      { id: "m1", label: "T1", seats: 4, fixed: false, placement: null },
      { id: "m2", label: "T2", seats: 2, fixed: false, placement: null },
    ];
    const live = [
      { id: "a", label: "Old 1", planTableId: "m1", planned: true },
      { id: "b", label: "Old 2", planTableId: null, planned: true },
      { id: "c", label: "Old 3", planTableId: null, planned: false },
    ];
    expect(targetsFromMaster(master, live).map((x) => [x.tableId, x.label, x.remove])).toEqual([
      ["a", "T1", false],
      ["b", expect.any(String), true],
      [null, "T2", false],
    ]);
  });

  it("copies the master's values, and removes a table whose master table is gone under its current name", () => {
    const placement = { x: 3, y: 4, width: 8, height: 6, shape: "round" as const, rotation: 45 };
    const master = [{ id: "m1", label: "T1", seats: 6, fixed: true, placement }];
    const live = [
      { id: "a", label: "Old 1", planTableId: "m1", planned: true },
      { id: "b", label: "Old 2", planTableId: "m9", planned: true },
    ];
    expect(targetsFromMaster(master, live)).toEqual([
      {
        tableId: "a",
        planTableId: "m1",
        label: "T1",
        seats: 6,
        fixed: true,
        placement,
        remove: false,
      },
      {
        tableId: "b",
        planTableId: null,
        label: "Old 2",
        seats: null,
        fixed: false,
        placement: null,
        remove: true,
      },
    ]);
  });
});
