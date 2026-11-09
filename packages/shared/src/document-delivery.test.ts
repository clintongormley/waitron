import { describe, expect, it } from "vitest";
import {
  canonicalDeliveryIntent,
  parseDeliveryIntent,
  parseInvoiceSave,
} from "./document-delivery.js";

const id = (n: number) => `aaaaaaaa-bbbb-cccc-dddd-${String(n).padStart(12, "0")}`;
const origin = { applianceId: id(1), nodeId: id(2), recoveryEpoch: id(3) };
const print = () => ({
  medium: "print" as const,
  origin: { ...origin },
  applianceId: id(1),
  saleId: id(4),
  document: "receipt" as const,
  printerId: id(5),
  language: "es",
  context: { surface: "till" as const, deviceId: id(6), profileId: id(7) },
  shownDesignation: "duplicate" as const,
  replacesAttemptId: null,
});
const email = () => ({
  medium: "email" as const,
  origin: { ...origin },
  applianceId: id(1),
  saleId: id(4),
  document: "invoice" as const,
  recipient: "Guest@Example.test",
  language: "es",
  context: { surface: "dashboard" as const, deviceId: null, profileId: null },
  shownDesignation: "original" as const,
  retryAttemptId: null,
});
const save = () => ({
  origin: { ...origin },
  applianceId: id(1),
  saveId: id(8),
  deviceId: id(6),
  expectedRevision: 0,
  selection: "default" as const,
});
const receipt = { printerKind: "receipt" as const };

