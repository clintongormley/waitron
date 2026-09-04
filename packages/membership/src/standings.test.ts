import { describe, expect, it } from "vitest";
import { evictNode, nextStandings } from "./standings.js";
import type { MembershipNode } from "./types.js";

const self = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";

describe("nextStandings", () => {
  it("promotes self (a listed non-primary) to serving-primary", () => {
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "https://self", standing: "serving-secondary" },
    ];
    expect(nextStandings(current, self)).toEqual([
      { nodeId: self, contactUrl: "https://self", standing: "serving-primary" },
    ]);
  });

  it("demotes the current serving-primary to sell-only (NOT evicted) and preserves its contactUrl", () => {
    const current: MembershipNode[] = [
      { nodeId: other, contactUrl: "https://old", standing: "serving-primary" },
      { nodeId: self, contactUrl: "", standing: "serving-secondary" },
    ];
    expect(nextStandings(current, self)).toEqual([
      { nodeId: other, contactUrl: "https://old", standing: "sell-only" },
      { nodeId: self, contactUrl: "", standing: "serving-primary" },
    ]);
  });

  it("leaves an uninvolved node exactly as it was (standing AND contactUrl untouched)", () => {
    const bystander: MembershipNode = {
      nodeId: other,
      contactUrl: "https://bystander",
      standing: "sell-only",
    };
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "", standing: "serving-secondary" },
      bystander,
    ];
    const [, resultBystander] = nextStandings(current, self);
    expect(resultBystander).toEqual(bystander);
  });

  it("appends self as serving-primary with an empty contactUrl when self is absent", () => {
    const current: MembershipNode[] = [
      { nodeId: other, contactUrl: "https://old", standing: "serving-primary" },
    ];
    expect(nextStandings(current, self)).toEqual([
      { nodeId: other, contactUrl: "https://old", standing: "sell-only" },
      { nodeId: self, contactUrl: "", standing: "serving-primary" },
    ]);
  });

  it("returns a single self serving-primary node from an empty input", () => {
    expect(nextStandings([], self)).toEqual([
      { nodeId: self, contactUrl: "", standing: "serving-primary" },
    ]);
  });
});

const third = "33333333-3333-3333-3333-333333333333";

describe("evictNode", () => {
  it("marks the named node evicted and leaves the primary and secondary exactly as they were", () => {
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "https://primary", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://secondary", standing: "serving-secondary" },
      { nodeId: third, contactUrl: "https://drained", standing: "sell-only" },
    ];
    expect(evictNode(current, third)).toEqual([
      { nodeId: self, contactUrl: "https://primary", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://secondary", standing: "serving-secondary" },
      { nodeId: third, contactUrl: "https://drained", standing: "evicted" },
    ]);
  });

  it("leaves a node that is already evicted evicted (idempotent)", () => {
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "https://primary", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://gone", standing: "evicted" },
    ];
    expect(evictNode(current, other)).toEqual([
      { nodeId: self, contactUrl: "https://primary", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://gone", standing: "evicted" },
    ]);
  });

  it("returns the list unchanged when the nodeId is not present (never appends)", () => {
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "https://primary", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://secondary", standing: "serving-secondary" },
    ];
    expect(evictNode(current, third)).toEqual(current);
  });

  it("does not mutate the input array or its node objects", () => {
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "https://primary", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://drained", standing: "sell-only" },
    ];
    const snapshot: MembershipNode[] = [
      { nodeId: self, contactUrl: "https://primary", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://drained", standing: "sell-only" },
    ];
    evictNode(current, other);
    expect(current).toEqual(snapshot);
  });
});
