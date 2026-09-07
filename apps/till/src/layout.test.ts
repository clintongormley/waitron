import { describe, expect, it } from "vitest";
import type { CanvasDef } from "./layout.js";
import { CARD_REQUIRED_CAPABILITY, CARD_REQUIRED_PERMISSION, kindOfFormFactor } from "./layout.js";

describe("CanvasDef mirror", () => {
  it("accepts a canvas literal shaped like the layouts package", () => {
    const canvas: CanvasDef = {
      formFactor: "till",
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
    expect(canvas.tabs[0]!.cards[0]!.type).toBe("product-grid");
    expect(canvas.tabs[0]!.cards[1]!.visibleWhen).toEqual(["has-parked"]);
  });
});

describe("card-contract mirror", () => {
  it("mirrors the required capability per card", () => {
    expect(CARD_REQUIRED_CAPABILITY["tender-pay"]).toBe("integrated-card-payment");
    expect(CARD_REQUIRED_CAPABILITY["kds-board"]).toBe("act-as-kds");
    expect(CARD_REQUIRED_CAPABILITY["product-grid"]).toBeUndefined();
  });
  it("mirrors the required permission per card", () => {
    expect(CARD_REQUIRED_PERMISSION["table-layout-editor"]).toBe("till.configure");
    expect(CARD_REQUIRED_PERMISSION["floor-plan"]).toBeUndefined();
  });
});

describe("kindOfFormFactor mirror", () => {
  it("maps each known form factor to its device kind", () => {
    expect(kindOfFormFactor("till")).toBe("till");
    expect(kindOfFormFactor("kds")).toBe("kds_station");
    // Both handheld form factors collapse to the same kind — the phone shell.
    expect(kindOfFormFactor("phone-portrait")).toBe("handheld");
    expect(kindOfFormFactor("tablet-landscape")).toBe("handheld");
  });

  it("returns undefined for an unknown form factor (graceful widening)", () => {
    // A server that adds a form factor this older client does not know must not break boot: the switch
    // falls through to the normal operator till rather than throwing.
    expect(kindOfFormFactor("hologram")).toBeUndefined();
  });
});
