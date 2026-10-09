import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import * as validation from "./validate.js";

const languages = ["es-ES", "ca-ES", "gl-ES"];
const logo = `${"ab".repeat(32)}.png`;
function refusal(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error("Expected receipt.invalid refusal");
}
function expectRefusal(input: unknown, params: unknown): void {
  const error = refusal(() => validation.validateDepartmentReceipt(input, languages));
  expect(error.code).toBe("receipt.invalid");
  expect(error.params).toEqual(params);
}

describe("department receipt validation", () => {
  it("keeps approved translations and contact spellings without inheriting fields", () => {
    expect(
      validation.validateDepartmentReceipt(
        {
          headerSubtitle: { "es-ES": " Spanish ", "ca-ES": "Catalan" },
          footerMessage: { "gl-ES": "Galician" },
          logo,
          phone: "+34 (91) 123-45.67",
          email: "hola@bar.es",
        },
        languages,
      ),
    ).toEqual({
      headerSubtitle: { "es-ES": " Spanish ", "ca-ES": "Catalan" },
      footerMessage: { "gl-ES": "Galician" },
      logo,
      phone: "+34 (91) 123-45.67",
      email: "hola@bar.es",
    });
  });
  it("drops blanks without introducing inherited defaults", () => {
    expect(
      validation.validateDepartmentReceipt(
        { headerSubtitle: { "es-ES": " \n" }, footerMessage: {}, phone: "", email: "", logo: "" },
        languages,
      ),
    ).toEqual({});
  });
  it("accepts the text bound and own null-prototype maps", () => {
    const map = Object.assign(Object.create(null), { "es-ES": "x".repeat(200) });
    expect(validation.validateDepartmentReceipt({ headerSubtitle: map }, languages)).toEqual({
      headerSubtitle: { "es-ES": "x".repeat(200) },
    });
  });
  it.each(["headerSubtitle", "footerMessage"])(
    "names the known language of an oversized %s",
    (field) => {
      expectRefusal(
        { [field]: { "ca-ES": "x".repeat(201) } },
        { reason: "too_long", field, language: "ca-ES", maxLength: 200 },
      );
    },
  );
  it.each([null, [], "text", 4, Object.create({ email: "hidden@bar.es" })])(
    "refuses a non-plain root %j",
    (input) => {
      expectRefusal(input, { reason: "not_object" });
    },
  );
  it.each([null, [], "text", 4, Object.create({ "es-ES": "Hidden" })])(
    "refuses a non-map translation %j",
    (input) => {
      expectRefusal({ headerSubtitle: input }, { reason: "not_object", field: "headerSubtitle" });
    },
  );
  it.each([null, [], 4, true, {}])("refuses a non-string allowed translation %j", (value) => {
    expectRefusal(
      { footerMessage: { "es-ES": value } },
      { reason: "not_string", field: "footerMessage", language: "es-ES" },
    );
  });
  it.each(["en-GB", "constructor", "prototype", "__proto__"])(
    "refuses unknown/prototype language %s without echoing it",
    (language) => {
      expectRefusal(
        { headerSubtitle: { [language]: "Secret" } },
        { reason: "invalid_language", field: "headerSubtitle" },
      );
    },
  );
  it.each(["printAddress", "tradingName", "logoRasters", "__proto__", "constructor"])(
    "refuses department field %s without echoing it",
    (field) => {
      expectRefusal({ [field]: false }, { reason: "unknown_field" });
    },
  );
  it.each([
    ["phone", "123", "invalid_phone"],
    ["phone", "1".repeat(6) + " ".repeat(25), "invalid_phone"],
    ["email", " hola@bar.es", "invalid_email"],
    ["email", `${"a".repeat(64)}@${"b".repeat(186)}.com`, "invalid_email"],
    ["logo", "../logo.png", "invalid_logo"],
    ["logo", `${"AB".repeat(32)}.png`, "invalid_logo"],
    ["phone", null, "not_string"],
    ["email", null, "not_string"],
    ["logo", null, "not_string"],
  ])("retains the %s refusal for %j", (field, value, reason) => {
    expectRefusal({ [field]: value }, { reason, field });
  });
  it("accepts the existing phone/email bounds", () => {
    expect(
      validation.validateDepartmentReceipt(
        {
          phone: "1".repeat(6) + " ".repeat(24),
          email: `${"a".repeat(64)}@${"b".repeat(185)}.com`,
        },
        languages,
      ),
    ).toEqual({
      phone: "1".repeat(6) + " ".repeat(24),
      email: `${"a".repeat(64)}@${"b".repeat(185)}.com`,
    });
  });
});

describe("venue default subset validation", () => {
  it("retains global strings verbatim and accepts false", () => {
    expect(
      validation.validateVenueReceiptSettings({
        logo,
        headerSubtitle: "  ",
        footerMessage: "",
        printAddress: false,
      }),
    ).toEqual({ logo, headerSubtitle: "  ", footerMessage: "", printAddress: false });
    expect(validation.validateVenueReceiptSettings({ printAddress: true })).toEqual({
      printAddress: true,
    });
    expect(validation.validateVenueReceiptSettings({})).toEqual({});
  });
  it.each([null, [], Object.create({ printAddress: false })])(
    "refuses a non-plain defaults root %j",
    (input) => {
      const error = refusal(() => validation.validateVenueReceiptSettings(input));
      expect(error.code).toBe("receipt.invalid");
      expect(error.params).toEqual({ reason: "not_object" });
    },
  );
  it.each(["phone", "email", "unknown", "__proto__"])(
    "does not let the defaults patch write %s",
    (field) => {
      const error = refusal(() => validation.validateVenueReceiptSettings({ [field]: "x" }));
      expect(error.code).toBe("receipt.invalid");
      expect(error.params).toEqual({ reason: "unknown_field" });
    },
  );
  it.each([
    [{ printAddress: null }, { reason: "not_boolean", field: "printAddress" }],
    [{ headerSubtitle: { "es-ES": "Map" } }, { reason: "not_string", field: "headerSubtitle" }],
    [
      { footerMessage: "x".repeat(201) },
      { reason: "too_long", field: "footerMessage", maxLength: 200 },
    ],
    [{ logo: "bad" }, { reason: "invalid_logo", field: "logo" }],
  ])("retains global validation for %j", (input, params) => {
    const error = refusal(() => validation.validateVenueReceiptSettings(input));
    expect(error.code).toBe("receipt.invalid");
    expect(error.params).toEqual(params);
  });
});
