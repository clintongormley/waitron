import { describe, expect, it } from "vitest";
import { distinctTargets, named } from "./delete-impact.js";

describe("named", () => {
  it("names each target once, in label order, breaking a tie by id", () => {
    const b2 = { id: "b2", name: "Caja" };
    const a1 = { id: "a1", name: "Caja" };
    const c3 = { id: "c3", name: "Caja" };
    const z9 = { id: "z9", name: "Barra 10" };
    const y8 = { id: "y8", name: "barra 9" };
    expect(named("device_reader", [b2, z9, c3, a1, b2, y8])).toEqual({
      key: "device_reader",
      count: 5,
      targets: [y8, z9, a1, b2, c3],
    });
  });

  it("counts nothing for no targets", () => {
    expect(named("reader_holder", [])).toEqual({ key: "reader_holder", count: 0, targets: [] });
  });
});

describe("distinctTargets", () => {
  it("keeps each id once, in label order, breaking a tie by id", () => {
    const b2 = { id: "b2", name: "Caja" };
    const a1 = { id: "a1", name: "Caja" };
    const y8 = { id: "y8", name: "barra 9" };
    expect(distinctTargets([b2, a1, y8, b2])).toEqual([y8, a1, b2]);
    expect(distinctTargets([])).toEqual([]);
  });
});
