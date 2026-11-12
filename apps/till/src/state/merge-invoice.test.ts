import { afterEach, describe, expect, it } from "vitest";
import type { PartyBill } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { mergeInvoiceChoice, mergeInvoiceNames, mergeInvoiceQuestion } from "./merge-invoice.js";

afterEach(() => setLocale("en"));

function bill(over: Partial<PartyBill>): PartyBill {
  return {
    workingOrderId: "wo-1",
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    billNumber: 1,
    billName: null,
    status: "open",
    total: "10.00",
    outstanding: "10.00",
    hasPayments: false,
    receiptAvailable: false,
    ...over,
  };
}

const acme = {
  taxId: "B11111111",
  legalName: "Acme Travel SL",
  address: "Carrer Major 1, Valencia",
  countryCode: "ES",
};
const barSol = {
  taxId: "B22222222",
  legalName: "Bar Sol SL",
  address: "Calle Sol 2, Madrid",
  countryCode: "ES",
};

function full(id: string, recipient: PartyBill["recipient"]): PartyBill {
  return bill({ workingOrderId: id, invoiceType: "F1", recipient });
}

const simplifiedInto = bill({ workingOrderId: "wo-into" });

describe("mergeInvoiceQuestion", () => {
  it("asks nothing when the bill merged away is simplified", () => {
    const bills = [full("wo-into", acme), bill({ workingOrderId: "wo-from" })];
    expect(mergeInvoiceQuestion(bills, "wo-into", "wo-from")).toBeNull();
  });

  it("asks nothing when the bill merged away is F2 but still holds a recipient", () => {
    const bills = [simplifiedInto, bill({ workingOrderId: "wo-from", recipient: acme })];
    expect(mergeInvoiceQuestion(bills, "wo-into", "wo-from")).toBeNull();
  });

  it("asks nothing when both bills name the same identity, whatever the legal name", () => {
    const bills = [full("wo-into", { ...acme, legalName: "Acme" }), full("wo-from", acme)];
    expect(mergeInvoiceQuestion(bills, "wo-into", "wo-from")).toBeNull();
  });

  it("asks nothing when either bill is missing", () => {
    const bills = [full("wo-from", acme)];
    expect(mergeInvoiceQuestion(bills, "wo-into", "wo-from")).toBeNull();
    expect(mergeInvoiceQuestion([simplifiedInto], "wo-into", "wo-from")).toBeNull();
  });

  it("asks before merging a full-invoice bill into a simplified one", () => {
    const from = full("wo-from", acme);
    const question = mergeInvoiceQuestion([simplifiedInto, from], "wo-into", "wo-from")!;
    expect(question.into).toBe(simplifiedInto);
    expect(question.from).toBe(from);
    expect(mergeInvoiceNames(question)).toEqual({
      intoName: null,
      fromName: "Acme Travel SL · B11111111",
    });
  });

  it("asks which customer to keep when each bill has a different full invoice", () => {
    const into = full("wo-into", barSol);
    const from = full("wo-from", acme);
    const question = mergeInvoiceQuestion([into, from], "wo-into", "wo-from")!;
    expect(question.into).toBe(into);
    expect(mergeInvoiceNames(question)).toEqual({
      intoName: "Bar Sol SL · B22222222",
      fromName: "Acme Travel SL · B11111111",
    });
  });

  it("tells apart two customers with the same legal name by their tax numbers alone", () => {
    const question = mergeInvoiceQuestion(
      [full("wo-into", { ...barSol, legalName: acme.legalName }), full("wo-from", acme)],
      "wo-into",
      "wo-from",
    )!;
    expect(mergeInvoiceNames(question)).toEqual({
      intoName: "Acme Travel SL · B22222222",
      fromName: "Acme Travel SL · B11111111",
    });
  });

  it("adds the identifier type and issuing country when name and number are the same", () => {
    const other = {
      ...acme,
      identifierType: "other-document" as const,
      identifierCountryCode: "FR",
    };
    const question = mergeInvoiceQuestion(
      [full("wo-into", acme), full("wo-from", other)],
      "wo-into",
      "wo-from",
    )!;
    expect(mergeInvoiceNames(question)).toEqual({
      intoName: "Acme Travel SL · B11111111 · Spanish tax ID",
      fromName: "Acme Travel SL · B11111111 · Other document · France",
    });

    setLocale("es");
    expect(mergeInvoiceNames(question)).toEqual({
      intoName: "Acme Travel SL · B11111111 · NIF español",
      fromName: "Acme Travel SL · B11111111 · Otro documento · Francia",
    });
  });

  it("adds the issuing country when name, number and identifier type are the same", () => {
    const passport = (identifierCountryCode: string) => ({
      ...acme,
      identifierType: "passport" as const,
      identifierCountryCode,
    });
    const question = mergeInvoiceQuestion(
      [full("wo-into", passport("FR")), full("wo-from", passport("DE"))],
      "wo-into",
      "wo-from",
    )!;
    expect(mergeInvoiceNames(question)).toEqual({
      intoName: "Acme Travel SL · B11111111 · Passport · France",
      fromName: "Acme Travel SL · B11111111 · Passport · Germany",
    });
  });
});

describe("mergeInvoiceChoice", () => {
  it("names a simplified receiving bill as null and the merged-away customer as read", () => {
    const question = mergeInvoiceQuestion(
      [simplifiedInto, full("wo-from", acme)],
      "wo-into",
      "wo-from",
    )!;
    expect(mergeInvoiceChoice(question, "from")).toEqual({
      keep: "from",
      into: null,
      from: { taxId: "B11111111" },
    });
  });

  it("carries each customer's identifier type and country only when the bill holds them", () => {
    const passport = { ...acme, identifierType: "passport" as const, identifierCountryCode: "FR" };
    const question = mergeInvoiceQuestion(
      [full("wo-into", barSol), full("wo-from", passport)],
      "wo-into",
      "wo-from",
    )!;
    expect(mergeInvoiceChoice(question, "into")).toEqual({
      keep: "into",
      into: { taxId: "B22222222" },
      from: { taxId: "B11111111", identifierType: "passport", identifierCountryCode: "FR" },
    });
    expect(mergeInvoiceChoice(question, "from").keep).toBe("from");
  });
});
