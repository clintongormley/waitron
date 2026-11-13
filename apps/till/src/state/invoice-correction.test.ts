import { afterEach, expect, it, vi } from "vitest";
import type {
  InvoiceCorrectionCashRequest,
  InvoiceCorrectionRequest,
} from "../api/invoice-correction-types.js";
import type { TenderRefundRequest, TenderRefundView } from "../api/tender-refund-types.js";
import { InvoiceCorrectionSession } from "./invoice-correction.js";
import { TenderRefundAttempts, TenderRefundSession } from "./tender-refund.js";

const scope = { deviceId: "device-1", personId: "person-1" };
const pin = { personId: "manager", pin: "0123" };
const openAsk = {
  gross: "12.10",
  lineIds: ["line-1"],
  reasonId: "reason-1",
  note: null,
  expectedSplit: [{ rate: "21.00", base: "10.00", tax: "2.10" }],
};
const correction = { id: "correction-1" } as never;
const cashGiven = { correction, refunds: [], replayed: false };
const refusal = (code: string, status = 409, params = {}) => ({ ...params, code, status });
const lost = () => new TypeError("Failed to fetch");

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Both requests, driven the same way: `send` makes one call, `saved` reads the journal. */
function harness(answers: Array<unknown>) {
  const sent: Array<{ submissionId: string; override?: unknown }> = [];
  const savedWhenSent: Array<string | undefined> = [];
  const answer = (request: { submissionId: string }) => {
    sent.push(structuredClone(request));
    const next = answers.shift();
    if (next instanceof Error || (typeof next === "object" && next !== null && "code" in next))
      throw next;
    return next;
  };
  const api = {
    openInvoiceCorrection: vi.fn(async (_sale: string, request: InvoiceCorrectionRequest) => {
      savedWhenSent.push(session.savedOpen("sale-1")?.submissionId);
      return answer(request) as never;
    }),
    giveInvoiceCorrectionCash: vi.fn(async (_id: string, request: InvoiceCorrectionCashRequest) => {
      savedWhenSent.push(session.savedCash("correction-1")?.submissionId);
      return answer(request) as never;
    }),
  };
  const session = new InvoiceCorrectionSession(scope, api);
  return {
    api,
    sent,
    savedWhenSent,
    session,
    reopen: () => new InvoiceCorrectionSession(scope, api),
  };
}

const kinds = [
  {
    kind: "open",
    send: (s: InvoiceCorrectionSession, override?: typeof pin) =>
      s.open("sale-1", openAsk, override),
    saved: (s: InvoiceCorrectionSession) => s.savedOpen("sale-1"),
    ok: { correction, replayed: false },
  },
  {
    kind: "cash",
    send: (s: InvoiceCorrectionSession, override?: typeof pin) =>
      s.giveCash("correction-1", { amount: "5.00" }, override),
    saved: (s: InvoiceCorrectionSession) => s.savedCash("correction-1"),
    ok: { correction, refunds: [], replayed: false },
  },
] as const;

it.each(kinds)(
  "$kind: saves the id before sending and replays it after a lost answer, then forgets it",
  async ({ send, saved, ok }) => {
    const h = harness([lost(), ok]);
    await expect(send(h.session, pin)).rejects.toThrow("Failed to fetch");
    const reopened = h.reopen();
    expect(saved(reopened)?.submissionId).toBe(h.sent[0]!.submissionId);
    await send(reopened);
    expect(h.sent.map((r) => r.submissionId)).toEqual([
      h.sent[0]!.submissionId,
      h.sent[0]!.submissionId,
    ]);
    expect(h.savedWhenSent).toEqual([h.sent[0]!.submissionId, h.sent[0]!.submissionId]);
    expect(h.sent[0]!.override).toEqual(pin);
    expect(JSON.stringify(localStorage)).not.toContain("0123");
    expect(saved(reopened)).toBeNull();
  },
);

it.each(kinds)(
  "$kind: a retry refused authorization or trading keeps the saved id for the next try",
  async ({ send, saved, ok }) => {
    const h = harness([
      refusal("server.internal", 503),
      refusal("authorization.not_permitted", 403),
      refusal("trading.closed", 409),
      ok,
    ]);
    await expect(send(h.session)).rejects.toMatchObject({ code: "server.internal" });
    await expect(send(h.session)).rejects.toMatchObject({ code: "authorization.not_permitted" });
    await expect(send(h.session)).rejects.toMatchObject({ code: "trading.closed" });
    const id = h.sent[0]!.submissionId;
    expect(saved(h.session)?.submissionId).toBe(id);
    await send(h.session, pin);
    expect(new Set(h.sent.map((r) => r.submissionId))).toEqual(new Set([id]));
    expect(h.sent[3]!.override).toEqual(pin);
  },
);

