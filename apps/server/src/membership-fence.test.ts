import { describe, expect, it } from "vitest";
import type { MembershipNode, NodeStanding, SignedMembershipDocument } from "@waitron/membership";
import { isFenced, shouldFenceRestart } from "./membership-fence.js";

const node = (nodeId: string, standing: NodeStanding): MembershipNode => ({
  nodeId,
  contactUrl: "",
  standing,
});
const doc = (nodes: readonly MembershipNode[]): SignedMembershipDocument => ({
  body: { term: 2, nodes },
  signerNodeId: "n2",
  signature: "sig",
  endorsements: [],
});

describe("isFenced", () => {
  it("is false when no document is held", () => {
    expect(isFenced(null, "n1")).toBe(false);
  });
  it("is true when this node's standing is sell-only", () => {
    expect(isFenced(doc([node("n1", "sell-only"), node("n2", "serving-primary")]), "n1")).toBe(
      true,
    );
  });
  it("is false when this node still serves", () => {
    expect(isFenced(doc([node("n1", "serving-primary")]), "n1")).toBe(false);
  });
});

describe("shouldFenceRestart", () => {
  it("restarts when an unfenced node adopts a document that fences it", () => {
    expect(shouldFenceRestart(false, doc([node("n1", "sell-only")]), "n1")).toBe(true);
  });
  it("does not restart when the adopted document does not fence this node", () => {
    expect(shouldFenceRestart(false, doc([node("n1", "serving-primary")]), "n1")).toBe(false);
  });
  it("does not restart a node already fenced at boot", () => {
    expect(shouldFenceRestart(true, doc([node("n1", "sell-only")]), "n1")).toBe(false);
  });
});
