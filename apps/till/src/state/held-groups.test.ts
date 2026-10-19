import { describe, expect, it } from "vitest";
import { heldGroupIds, inHeldGroup } from "./held-groups.js";

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
});
