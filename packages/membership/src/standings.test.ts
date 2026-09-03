import { describe, expect, it } from "vitest";
import { nextStandings } from "./standings.js";
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
