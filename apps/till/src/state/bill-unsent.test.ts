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
  it("keeps a detached bill identity for the payment dialog without owner details", () => {
    const error = refused();
    const result = refusalOf(error);
    error.billId = "Changed";
    error.owners[0]!.name = "Changed";
    error.owners.push({ personId: "extra", name: "Extra", quantity: "3.000" });
    expect(result).toEqual({ code: "bill.unsent_dishes", unsent: { billId: "bill-2" } });
  });

  it.each([
    null,
    undefined,
    {},
    { ...refused(), code: "bill.other" },
    { ...refused(), billId: null },
    { ...refused(), billId: "" },
  ])("leaves malformed or unrelated bill identities to the generic refusal: %j", (error) => {
    expect(billUnsentOf(error)).toBeUndefined();
  });

  it.each(
    [
      undefined,
      null,
      [],
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
      ].map((owner) => [owner]),
      [{ personId: "ana", name: "Ana", quantity: "1.000" }],
    ].map((owners) => ({ owners })),
  )("reads the refused bill without retaining withdrawn owner details: %j", ({ owners }) => {
    expect(billUnsentOf({ ...refused(), owners })).toEqual({ billId: "bill-2" });
  });

  it.each([
    {
      locale: "en",
      label: "Terrace · Bill 2",
      expected: "Terrace · Bill 2. Send or remove the unsent dishes before paying.",
    },
    {
      locale: "es",
      label: "Terraza · Cuenta 2",
      expected: "Terraza · Cuenta 2. Envía o quita los platos sin enviar antes de cobrar.",
    },
  ])("shows the approved simple refusal and the bill in $locale", ({ locale, label, expected }) => {
    setLocale(locale);
    expect(billUnsentText(label)).toBe(expected);
  });

  it("has the approved actionable fallback for a code-only refusal", () => {
    expect(codeMessage("bill.unsent_dishes", "en")).toBe(
      "Send or remove the unsent dishes before paying.",
    );
    expect(codeMessage("bill.unsent_dishes", "es")).toBe(
      "Envía o quita los platos sin enviar antes de cobrar.",
    );
  });
});

it("shows the approved refusal without a bill heading", () => {
  setLocale("en");
  expect(billUnsentText()).toBe("Send or remove the unsent dishes before paying.");
});
