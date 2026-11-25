import { describe, expect, it } from "vitest";
import { currentOrderLabel, refusalOrderName } from "./current-order-label.js";

describe("current order labels", () => {
  it("names each table group and typed name once, in the order staff read them", () => {
    const place = {
      names: ["Terrace 4", "Terrace 5", "Terrace 4"],
      partyName: "Ana",
      billName: "Ana",
      counter: false,
    };
    expect(currentOrderLabel(place, "Former table")).toBe("Terrace 4, 5 · Ana");
    expect(refusalOrderName(12, { ...place, billName: "Riley" })).toBe(
      "#12 · Terrace 4, 5 · Ana · Riley",
    );
  });

  it("drops an old table label for an unnamed counter order", () => {
    const place = { names: [], partyName: null, billName: "", counter: true };
    expect(currentOrderLabel(place, "Former table")).toBeNull();
    expect(refusalOrderName(12, place)).toBe("#12");
  });

  it("keeps the saved clue for a departed party in payment queues", () => {
    const place = { names: [], partyName: "Ana", billName: null, counter: false };
    expect(currentOrderLabel(place, "Recorded terrace")).toBe("Recorded terrace");
    expect(currentOrderLabel(place, null)).toBeNull();
    expect(currentOrderLabel({ ...place, billName: "Ana" }, "Ana · Recorded terrace")).toBe(
      "Ana · Recorded terrace",
    );
    expect(refusalOrderName(12, place)).toBe("#12 · Ana");
  });
});