describe("document routing contracts", () => {
  it("canonical intent includes every delivery fact", () => {
    const value = print();
    const encoded = canonicalDeliveryIntent(value, receipt);
    expect(JSON.parse(encoded)).toEqual({ version: 1, ...value, printerKind: "receipt" });
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    expect(canonicalDeliveryIntent(parseDeliveryIntent(reordered), receipt)).toBe(encoded);
    expect(
      canonicalDeliveryIntent({ ...value, origin: { ...origin, nodeId: id(9) } }, receipt),
    ).not.toBe(encoded);
    for (const field of ["applianceId", "nodeId", "recoveryEpoch"] as const) {
      expect(
        canonicalDeliveryIntent({ ...value, origin: { ...origin, [field]: id(9) } }, receipt),
      ).not.toBe(encoded);
    }
    for (const patch of [
      { applianceId: id(9) },
      { saleId: id(9) },
      { document: "invoice" as const },
      { printerId: id(9) },
      { language: "en" },
      { shownDesignation: "original" as const },
      { replacesAttemptId: id(9) },
      { context: { ...value.context, deviceId: id(9) } },
      { context: { ...value.context, profileId: id(9) } },
      { context: { ...value.context, surface: "dashboard" as const } },
      { context: { surface: "dashboard" as const, deviceId: null, profileId: null } },
    ]) {
      expect(canonicalDeliveryIntent({ ...value, ...patch }, receipt)).not.toBe(encoded);
    }
    expect(canonicalDeliveryIntent(value, { printerKind: "a4" })).not.toBe(encoded);
    const message = email();
    const emailText = canonicalDeliveryIntent(message, { printerKind: null });
    expect(JSON.parse(emailText)).toEqual({ version: 1, ...message, printerKind: null });
    expect(emailText).not.toBe(encoded);
    for (const patch of [{ recipient: "Other@Example.test" }, { retryAttemptId: id(9) }]) {
      expect(canonicalDeliveryIntent({ ...message, ...patch }, { printerKind: null })).not.toBe(
        emailText,
      );
    }
  });

  it("normalizes UUID spelling and recipient whitespace without folding the local part", () => {
    const value = print();
    const uppercase = JSON.parse(
      JSON.stringify(value).replaceAll("aaaaaaaa-bbbb-cccc-dddd", "AAAAAAAA-BBBB-CCCC-DDDD"),
    );
    expect(parseDeliveryIntent(uppercase)).toEqual(value);
    expect(canonicalDeliveryIntent(uppercase, receipt)).toBe(
      canonicalDeliveryIntent(value, receipt),
    );
    expect(parseDeliveryIntent({ ...email(), recipient: "  Guest@Example.test  " })).toEqual(
      email(),
    );
    expect(
      parseInvoiceSave({
        ...save(),
        saveId: id(8).toUpperCase(),
        selection: { id: id(5).toUpperCase() },
      }),
    ).toEqual({ ...save(), selection: { id: id(5) } });
    expect(parseInvoiceSave(save())).toEqual(save());
    expect(parseInvoiceSave({ ...save(), expectedRevision: Number.MAX_SAFE_INTEGER })).toEqual({
      ...save(),
      expectedRevision: Number.MAX_SAFE_INTEGER,
    });
  });

  const badDelivery: [string, unknown][] = [
    ["body", null],
    ["body", []],
    ["body", "print"],
    ["medium", { ...print(), medium: ["print"] }],
    ["medium", { ...print(), medium: "fax" }],
    ["document", { ...print(), document: "other" }],
    ["document", { ...email(), document: "receipt" }],
    ["shownDesignation", { ...print(), shownDesignation: "copy" }],
    ["language", { ...print(), language: null }],
    ["language", { ...print(), language: " " }],
    ["context", { ...print(), context: null }],
    ["context", { ...print(), context: [] }],
    ["context.surface", { ...print(), context: { ...print().context, surface: ["till"] } }],
    ["context.surface", { ...print(), context: { ...print().context, surface: "queue" } }],
    ["context.deviceId", { ...print(), context: { ...print().context, deviceId: null } }],
    ["context.profileId", { ...print(), context: { ...print().context, profileId: null } }],
    ["origin", { ...print(), origin: null }],
    ["origin", { ...print(), origin: [] }],
    ["recipient", { ...email(), recipient: "not-an-email" }],
    ["recipient", { ...email(), recipient: null }],
    ["replacesAttemptId", { ...print(), replacesAttemptId: "" }],
    ["retryAttemptId", { ...email(), retryAttemptId: "bad" }],
  ];
  for (const field of ["applianceId", "saleId", "printerId"] as const) {
    for (const invalid of [undefined, null, "bad", 1, [], ` ${id(1)}`]) {
      badDelivery.push([field, { ...print(), [field]: invalid }]);
    }
  }
  for (const field of ["applianceId", "nodeId", "recoveryEpoch"] as const) {
    for (const invalid of [undefined, null, "bad", []]) {
      badDelivery.push([
        `origin.${field}`,
        { ...print(), origin: { ...origin, [field]: invalid } },
      ]);
    }
  }
  it.each(badDelivery)("routing bodies reject coercion at %s (%j)", (field, value) => {
    expect(() => parseDeliveryIntent(value)).toThrow(new TypeError(field));
  });

  const badSave: [string, unknown][] = [
    ["body", null],
    ["body", []],
    ["origin", { ...save(), origin: null }],
    ...["applianceId", "saveId", "deviceId"].map((field): [string, unknown] => [
      field,
      { ...save(), [field]: "bad" },
    ]),
    ...[undefined, null, "0", -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].map(
      (expectedRevision): [string, unknown] => [
        "expectedRevision",
        { ...save(), expectedRevision },
      ],
    ),
    ["selection", { ...save(), selection: null }],
    ["selection", { ...save(), selection: [] }],
    ["selection", { ...save(), selection: "printer" }],
    ["selection.id", { ...save(), selection: { id: "bad" } }],
  ];
  it.each(badSave)("Invoice saves reject invalid %s (%j)", (field, value) => {
    expect(() => parseInvoiceSave(value)).toThrow(new TypeError(String(field)));
  });

  it("rejects missing nullable facts instead of silently defaulting them", () => {
    const missingReplacement: Record<string, unknown> = print();
    const missingRetry: Record<string, unknown> = email();
    delete missingReplacement.replacesAttemptId;
    delete missingRetry.retryAttemptId;
    expect(() => parseDeliveryIntent(missingReplacement)).toThrow(
      new TypeError("replacesAttemptId"),
    );
    expect(() => parseDeliveryIntent(missingRetry)).toThrow(new TypeError("retryAttemptId"));
    expect(() =>
      parseDeliveryIntent({ ...email(), context: { surface: "dashboard", deviceId: null } }),
    ).toThrow(new TypeError("context.profileId"));
  });

  it("drops extra input rather than retaining credentials in the canonical request", () => {
    expect(parseDeliveryIntent({ ...print(), token: "secret" })).toEqual(print());
    expect(parseInvoiceSave({ ...save(), token: "secret" })).toEqual(save());
  });

  it("refuses a resolved transport kind that contradicts the medium", () => {
    expect(() => canonicalDeliveryIntent(print(), { printerKind: null })).toThrow(
      new TypeError("printerKind"),
    );
    expect(() => canonicalDeliveryIntent(email(), receipt)).toThrow(new TypeError("printerKind"));
    expect(() => canonicalDeliveryIntent(print(), { printerKind: "fax" as "a4" })).toThrow(
      new TypeError("printerKind"),
    );
  });
});
