import { describe, expect, it } from "vitest";
import { heldGroupIds, inHeldGroup, sendsAlone } from "./held-groups.js";

describe("sendsAlone", () => {
  const held = heldGroupIds([
    { id: "g-held", state: "held" },
    { id: "g-fired", state: "fired" },
  ]);
  const dish = {
    parentLineNo: null,
    firedAt: null,
    state: "queued" as const,
    groupId: null as string | null,
  };

  it("collects the ids of the held groups only", () => {
    expect([...held]).toEqual(["g-held"]);
  });

  it("sends a held dish with a ticket item in no group, or in a fired group, on its own", () => {
    expect(sendsAlone(dish, held)).toBe(true);
    expect(sendsAlone({ ...dish, groupId: "g-fired" }, held)).toBe(true);
  });

  it("leaves a dish in a held group to its group", () => {
    expect(inHeldGroup({ groupId: "g-held" }, held)).toBe(true);
    expect(inHeldGroup({ groupId: "g-fired" }, held)).toBe(false);
    expect(inHeldGroup({ groupId: null }, held)).toBe(false);
    expect(sendsAlone({ ...dish, groupId: "g-held" }, held)).toBe(false);
  });

  it("sends nothing for a fired dish, a dish with no ticket item, or an extras child", () => {
    expect(sendsAlone({ ...dish, firedAt: "2026-08-20T09:59:00.000Z" }, held)).toBe(false);
    expect(sendsAlone({ ...dish, state: null }, held)).toBe(false);
    expect(sendsAlone({ ...dish, parentLineNo: 1 }, held)).toBe(false);
  });

  it("reads an absent parent as a dish", () => {
    expect(sendsAlone({ firedAt: null, state: "queued", groupId: null }, held)).toBe(true);
  });

  it("does not send a held split-off extra alone", () => {
    expect(sendsAlone({ ...dish, parentLineNo: 1 }, held)).toBe(false);
  });
});
