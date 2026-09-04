import { describe, expect, it } from "vitest";
import { isFencedStanding, servingPrimaryNodeId, standingOf } from "./fence.js";
import type { MembershipNode, NodeStanding, SignedMembershipDocument } from "./types.js";

const doc = (nodes: readonly MembershipNode[]): SignedMembershipDocument => ({
  body: { term: 1, nodes },
  signerNodeId: "n1",
  signature: "sig",
  endorsements: [],
});
const node = (nodeId: string, standing: NodeStanding): MembershipNode => ({
  nodeId,
  contactUrl: "",
  standing,
});

describe("standingOf", () => {
  it("returns the node's standing when present", () => {
    expect(standingOf(doc([node("n1", "sell-only")]), "n1")).toBe("sell-only");
  });
  it("returns undefined when the node is absent from the chart", () => {
    expect(standingOf(doc([node("n2", "serving-primary")]), "n1")).toBeUndefined();
  });
});

describe("isFencedStanding", () => {
  it("fences sell-only and evicted", () => {
    expect(isFencedStanding("sell-only")).toBe(true);
    expect(isFencedStanding("evicted")).toBe(true);
  });
  it("does not fence serving roles or an absent node", () => {
    expect(isFencedStanding("serving-primary")).toBe(false);
    expect(isFencedStanding("serving-secondary")).toBe(false);
    expect(isFencedStanding(undefined)).toBe(false);
  });
});

describe("servingPrimaryNodeId", () => {
  it("returns the node holding serving-primary", () => {
    expect(
      servingPrimaryNodeId(doc([node("n1", "sell-only"), node("n2", "serving-primary")])),
    ).toBe("n2");
  });
  it("returns undefined when no node serves as primary", () => {
    expect(
      servingPrimaryNodeId(doc([node("n1", "sell-only"), node("n2", "serving-secondary")])),
    ).toBeUndefined();
  });
});
