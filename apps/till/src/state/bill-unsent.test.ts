import { afterEach, describe, expect, it } from "vitest";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import { billUnsentOf, billUnsentText } from "./bill-unsent.js";
import { refusalOf } from "./bill-payment.js";

const refused = () => ({
  code: "bill.unsent_dishes",
  status: 409,
  billId: "bill-2",
  owners: [
    { personId: "ana", name: "Ana", quantity: "1.000" },
    { personId: "alex", name: "Alex $& <chef>", quantity: "2.500" },
  ],
});
afterEach(() => setLocale("en"));

describe("unsent-dish refusal details", () => {
  it("keeps a detached snapshot of every owner's exact dish count for the payment dialog", () => {
    const error = refused();
    const result = refusalOf(error);
    error.owners[0]!.name = "Changed";
    error.owners.push({ personId: "extra", name: "Extra", quantity: "3.000" });
    expect(result).toEqual({
      code: "bill.unsent_dishes",
      unsent: {
        billId: "bill-2",
        owners: [
          { personId: "ana", name: "Ana", quantity: "1.000" },
          { personId: "alex", name: "Alex $& <chef>", quantity: "2.500" },
        ],
      },
    });
  });

  it.each([
    null,
    undefined,
    {},
    { ...refused(), code: "bill.other" },
    { ...refused(), billId: null },
    { ...refused(), billId: "" },
    { ...refused(), owners: null },
    { ...refused(), owners: [] },
    ...[
      null,
      {},
      { personId: 3, name: "Ana", quantity: "1.000" },
      { personId: "ana", name: null, quantity: "1.000" },
      ...[null, 1, "0.000", "-1.000", "1e3", "1.0001", "2,5", "abc"].map((quantity) => ({
        personId: "ana",
        name: "Ana",
        quantity,
      })),
    ].map((owner) => ({ ...refused(), owners: [owner] })),
  ])("leaves malformed or unrelated details to the generic refusal: %j", (error) => {
    expect(billUnsentOf(error)).toBeUndefined();
  });

  it.each([
    {
      locale: "en",
      label: "Terrace · Bill 2",
      expected:
        "Terrace · Bill 2. Send or remove these dishes before paying. Ana: 1 unsent dish. Alex $& <chef>: 2.5 unsent dishes",
    },
    {
      locale: "es",
      label: "Terraza · Cuenta 2",
      expected:
        "Terraza · Cuenta 2. Envía o quita estos platos antes de cobrar. Ana: 1 plato sin enviar. Alex $& <chef>: 2,5 platos sin enviar",
    },
  ])(
    "formats exact quantities and the bill in $locale without interpreting names",
    ({ locale, label, expected }) => {
      setLocale(locale);
      expect(billUnsentText(refused(), label)).toBe(expected);
    },
  );

  it("has an actionable fallback when a refusal has no usable owner details", () => {
    expect(codeMessage("bill.unsent_dishes", "en")).toBe(
      "Send or remove the bill's unsent dishes before paying",
    );
    expect(codeMessage("bill.unsent_dishes", "es")).toBe(
      "Envía o quita los platos sin enviar de la cuenta antes de cobrar",
    );
  });
});

it("keeps placeholder text in a person's name literal", () => {
  setLocale("en");
  expect(
    billUnsentText(
      { billId: "b", owners: [{ personId: "p", name: "Alex {n} $&", quantity: "2.000" }] },
      "Bill 2",
    ),
  ).toBe("Bill 2. Send or remove these dishes before paying. Alex {n} $&: 2 unsent dishes");
});