it.each(kinds)(
  "$kind: a refused first send or a correction refusal on a retry lets a new attempt start",
  async ({ send, saved }) => {
    const h = harness([
      refusal("authorization.not_permitted", 403),
      lost(),
      refusal("invoice_correction.money_short"),
      lost(),
      refusal("sale.correction_amount_invalid"),
    ]);
    await expect(send(h.session)).rejects.toMatchObject({ status: 403 });
    expect(saved(h.session)).toBeNull();
    await expect(send(h.session)).rejects.toThrow("Failed to fetch");
    await expect(send(h.session)).rejects.toMatchObject({
      code: "invoice_correction.money_short",
    });
    expect(saved(h.session)).toBeNull();
    await expect(send(h.session)).rejects.toThrow("Failed to fetch");
    await expect(send(h.session)).rejects.toMatchObject({ code: "sale.correction_amount_invalid" });
    expect(saved(h.session)).toBeNull();
    expect(h.sent[0]!.submissionId).not.toBe(h.sent[1]!.submissionId);
    expect(h.sent[2]!.submissionId).toBe(h.sent[1]!.submissionId);
    expect(h.sent[4]!.submissionId).toBe(h.sent[3]!.submissionId);
    expect(h.sent[3]!.submissionId).not.toBe(h.sent[2]!.submissionId);
  },
);

it("refuses a different open of the same invoice while one waits for its answer", async () => {
  const h = harness([lost()]);
  await expect(h.session.open("sale-1", openAsk)).rejects.toThrow("Failed to fetch");
  await expect(h.session.open("sale-1", { ...openAsk, gross: "1.00" })).rejects.toMatchObject({
    kind: "locked",
  });
  expect(h.api.openInvoiceCorrection).toHaveBeenCalledTimes(1);
});

it("resumes the open correction a retry's already-open refusal names and never opens another", async () => {
  const h = harness([
    lost(),
    refusal("invoice_correction.already_open", 409, {
      saleId: "sale-1",
      correctionId: "correction-9",
    }),
  ]);
  await expect(h.session.open("sale-1", openAsk)).rejects.toThrow("Failed to fetch");
  expect(await h.session.open("sale-1", openAsk)).toEqual({
    correctionId: "correction-9",
    opened: null,
  });
  expect(h.session.savedOpen("sale-1")).toBeNull();
  expect(h.api.openInvoiceCorrection).toHaveBeenCalledTimes(2);
});

it("answers the correction an open made", async () => {
  const h = harness([{ correction, replayed: true }]);
  expect(await h.session.open("sale-1", openAsk)).toEqual({
    correctionId: "correction-1",
    opened: { correction, replayed: true },
  });
});

it("is wiped with the refund journal when its person signs out", async () => {
  const h = harness([lost(), lost()]);
  await expect(h.session.open("sale-1", openAsk)).rejects.toThrow();
  await expect(h.session.giveCash("correction-1", { amount: "5.00" })).rejects.toThrow();
  localStorage.setItem("waitron.other", "kept");
  new TenderRefundAttempts().clear(scope);
  expect(h.session.savedOpen("sale-1")).toBeNull();
  expect(h.session.savedCash("correction-1")).toBeNull();
  expect(localStorage.getItem("waitron.other")).toBe("kept");
});

