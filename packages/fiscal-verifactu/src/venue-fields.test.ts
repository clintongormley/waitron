import { describe, expect, it } from "vitest";
import { validateVenueFiscalFields } from "./venue-fields.js";

const GOOD = {
  legalName: "Waitron SL",
  seriesCode: "FS",
  rectificativeSeriesCode: "FR",
  operationDescription: "Venta en establecimiento",
};

describe("validateVenueFiscalFields", () => {
  it("accepts an ordinary Spanish venue", () => {
    expect(() => validateVenueFiscalFields(GOOD)).not.toThrow();
  });

  it("refuses a series code AEAT's character set forbids, naming the field", () => {
    expect(() => validateVenueFiscalFields({ ...GOOD, seriesCode: "Serie A" })).toThrow(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "seriesCode" },
      }),
    );
  });

  it("refuses the rectificative code by its own name, not the standard one's", () => {
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, rectificativeSeriesCode: "Rectificativa A" }),
    ).toThrow(expect.objectContaining({ params: { field: "rectificativeSeriesCode" } }));
  });

  it("refuses a series code too long to survive a restore's installation suffix", () => {
    // MAX_BASE_CODE_LENGTH reserves room for one `-<installation number>` and the counter, each up
    // to ten digits, inside NumSerieFactura's 60-character cap. A code at the limit is accepted and
    // one character more is not — the boundary itself, not merely a value far past it.
    const atLimit = "F".repeat(38);
    expect(() => validateVenueFiscalFields({ ...GOOD, seriesCode: atLimit })).not.toThrow();
    expect(() => validateVenueFiscalFields({ ...GOOD, seriesCode: `${atLimit}F` })).toThrow(
      expect.objectContaining({ params: { field: "seriesCode" } }),
    );
  });

  it("refuses a control character in the legal name", () => {
    expect(() => validateVenueFiscalFields({ ...GOOD, legalName: "Waitron\u0001SL" })).toThrow(
      expect.objectContaining({ params: { field: "legalName" } }),
    );
  });

  it("refuses a control character in the operation description", () => {
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, operationDescription: "Venta\u0001aqui" }),
    ).toThrow(expect.objectContaining({ params: { field: "location.operationDescription" } }));
  });

  it("refuses an operation description past AEAT's 500-character cap, at the boundary", () => {
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, operationDescription: "x".repeat(501) }),
    ).toThrow(expect.objectContaining({ params: { field: "location.operationDescription" } }));
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, operationDescription: "x".repeat(500) }),
    ).not.toThrow();
  });

  it("accepts a tab, which XML permits and the validator allows", () => {
    expect(() => validateVenueFiscalFields({ ...GOOD, legalName: "Waitron\tSL" })).not.toThrow();
  });
});
