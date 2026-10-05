import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("@waitron/layouts barrel", () => {
  it("exports the new canvas surface", () => {
    expect(api.FORM_FACTORS).toBeDefined();
    expect(api.CARD_CONTRACTS).toBeDefined();
    expect(typeof api.validateCanvas).toBe("function");
    expect(typeof api.validateThemeOverride).toBe("function");
    expect(api.DEFAULT_CANVASES.till).toBeDefined();
  });
  it("exports the receipt-trim surface", () => {
    expect(api.DEFAULT_RECEIPT).toBeDefined();
    expect(typeof api.validateReceiptConfig).toBe("function");
    expect(typeof api.getPrintedReceipt).toBe("function");
    expect(typeof api.getStoredLogoRasters).toBe("function");
    expect(typeof api.encodeLogoRaster).toBe("function");
    expect(api.MAX_RECEIPT_PHONE_LENGTH).toBe(30);
    expect(api.MAX_RECEIPT_EMAIL_LENGTH).toBe(254);
  });
});