it("sends a card leg's correction through the refund journal and keeps it on replay", async () => {
  const view: TenderRefundView = {
    id: "refund-1",
    saleId: "sale-1",
    tenderId: "tender-1",
    state: "pending",
    appliedAmount: "5.00",
    tipAmount: "0.00",
    createdAt: "2026-11-12T10:00:00.000Z",
    completedAt: null,
  };
  const sent: TenderRefundRequest[] = [];
  const api = {
    refundTransaction: vi.fn(async (_sale: string, request: TenderRefundRequest) => {
      sent.push(structuredClone(request));
      if (sent.length === 1) throw lost();
      return view;
    }),
    getTenderRefund: vi.fn(async () => view),
    retryTenderRefund: vi.fn(async () => view),
  };
  const leg = {
    tenderId: "tender-1",
    appliedAmount: "5.00",
    tipAmount: "0.00",
    reason: "Corrective invoice",
    invoiceCorrectionId: "Correction-1",
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", leg)).rejects.toThrow();
  await expect(
    session.submit("sale-1", { ...leg, invoiceCorrectionId: "correction-2" }),
  ).rejects.toMatchObject({ kind: "locked" });
  await new TenderRefundSession(scope, api).resume("sale-1");
  expect(sent.map((r) => r.invoiceCorrectionId)).toEqual(["correction-1", "correction-1"]);
  expect(sent[1]!.submissionId).toBe(sent[0]!.submissionId);
});

it("refuses to send over a saved entry it cannot read", async () => {
  const h = harness([lost()]);
  await expect(h.session.open("sale-1", openAsk)).rejects.toThrow();
  const key = Object.keys(localStorage).find((k) => k.includes("invoice-correction-open"))!;
  localStorage.setItem(key, JSON.stringify({ version: 2, request: {} }));
  await expect(h.session.open("sale-1", openAsk)).rejects.toMatchObject({ kind: "storage" });
  expect(h.api.openInvoiceCorrection).toHaveBeenCalledTimes(1);
});

it.each([
  { label: "a first send", before: [] },
  { label: "a retry", before: [lost()] },
])(
  "releases a card leg's refund entry when $label is refused for a correction reason, keeping other refusals on a retry",
  async ({ before }) => {
    const answers: unknown[] = [
      ...before,
      refusal("invoice_correction.leg_too_large"),
      lost(),
      refusal("authorization.not_permitted", 403),
    ];
    const api = {
      refundTransaction: vi.fn(async () => {
        const next = answers.shift();
        throw next;
      }),
      getTenderRefund: vi.fn(),
      retryTenderRefund: vi.fn(),
    };
    const leg = {
      tenderId: "tender-1",
      appliedAmount: "5.00",
      tipAmount: "0.00",
      reason: "Corrective invoice",
      invoiceCorrectionId: "correction-1",
    };
    const session = new TenderRefundSession(scope, api);
    if (before.length > 0) await expect(session.submit("sale-1", leg)).rejects.toThrow();
    await expect(session.submit("sale-1", leg)).rejects.toMatchObject({
      code: "invoice_correction.leg_too_large",
    });
    expect(session.read("sale-1")).toBeNull();
    const plain = { ...leg, invoiceCorrectionId: undefined, appliedAmount: "4.00" };
    await expect(session.submit("sale-1", plain)).rejects.toThrow("Failed to fetch");
    await expect(session.submit("sale-1", plain)).rejects.toMatchObject({
      code: "authorization.not_permitted",
    });
    expect(session.read("sale-1")?.request.appliedAmount).toBe("4.00");
  },
);

/** An api whose every call waits until the test answers it. */
function waitingApi() {
  const calls: Array<{
    request: { submissionId: string };
    answer: (value: unknown) => void;
    refuse: (error: unknown) => void;
  }> = [];
  const call = (request: { submissionId: string }) =>
    new Promise<never>((answer, refuse) =>
      calls.push({ request: structuredClone(request), answer: answer as never, refuse }),
    );
  return {
    calls,
    api: {
      openInvoiceCorrection: vi.fn((_sale: string, request: InvoiceCorrectionRequest) =>
        call(request),
      ),
      giveInvoiceCorrectionCash: vi.fn((_id: string, request: InvoiceCorrectionCashRequest) =>
        call(request),
      ),
    },
  };
}

it.each(kinds)(
  "$kind: refuses a second send while one waits for its answer",
  async ({ send, ok }) => {
    const w = waitingApi();
    const session = new InvoiceCorrectionSession(scope, w.api);
    const first = send(session);
    await expect(send(session)).rejects.toMatchObject({ kind: "busy" });
    expect(w.calls).toHaveLength(1);
    w.calls[0]!.answer(ok);
    await first;
    const next = send(session);
    expect(w.calls).toHaveLength(2);
    w.calls[1]!.answer(ok);
    await next;
  },
);

it.each([
  { label: "answer", late: (call: { answer: (v: unknown) => void }) => call.answer(cashGiven) },
  {
    label: "correction refusal",
    late: (call: { refuse: (e: unknown) => void }) =>
      call.refuse(refusal("invoice_correction.not_open")),
  },
])(
  "a late $label to an earlier send leaves a newer request's saved id in place",
  async ({ late }) => {
    const w = waitingApi();
    const tab = new InvoiceCorrectionSession(scope, w.api);
    const otherTab = new InvoiceCorrectionSession(scope, w.api);
    const ask = { amount: "1.00" };
    const first = tab.giveCash("correction-1", ask);
    const repeat = otherTab.giveCash("correction-1", ask);
    expect(w.calls[1]!.request.submissionId).toBe(w.calls[0]!.request.submissionId);
    w.calls[0]!.answer(cashGiven);
    await first;
    const next = tab.giveCash("correction-1", ask);
    const nextId = w.calls[2]!.request.submissionId;
    expect(nextId).not.toBe(w.calls[0]!.request.submissionId);
    late(w.calls[1]!);
    await repeat.catch(() => undefined);
    w.calls[2]!.refuse(lost());
    await expect(next).rejects.toThrow("Failed to fetch");
    expect(tab.savedCash("correction-1")?.submissionId).toBe(nextId);
  },
);

it("retries an open rebuilt in another key, line and split order under its first id, sending the saved request", async () => {
  const h = harness([lost(), { correction, replayed: true }]);
  const first = {
    gross: "12.10",
    lineIds: ["line-1", "line-2"],
    reasonId: "reason-1",
    note: null,
    expectedSplit: [
      { rate: "10.00", base: "5.00", tax: "0.50" },
      { rate: "21.00", base: "5.37", tax: "1.13" },
    ],
  };
  await expect(h.session.open("sale-1", first)).rejects.toThrow("Failed to fetch");
  const rebuilt = {
    expectedSplit: [
      { tax: "1.13", base: "5.37", rate: "21.00" },
      { rate: "10.00", base: "5.00", tax: "0.50" },
    ],
    note: null,
    reasonId: "REASON-1",
    lineIds: ["LINE-2", "line-1"],
    gross: "12.10",
  };
  await expect(h.session.open("sale-1", rebuilt)).resolves.toMatchObject({
    correctionId: "correction-1",
  });
  expect(h.sent[1]).toEqual(h.sent[0]);
});

it("retries a cash leg whose amount is written another way under its first id", async () => {
  const h = harness([lost(), cashGiven]);
  await expect(h.session.giveCash("correction-1", { amount: "5.00" })).rejects.toThrow();
  await h.session.giveCash("correction-1", { amount: "5" });
  expect(h.sent[1]).toEqual(h.sent[0]);
});

it.each([
  { label: "amount", change: { gross: "12.00" } },
  { label: "lines", change: { lineIds: ["line-1", "line-2"] } },
  { label: "split", change: { expectedSplit: [{ rate: "10.00", base: "11.00", tax: "1.10" }] } },
  { label: "reason", change: { reasonId: "reason-2" } },
  { label: "note", change: { note: "Wrong dish" } },
])("still refuses an open whose $label changed while one waits", async ({ change }) => {
  const h = harness([lost()]);
  await expect(h.session.open("sale-1", openAsk)).rejects.toThrow("Failed to fetch");
  await expect(h.session.open("sale-1", { ...openAsk, ...change })).rejects.toMatchObject({
    kind: "locked",
  });
  expect(h.api.openInvoiceCorrection).toHaveBeenCalledTimes(1);
});

it("answers a served open even when its saved entry turned unreadable meanwhile, and keeps that entry", async () => {
  const h = harness([]);
  const unreadable = JSON.stringify({ version: 2, request: {} });
  let key = "";
  h.api.openInvoiceCorrection.mockImplementationOnce(async () => {
    key = Object.keys(localStorage).find((k) => k.includes("invoice-correction-open"))!;
    localStorage.setItem(key, unreadable);
    return { correction, replayed: false } as never;
  });
  await expect(h.session.open("sale-1", openAsk)).resolves.toEqual({
    correctionId: "correction-1",
    opened: { correction, replayed: false },
  });
  expect(localStorage.getItem(key)).toBe(unreadable);
});

it("refuses to send over a saved entry whose request it cannot compare", async () => {
  const h = harness([lost()]);
  await expect(h.session.open("sale-1", openAsk)).rejects.toThrow();
  const key = Object.keys(localStorage).find((k) => k.includes("invoice-correction-open"))!;
  const saved = JSON.parse(localStorage.getItem(key)!) as { request: object };
  localStorage.setItem(
    key,
    JSON.stringify({ ...saved, request: { ...saved.request, reasonId: 7 } }),
  );
  await expect(h.session.open("sale-1", openAsk)).rejects.toMatchObject({ kind: "storage" });
  expect(h.api.openInvoiceCorrection).toHaveBeenCalledTimes(1);
});
