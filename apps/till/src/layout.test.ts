import { describe, expect, it } from "vitest";
import type { ProfileDef } from "./layout.js";

describe("ProfileDef mirror", () => {
  it("accepts a profile literal shaped like the layouts package", () => {
    const profile: ProfileDef = {
      formFactor: "till",
      capabilities: ["integrated-card-payment", "open-cash-drawer"],
      tabs: [
        {
          key: "counter",
          title: "Counter",
          columns: 12,
          cards: [
            { type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } },
            {
              type: "held-orders",
              colSpan: 8,
              rowSpan: 2,
              config: {},
              visibleWhen: ["has-parked"],
            },
          ],
        },
      ],
    };
    expect(profile.tabs[0]!.cards[0]!.type).toBe("product-grid");
    expect(profile.tabs[0]!.cards[1]!.visibleWhen).toEqual(["has-parked"]);
  });
});
