import { describe, expect, it } from "vitest";
import { isFencedStanding, routableServers, servingPrimaryNodeId, standingOf } from "./fence.js";
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

describe("routableServers", () => {
  // `node` above leaves `contactUrl` empty, which is itself unroutable, so these build their own.
  const at = (nodeId: string, standing: NodeStanding, contactUrl = `https://${nodeId}`) => ({
    nodeId,
    contactUrl,
    standing,
  });

  it("answers [] when no document is held", () => {
    expect(routableServers(null)).toEqual([]);
  });

  it("orders primary, then secondary, then sell-only, whatever order the chart lists them in", () => {
    expect(
      routableServers(
        doc([at("c", "sell-only"), at("a", "serving-secondary"), at("b", "serving-primary")]),
      ),
    ).toEqual([
      { nodeId: "b", url: "https://b", standing: "serving-primary" },
      { nodeId: "a", url: "https://a", standing: "serving-secondary" },
      { nodeId: "c", url: "https://c", standing: "sell-only" },
    ]);
  });

  it("excludes an evicted node — it has left the venue", () => {
    expect(routableServers(doc([at("gone", "evicted"), at("here", "serving-primary")]))).toEqual([
      { nodeId: "here", url: "https://here", standing: "serving-primary" },
    ]);
  });

  it("excludes a node with no contactUrl — there is no address to dial", () => {
    expect(
      routableServers(doc([at("blank", "serving-secondary", ""), at("here", "serving-primary")])),
    ).toEqual([{ nodeId: "here", url: "https://here", standing: "serving-primary" }]);
  });
});
