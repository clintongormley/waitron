import { describe, expect, it } from "vitest";
import { groupFiledRows } from "./filed-rows.js";

interface Extra {
  id: string;
  kind: string;
  quantity: number;
}

interface Dish {
  id: string;
  /** null: not bound to a cohort. */
  cohort: string | null;
  price: number;
  extras: Extra[];
}

const dish = (id: string, cohort: string | null, extras: Extra[] = [], price = 500): Dish => ({
  id,
  cohort,
  price,
  extras,
});
const extra = (id: string, kind: string, quantity = 1): Extra => ({ id, kind, quantity });

const group = (dishes: readonly Dish[]) =>
  groupFiledRows(dishes, {
    extrasOf: (d) => d.extras,
    dishKey: (d) => (d.cohort === null ? null : JSON.stringify([d.cohort, d.price])),
    extraKey: (e) => JSON.stringify([e.kind, e.quantity]),
  }).map((row) => ({
    dishes: row.dishes.map((d) => d.id),
    extras: row.extras.map((members) => members.map((e) => e.id)),
  }));

describe("groupFiledRows", () => {
  it("files an unbound dish alone, even beside an identical one", () => {
    expect(group([dish("a", null), dish("b", null)])).toEqual([
      { dishes: ["a"], extras: [] },
      { dishes: ["b"], extras: [] },
    ]);
  });

  it("files two bound dishes of one cohort with the same fields as one row", () => {
    expect(group([dish("a", "c1"), dish("b", "c1")])).toEqual([{ dishes: ["a", "b"], extras: [] }]);
  });

  it("keeps dishes of different cohorts or different fields apart", () => {
    expect(group([dish("a", "c1"), dish("b", "c2"), dish("c", "c1", [], 600)])).toEqual([
      { dishes: ["a"], extras: [] },
      { dishes: ["b"], extras: [] },
      { dishes: ["c"], extras: [] },
    ]);
  });

  it("keeps bound dishes with different extras apart", () => {
    expect(
      group([dish("a", "c1", [extra("a1", "cheese")]), dish("b", "c1", [extra("b1", "ham")])]),
    ).toEqual([
      { dishes: ["a"], extras: [["a1"]] },
      { dishes: ["b"], extras: [["b1"]] },
    ]);
  });

  it("keeps bound dishes apart when one takes more of an extra", () => {
    expect(
      group([
        dish("a", "c1", [extra("a1", "cheese", 1)]),
        dish("b", "c1", [extra("b1", "cheese", 2)]),
      ]),
    ).toEqual([
      { dishes: ["a"], extras: [["a1"]] },
      { dishes: ["b"], extras: [["b1"]] },
    ]);
  });

  it("pairs each of the first dish's extras with the first unclaimed match of every other dish", () => {
    expect(
      group([
        dish("a", "c1", [extra("a1", "cheese"), extra("a2", "ham"), extra("a3", "cheese")]),
        dish("b", "c1", [extra("b1", "ham"), extra("b2", "cheese"), extra("b3", "cheese")]),
        dish("x", null),
        dish("c", "c1", [extra("c1", "cheese"), extra("c2", "cheese"), extra("c3", "ham")]),
      ]),
    ).toEqual([
      {
        dishes: ["a", "b", "c"],
        extras: [
          ["a1", "b2", "c1"],
          ["a2", "b1", "c3"],
          ["a3", "b3", "c2"],
        ],
      },
      { dishes: ["x"], extras: [] },
    ]);
  });

  it("places a row at its first dish's position", () => {
    expect(group([dish("a", "c1"), dish("x", "c2"), dish("b", "c1")])).toEqual([
      { dishes: ["a", "b"], extras: [] },
      { dishes: ["x"], extras: [] },
    ]);
  });

  it("keeps a dish key and its extras' keys apart", () => {
    const rows = groupFiledRows(
      [
        { key: "ab", extras: [] as string[] },
        { key: "a", extras: ["b"] },
      ],
      { extrasOf: (d) => d.extras, dishKey: (d) => d.key, extraKey: (e) => e },
    );
    expect(rows).toHaveLength(2);
  });
});
