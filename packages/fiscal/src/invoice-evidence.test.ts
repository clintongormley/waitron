import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readInvoiceEvidence,
  readInvoiceEvidenceReport,
  rememberInvoiceEvidence,
} from "./invoice-evidence.js";

const observation = {
  taxpayerId: "B12345674",
  environment: "production",
  series: "A-0CNNY",
  invoiceNumber: "A-0CNNY/9007199254740993",
  issuedDate: "2026-10-16",
  fingerprint: "A".repeat(64),
};
const storedKey = 'waitron.invoiceEvidence.v1:["B12345674","production","A-0CNNY"]';
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reports only matching taxpayer/environment observations under their own series key", () => {
  rememberInvoiceEvidence({ invoiceEvidence: { ...observation, operatorPin: "secret" } });
  rememberInvoiceEvidence({
    ticket: { invoiceEvidence: { ...observation, series: "Z", invoiceNumber: "Z/1" } },
  });
  rememberInvoiceEvidence({
    invoice: { invoiceEvidence: { ...observation, taxpayerId: "OTHER" } },
  });
  rememberInvoiceEvidence({ invoiceEvidence: { ...observation, environment: "preproduction" } });
  values.set(
    'waitron.invoiceEvidence.v1:["B12345674","production","COPIED"]',
    JSON.stringify(observation),
  );
  values.set("unrelated", "secret");
  values.set('waitron.invoiceEvidence.v1:["B12345674","production","BROKEN"]', "{");
  const before = [...values];
  expect(readInvoiceEvidenceReport(observation)).toEqual([
    observation,
    { ...observation, series: "Z", invoiceNumber: "Z/1" },
  ]);
  expect([...values]).toEqual(before);
  expect(readInvoiceEvidence(observation)).toEqual(observation);
});

it("sorts a returning device's report independently of browser key order", () => {
  rememberInvoiceEvidence({
    invoiceEvidence: { ...observation, series: "Z", invoiceNumber: "Z/9" },
  });
  rememberInvoiceEvidence({ invoiceEvidence: observation });
  rememberInvoiceEvidence({
    invoiceEvidence: { ...observation, series: "B", invoiceNumber: "B/2" },
  });
  expect(readInvoiceEvidenceReport(observation).map((value) => value.invoiceNumber)).toEqual([
    "A-0CNNY/9007199254740993",
    "B/2",
    "Z/9",
  ]);
});

it("keeps the higher exact counter when a completed invoice is replayed", () => {
  rememberInvoiceEvidence({ invoiceEvidence: observation });
  rememberInvoiceEvidence({
    invoiceEvidence: { ...observation, invoiceNumber: "A-0CNNY/9007199254740992" },
  });
  expect(readInvoiceEvidence(observation)).toEqual(observation);
  rememberInvoiceEvidence({
    invoiceEvidence: { ...observation, invoiceNumber: "A-0CNNY/9007199254740994" },
  });
  expect(readInvoiceEvidence(observation)?.invoiceNumber).toBe("A-0CNNY/9007199254740994");
});

it.each([
  undefined,
  null,
  [],
  "success",
  {},
  { ticket: null },
  ...[
    null,
    [],
    {},
    { ...observation, invoiceNumber: "OTHER/1" },
    { ...observation, invoiceNumber: "A-0CNNY/0" },
    { ...observation, invoiceNumber: "A-0CNNY/1.2" },
    { ...observation, issuedDate: "not-a-date" },
    { ...observation, issuedDate: "2026-02-30" },
    { ...observation, issuedDate: "9999-99-99" },
    ...["taxpayerId", "environment", "series", "fingerprint"].map((field) => ({
      ...observation,
      [field]: "",
    })),
    ...["taxpayerId", "environment", "series", "invoiceNumber", "issuedDate", "fingerprint"].map(
      (field) => ({ ...observation, [field]: 42 }),
    ),
  ].map((invoiceEvidence) => ({ invoiceEvidence })),
])("ignores a response without usable invoice facts: %j", (response) => {
  rememberInvoiceEvidence(response);
  expect([...values]).toEqual([]);
  expect(readInvoiceEvidenceReport(observation)).toEqual([]);
});

it.each([
  null,
  "{",
  "null",
  "[]",
  "{}",
  JSON.stringify({ ...observation, taxpayerId: "OTHER" }),
  JSON.stringify({ ...observation, environment: "preproduction" }),
  JSON.stringify({ ...observation, series: "Z", invoiceNumber: "Z/1" }),
])("treats missing, corrupt and copied storage as unknown: %s", (stored) => {
  if (stored !== null) values.set(storedKey, stored);
  expect(readInvoiceEvidence(observation)).toBeUndefined();
  expect(readInvoiceEvidenceReport(observation)).toEqual([]);
  rememberInvoiceEvidence({ invoiceEvidence: observation });
  expect(readInvoiceEvidenceReport(observation)).toEqual([observation]);
});

it.each(["getItem", "setItem", "key", "length"])("keeps storage.%s failures optional", (method) => {
  if (method === "length")
    vi.spyOn(localStorage, "length", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
  else
    vi.spyOn(localStorage, method as "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
  expect(() => rememberInvoiceEvidence({ invoiceEvidence: observation })).not.toThrow();
  expect(() => readInvoiceEvidence(observation)).not.toThrow();
  expect(readInvoiceEvidenceReport(observation)).toEqual([]);
});

it("keeps access to a refused storage global optional", () => {
  vi.stubGlobal("localStorage", undefined);
  expect(() => rememberInvoiceEvidence({ invoiceEvidence: observation })).not.toThrow();
  expect(readInvoiceEvidence(observation)).toBeUndefined();
  expect(readInvoiceEvidenceReport(observation)).toEqual([]);
});

it("ignores a key or value removed during enumeration", () => {
  values.set(storedKey, JSON.stringify(observation));
  vi.spyOn(localStorage, "key").mockReturnValueOnce(null);
  expect(readInvoiceEvidenceReport(observation)).toEqual([]);
  vi.spyOn(localStorage, "getItem").mockReturnValueOnce(null);
  expect(readInvoiceEvidenceReport(observation)).toEqual([]);
});
