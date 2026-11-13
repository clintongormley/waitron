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
