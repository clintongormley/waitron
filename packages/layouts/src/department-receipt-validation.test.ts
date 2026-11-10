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
  it.each(["tradingName", "logoRasters", "__proto__", "constructor"])(
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

describe("department address and description fields", () => {
  it.each([true, false])("accepts printAddress %s and an authored description", (printAddress) => {
    const input = { printAddress, operationDescription: "Dining service" };
    expect(validation.validateDepartmentReceipt(input, languages)).toEqual(input);
  });
  it.each([null, [], "true", 1].map((value) => [value]))(
    "refuses non-boolean address choice %j",
    (printAddress) => {
      expectRefusal({ printAddress }, { reason: "not_boolean", field: "printAddress" });
    },
  );
  it.each([null, [], true, 1].map((value) => [value]))(
    "refuses non-string description %j",
    (operationDescription) => {
      expectRefusal(
        { operationDescription },
        { reason: "not_string", field: "operationDescription" },
      );
    },
  );
  it("accepts a 500-character description and keeps an empty receipt empty", () => {
    const input = { operationDescription: "x".repeat(500) };
    expect(validation.validateDepartmentReceipt(input, languages)).toEqual(input);
    expect(validation.validateDepartmentReceipt({}, languages)).toEqual({});
  });
});
