import { describe, expect, it } from "vitest";
import { heldGroupIds, inHeldGroup, waitsInHeldGroup } from "./held-groups.js";

describe("held groups", () => {
  const held = heldGroupIds([
    { id: "g-held", state: "held" },
    { id: "g-fired", state: "fired" },
  ]);

  it("collects the ids of the held groups only", () => {
    expect([...held]).toEqual(["g-held"]);
  });

  it("distinguishes held, fired and absent group membership", () => {
    expect(inHeldGroup({ groupId: "g-held" }, held)).toBe(true);
    expect(inHeldGroup({ groupId: "g-fired" }, held)).toBe(false);
    expect(inHeldGroup({ groupId: null }, held)).toBe(false);
  });

  describe("a dish waiting in its held group", () => {
    const dish = {
      groupId: "g-held",
      firedAt: null,
      quantity: "1.000",
    };

    it("waits while its group is held and the kitchen has not started it", () => {
      expect(waitsInHeldGroup(dish, held)).toBe(true);
    });

    it("does not wait in a fired group, or in none", () => {
      expect(waitsInHeldGroup({ ...dish, groupId: "g-fired" }, held)).toBe(false);
      expect(waitsInHeldGroup({ ...dish, groupId: null }, held)).toBe(false);
    });

    it("does not wait once fired, as a dish made here is at its send even in a held group", () => {
      expect(waitsInHeldGroup({ ...dish, firedAt: "2026-11-05T12:00:00.000Z" }, held)).toBe(false);
    });

    it("does not wait wholly cancelled; part cancelled, the rest still waits", () => {
      expect(waitsInHeldGroup({ ...dish, cancelledQuantity: "1.000" }, held)).toBe(false);
      expect(
        waitsInHeldGroup({ ...dish, quantity: "2.000", cancelledQuantity: "1.000" }, held),
      ).toBe(true);
    });
  });
});
