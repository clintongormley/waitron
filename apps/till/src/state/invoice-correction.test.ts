import { afterEach, expect, it, vi } from "vitest";
import type { InvoiceCorrectionCashRequest } from "../api/invoice-correction-types.js";
import type { TenderRefundRequest, TenderRefundView } from "../api/tender-refund-types.js";
import { InvoiceCorrectionSession } from "./invoice-correction.js";
import { TenderRefundAttempts, TenderRefundSession } from "./tender-refund.js";

const scope = { deviceId: "device-1", personId: "person-1" };
const pin = { personId: "manager", pin: "0123" };
const cashAsk = { amount: "5.00" };
const correction = { id: "correction-1" } as never;
const cashGiven = { correction, refunds: [], replayed: false };
const refusal = (code: string, status = 409) => ({ code, status });
const lost = () => new TypeError("Failed to fetch");

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

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

const send = (s: InvoiceCorrectionSession, override?: typeof pin) =>
  s.giveCash("correction-1", cashAsk, override);
const saved = (s: InvoiceCorrectionSession) => s.savedCash("correction-1");
const ok = cashGiven;

it("cash: saves the id before sending and replays it after a lost answer, then forgets it", async () => {
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
});

it("cash: a retry refused authorization or trading keeps the saved id for the next try", async () => {
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
});

it("cash: a refused first send or a correction refusal on a retry lets a new attempt start", async () => {
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
});

it("refuses a different amount of cash on the same correction while one waits for its answer", async () => {
  const h = harness([lost()]);
  await expect(send(h.session)).rejects.toThrow("Failed to fetch");
  await expect(h.session.giveCash("correction-1", { amount: "1.00" })).rejects.toMatchObject({
    kind: "locked",
  });
  expect(h.api.giveInvoiceCorrectionCash).toHaveBeenCalledTimes(1);
});

it("is wiped with the refund journal when its person signs out", async () => {
  const h = harness([lost()]);
  await expect(send(h.session)).rejects.toThrow();
  localStorage.setItem("waitron.other", "kept");
  new TenderRefundAttempts().clear(scope);
  expect(saved(h.session)).toBeNull();
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
  await expect(send(h.session)).rejects.toThrow();
  const key = Object.keys(localStorage).find((k) => k.includes("invoice-correction-cash"))!;
  localStorage.setItem(key, JSON.stringify({ version: 2, request: {} }));
  await expect(send(h.session)).rejects.toMatchObject({ kind: "storage" });
  expect(h.api.giveInvoiceCorrectionCash).toHaveBeenCalledTimes(1);
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
      giveInvoiceCorrectionCash: vi.fn((_id: string, request: InvoiceCorrectionCashRequest) =>
        call(request),
      ),
    },
  };
}

it("cash: refuses a second send while one waits for its answer", async () => {
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
});

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

it("retries a cash leg whose amount is written another way under its first id", async () => {
  const h = harness([lost(), cashGiven]);
  await expect(h.session.giveCash("correction-1", { amount: "5.00" })).rejects.toThrow();
  await h.session.giveCash("correction-1", { amount: "5" });
  expect(h.sent[1]).toEqual(h.sent[0]);
});

it("answers a served cash leg even when its saved entry turned unreadable meanwhile, and keeps that entry", async () => {
  const h = harness([]);
  const unreadable = JSON.stringify({ version: 2, request: {} });
  let key = "";
  h.api.giveInvoiceCorrectionCash.mockImplementationOnce(async () => {
    key = Object.keys(localStorage).find((k) => k.includes("invoice-correction-cash"))!;
    localStorage.setItem(key, unreadable);
    return cashGiven as never;
  });
  await expect(send(h.session)).resolves.toEqual(cashGiven);
  expect(localStorage.getItem(key)).toBe(unreadable);
});
