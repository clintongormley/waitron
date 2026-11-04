import { afterEach, describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";
import { readInvoiceEvidenceReport } from "@waitron/fiscal/src/invoice-evidence.js";
import {
  readInvoiceEvidence,
  rememberInvoiceEvidence,
  type InvoiceEvidence,
} from "./invoice-evidence.js";

const evidence: InvoiceEvidence = {
  taxpayerId: "89890001K",
  environment: "production",
  series: "ABCD",
  invoiceNumber: "ABCD/12",
  issuedDate: "2026-11-04",
  fingerprint: "A".repeat(64),
};
const key = 'waitron.invoiceEvidence.v1:["89890001K","production","ABCD"]';
const ownedKeys = new Set([key]);
function storageKey(value: InvoiceEvidence): string {
  const result = `waitron.invoiceEvidence.v1:${JSON.stringify([value.taxpayerId, value.environment, value.series])}`;
  ownedKeys.add(result);
  return result;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const item of ownedKeys) localStorage.removeItem(item);
});

function ticket(value: InvoiceEvidence) {
  return {
    invoiceEvidence: value,
    invoiceNumber: value.invoiceNumber,
    issuedAt: "2026-11-04T10:00:00.000Z",
    total: "12.10",
    orderLabel: null,
    orderNumber: 3,
    lines: [],
    vatBreakdown: [],
    tender: { method: "cash", change: "0.00" },
    qr: "",
    locale: "en",
  };
}

describe("optional device invoice evidence", () => {
  it("retains a received receipt across client instances without another server read", async () => {
    const response = ticket(evidence);
    const api = new TillApi("", async () => new Response(JSON.stringify(response)));
    expect(await api.getFiledTicket("order-1")).toEqual(response);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(evidence);
    expect(readInvoiceEvidence(evidence)).toEqual(evidence);
    const freshApi = new TillApi("", async () => {
      throw new Error("offline");
    });
    await expect(freshApi.getFiledTicket("order-1")).rejects.toThrow("offline");
    expect(readInvoiceEvidence(evidence)).toEqual(evidence);
  });

  it("keeps an embedded captured-card ticket", () => {
    rememberInvoiceEvidence({ outcome: "captured", ticket: ticket(evidence) });
    expect(readInvoiceEvidence(evidence)).toEqual(evidence);
  });

  it("keeps separate taxpayer, environment and series histories", () => {
    const variants = [
      evidence,
      { ...evidence, taxpayerId: "other-taxpayer" },
      { ...evidence, environment: "preproduction" },
      { ...evidence, series: "OTHER", invoiceNumber: "OTHER/4" },
    ];
    for (const value of variants) {
      storageKey(value);
      rememberInvoiceEvidence(ticket(value));
    }
    for (const value of variants) expect(readInvoiceEvidence(value)).toEqual(value);
  });

  it("does not replace a later invoice with a replayed or reprinted earlier one", () => {
    rememberInvoiceEvidence(ticket({ ...evidence, invoiceNumber: "ABCD/9007199254740993" }));
    rememberInvoiceEvidence(ticket({ ...evidence, invoiceNumber: "ABCD/9007199254740992" }));
    expect(readInvoiceEvidence(evidence)?.invoiceNumber).toBe("ABCD/9007199254740993");
  });

  it.each([
    null,
    "{",
    "null",
    "[]",
    "{}",
    JSON.stringify({ ...evidence, taxpayerId: "someone-else" }),
    JSON.stringify({ ...evidence, issuedDate: "2026-02-30" }),
  ])("treats missing or damaged storage as no evidence: %s", (stored) => {
    if (stored !== null) localStorage.setItem(key, stored);
    expect(readInvoiceEvidence(evidence)).toBeUndefined();
    rememberInvoiceEvidence(ticket(evidence));
    expect(readInvoiceEvidence(evidence)).toEqual(evidence);
  });

  it.each([
    null,
    [],
    {},
    { ...evidence, invoiceNumber: "DIFFERENT/12" },
    { ...evidence, invoiceNumber: "ABCD/0" },
    { ...evidence, invoiceNumber: "ABCD/1.2" },
    { ...evidence, fingerprint: "" },
    { ...evidence, issuedDate: "not-a-date" },
    { ...evidence, issuedDate: "2026-02-30" },
    { ...evidence, taxpayerId: "" },
    { ...evidence, environment: "" },
    { ...evidence, series: "" },
  ])("ignores malformed receipt evidence without clearing saved evidence: %j", (value) => {
    localStorage.setItem(key, JSON.stringify(evidence));
    rememberInvoiceEvidence({ invoiceEvidence: value });
    expect(readInvoiceEvidence(evidence)).toEqual(evidence);
  });

  it("treats a copied value under a different scope key as unknown", () => {
    const other = { ...evidence, taxpayerId: "other-taxpayer" };
    localStorage.setItem(storageKey(other), JSON.stringify(evidence));
    expect(readInvoiceEvidence(other)).toBeUndefined();
  });

  it.each(["getItem", "setItem"] as const)(
    "returns the successful receipt when storage.%s is unavailable",
    async (method) => {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("storage unavailable");
      });
      const response = ticket(evidence);
      const api = new TillApi("", async () => new Response(JSON.stringify(response)));
      expect(await api.getFiledTicket("order-1")).toEqual(response);
      if (method === "getItem") expect(readInvoiceEvidence(evidence)).toBeUndefined();
    },
  );

  it("returns a successful receipt when access to the storage global is refused", async () => {
    vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    const response = ticket(evidence);
    expect(
      await new TillApi("", async () => new Response(JSON.stringify(response))).getFiledTicket(
        "order-1",
      ),
    ).toEqual(response);
    expect(readInvoiceEvidence(evidence)).toBeUndefined();
  });

  it("never saves evidence from a refused HTTP response", async () => {
    const api = new TillApi(
      "",
      async () => new Response(JSON.stringify(ticket(evidence)), { status: 409 }),
    );
    await expect(api.getFiledTicket("order-1")).rejects.toMatchObject({ status: 409 });
    expect(localStorage.getItem(key)).toBeNull();
  });
});

