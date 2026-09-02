import { describe, expect, it } from "vitest";
import { CARD_TYPES } from "./profile.js";
import { CARD_CONTRACTS, SALE_CRITICAL_CARDS } from "./card-contract.js";

describe("card-contract registry", () => {
  it("declares a contract for every card type", () => {
    for (const t of CARD_TYPES) expect(CARD_CONTRACTS[t]).toBeDefined();
  });
  it("every contract has sane defaults and a states array", () => {
    for (const t of CARD_TYPES) {
      const c = CARD_CONTRACTS[t];
      expect(c.defaultColSpan).toBeGreaterThanOrEqual(1);
      expect(c.defaultRowSpan).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(c.visibilityStates)).toBe(true);
    }
  });
  it("marks the four counter sale cards sale-critical and nothing else", () => {
    expect([...SALE_CRITICAL_CARDS].sort()).toEqual(
      ["basket", "product-grid", "tender-pay", "total"].sort(),
    );
  });
  it("gives the table-layout-editor a required permission", () => {
    expect(CARD_CONTRACTS["table-layout-editor"].requiredPermission).toBe("till.configure");
  });
  it("requires the integrated-card-payment capability on the pay card", () => {
    expect(CARD_CONTRACTS["tender-pay"].requiredCapability).toBe("integrated-card-payment");
  });
});
