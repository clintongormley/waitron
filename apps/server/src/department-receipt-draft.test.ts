import { describe, expect, it } from "vitest";
import { AppError, type DepartmentReceiptConfig } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { validateDepartmentReceiptWrite } from "./department-receipt-draft.js";

const languages = {
  receiptLanguage: "gl-ES",
  languages: ["gl-ES", "es-ES", "ca-ES"],
  storageLanguages: ["gl-ES", "es-ES", "ca-ES", "eu-ES"],
};
const policy = { receiptPrintMode: "on_request", printTradingName: false };
const fiscal = ALL_MODULES.find((module) => module.fiscal?.venueFields !== undefined)!.fiscal!
  .venueFields!;
const validate = (receipt: unknown, current: DepartmentReceiptConfig = {}) =>
  validateDepartmentReceiptWrite(
    { receipt, policy },
    current,
    languages,
    fiscal.validateOperationDescription,
  );

describe("department receipt write", () => {
  it("keeps authored fields and the separate policy without adding defaults", () => {
    expect(
      validate({
        operationDescription: "Deli meals",
        printAddress: false,
        phone: "+34 910 000 000",
        headerSubtitle: { "gl-ES": "Benvidos", "ca-ES": "Benvinguts" },
      }),
    ).toEqual({
      receipt: {
        operationDescription: "Deli meals",
        printAddress: false,
        phone: "+34 910 000 000",
        headerSubtitle: { "gl-ES": "Benvidos", "ca-ES": "Benvinguts" },
      },
      policy,
    });
  });
  it("preserves an unchanged hidden translation while editing a visible translation", () => {
    expect(
      validate(
        {
          operationDescription: "Deli meals",
          footerMessage: { "eu-ES": "Eskerrik asko", "es-ES": "Gracias" },
        },
        { footerMessage: { "eu-ES": "Eskerrik asko", "es-ES": "Antes" } },
      ),
    ).toEqual({
      receipt: {
        operationDescription: "Deli meals",
        footerMessage: { "eu-ES": "Eskerrik asko", "es-ES": "Gracias" },
      },
      policy,
    });
  });
  it.each(["", " \t\n", undefined])("allows clearing a hidden translation (%j)", (value) => {
    const footerMessage = value === undefined ? {} : { "eu-ES": value };
    expect(
      validate(
        { operationDescription: "Deli meals", footerMessage },
        { footerMessage: { "eu-ES": "Eskerrik asko" } },
      ),
    ).toEqual({
      receipt: { operationDescription: "Deli meals" },
      policy,
    });
  });
  it.each(["headerSubtitle", "footerMessage"] as const)(
    "refuses a changed or new hidden %s translation",
    (field) => {
      for (const current of [{}, { [field]: { "eu-ES": "Kept" } }]) {
        expect(() =>
          validate(
            { operationDescription: "Deli meals", [field]: { "eu-ES": "Changed" } },
            current,
          ),
        ).toThrow(
          expect.objectContaining({
            code: "receipt.invalid",
            params: { reason: "invalid_language", field, language: "eu-ES" },
          }),
        );
      }
    },
  );
  it.each(["en-GB", "ca-ES-valencia", "unknown"])(
    "refuses unlabelled new language %s",
    (language) => {
      expect(() =>
        validate({ operationDescription: "Deli meals", footerMessage: { [language]: "Text" } }),
      ).toThrow(
        expect.objectContaining({
          code: "receipt.invalid",
          params: { reason: "invalid_language", field: "footerMessage" },
        }),
      );
    },
  );
  it.each([undefined, "", " \t\n", "x".repeat(501), "Bad\u0000text"])(
    "refuses an unusable fiscal description (%j)",
    (operationDescription) => {
      expect(() => validate({ operationDescription })).toThrow(
        expect.objectContaining({
          code: "management.request_invalid",
          params: { field: "operationDescription" },
        }),
      );
    },
  );
  it("keeps the 500-character boundary and permitted whitespace verbatim", () => {
    const operationDescription = "Meals\t\n\r" + "x".repeat(492);
    expect(validate({ operationDescription }).receipt.operationDescription).toBe(
      operationDescription,
    );
  });
  it("does not require a fiscal field when no fiscal description contribution is installed", () => {
    expect(validateDepartmentReceiptWrite({ receipt: {}, policy }, {}, languages)).toEqual({
      receipt: {},
      policy,
    });
  });
  it("passes the submitted blank string to the contribution before refusing it", () => {
    let received: string | undefined;
    expect(() =>
      validateDepartmentReceiptWrite(
        { receipt: { operationDescription: "" }, policy },
        {},
        languages,
        (value) => {
          received = value;
        },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "management.request_invalid",
        params: { field: "operationDescription" },
      }),
    );
    expect(received).toBe("");
  });
  it("preserves an unrelated validator failure", () => {
    const problem = new Error("Validator unavailable");
    expect(() =>
      validateDepartmentReceiptWrite(
        { receipt: { operationDescription: "Meals" }, policy },
        {},
        languages,
        () => {
          throw problem;
        },
      ),
    ).toThrow(problem);
  });
  it("does not remap another domain refusal", () => {
    const problem = new AppError("authorization.not_permitted", { permission: "layout.configure" });
    expect(() =>
      validateDepartmentReceiptWrite(
        { receipt: { operationDescription: "Meals" }, policy },
        {},
        languages,
        () => {
          throw problem;
        },
      ),
    ).toThrow(problem);
  });
  it.each(
    [null, [], {}, { receipt: {} }, { policy }, { receipt: {}, policy, settings: {} }].map(
      (input) => [input],
    ),
  )("refuses a malformed write envelope (%j)", (input) => {
    expect(() => validateDepartmentReceiptWrite(input, {}, languages)).toThrow(
      expect.objectContaining({ code: "management.request_invalid" }),
    );
  });
  it.each(
    [
      null,
      [],
      {},
      { receiptPrintMode: "auto" },
      { printTradingName: true },
      { receiptPrintMode: null, printTradingName: true },
      { receiptPrintMode: ["auto"], printTradingName: true },
      { receiptPrintMode: "never", printTradingName: true },
      { receiptPrintMode: "auto", printTradingName: "false" },
      { receiptPrintMode: "auto", printTradingName: true, collectionNumber: "always" },
    ].map((input) => [input]),
  )("refuses a malformed policy (%j)", (input) => {
    expect(() =>
      validateDepartmentReceiptWrite({ receipt: {}, policy: input }, {}, languages),
    ).toThrow(
      expect.objectContaining({ code: "management.request_invalid", params: { field: "policy" } }),
    );
  });
  it.each(
    [null, [], { printAddress: "true" }, { operationDescription: ["Meals"] }].map((input) => [
      input,
    ]),
  )("retains shape validation for receipt fields (%j)", (receipt) => {
    expect(() => validate(receipt)).toThrow(expect.objectContaining({ code: "receipt.invalid" }));
  });
});