it("retains only invoice evidence, without the rest of the receipt or unknown fields", () => {
  rememberInvoiceEvidence({
    ...ticket(evidence),
    invoiceEvidence: { ...evidence, operatorPin: "test-secret" },
    recipient: { taxId: "customer" },
  });
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(evidence);
});

it.each(["taxpayerId", "environment", "series", "invoiceNumber", "issuedDate", "fingerprint"])(
  "discards evidence whose %s has the wrong type",
  (field) => {
    rememberInvoiceEvidence({ invoiceEvidence: { ...evidence, [field]: 42 } });
    expect(localStorage.getItem(key)).toBeNull();
  },
);

it.each([undefined, null, [], "success", { ticket: null }])(
  "ignores a response without a receipt: %j",
  (answer) => {
    rememberInvoiceEvidence(answer);
    expect(localStorage.getItem(key)).toBeNull();
  },
);

it("keeps an old series as an observation while a new device joins and reads a recovered series", async () => {
  rememberInvoiceEvidence(ticket(evidence));
  const recovered = { ...evidence, series: "FRESH", invoiceNumber: "FRESH/1" };
  storageKey(recovered);
  const requests: Array<{
    path: string;
    method: string | undefined;
    body: BodyInit | null | undefined;
  }> = [];
  const api = new TillApi("", async (input, init) => {
    requests.push({ path: String(input), method: init?.method, body: init?.body });
    return new Response(
      JSON.stringify(
        String(input) === "/api/device/join"
          ? { joinId: "join-1", verificationNumber: "42" }
          : ticket(recovered),
      ),
    );
  });
  expect(await api.join("Fresh device")).toEqual({ joinId: "join-1", verificationNumber: "42" });
  expect(await api.getFiledTicket("recovered-order")).toEqual(ticket(recovered));
  expect(requests).toEqual([
    { path: "/api/device/join", method: "POST", body: JSON.stringify({ name: "Fresh device" }) },
    { path: "/api/sales/recovered-order", method: "GET", body: undefined },
  ]);
  expect(readInvoiceEvidence(evidence)).toEqual(evidence);
  expect(readInvoiceEvidence(recovered)).toEqual(recovered);
});

it("retains the invoice embedded in a completed bill payment", () => {
  rememberInvoiceEvidence({ invoice: ticket(evidence) });
  expect(readInvoiceEvidence(evidence)).toEqual(evidence);
});

it("makes a received till invoice available to the recovery report without another network request", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(ticket(evidence))));
  await new TillApi("", fetch).getFiledTicket("order-for-recovery");
  expect(readInvoiceEvidenceReport({ taxpayerId: "89890001K", environment: "production" })).toEqual(
    [evidence],
  );
  expect(
    readInvoiceEvidenceReport({ taxpayerId: "89890001K", environment: "preproduction" }),
  ).toEqual([]);
  expect(readInvoiceEvidenceReport({ taxpayerId: "OTHER", environment: "production" })).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
