import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("@waitron/layouts barrel", () => {
  it("exports the device surface and no longer the retired theme check", () => {
    expect(api.FORM_FACTORS).toBeDefined();
    expect("validateThemeOverride" in api).toBe(false);
  });
  it("exports the receipt-trim surface", () => {
    expect(typeof api.validateReceiptConfig).toBe("function");
    expect("getPrintedReceipt" in api).toBe(false);
    expect("getStoredLogoRasters" in api).toBe(false);
    expect(typeof api.printableLogoRasters).toBe("function");
    expect(typeof api.encodeLogoRaster).toBe("function");
    expect(api.MAX_RECEIPT_PHONE_LENGTH).toBe(30);
    expect(api.MAX_RECEIPT_EMAIL_LENGTH).toBe(254);
  });
  it("exports the custom themes store", () => {
    for (const name of [
      "createCustomTheme",
      "saveCustomTheme",
      "setThemeInUse",
      "listCustomThemes",
      "readThemeInUse",
    ]) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
