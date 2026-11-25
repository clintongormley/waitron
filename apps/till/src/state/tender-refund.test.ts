import { afterEach, describe, expect, it, vi } from "vitest";
import type { TillApi } from "../api/client.js";
import type {
  RefundableTender,
  TenderRefundRequest,
  TenderRefundView,
} from "../api/tender-refund-types.js";
import { TenderRefundAttempts, TenderRefundSession } from "./tender-refund.js";

const scope = { deviceId: "device-1", personId: "person-1" };
const other = { deviceId: "device-2", personId: "person-1" };
const ask = {
  tenderId: "tender-1",
  appliedAmount: "12.50",
  tipAmount: "0.00",
  reason: "Courtesy return",
};
const reply = (over: Partial<TenderRefundView> = {}): TenderRefundView => ({
  id: "refund-1",
  saleId: "sale-1",
  tenderId: "tender-1",
  state: "pending",
  appliedAmount: "12.50",
  tipAmount: "0.00",
  createdAt: "2026-10-16T10:00:00.000Z",
  completedAt: null,
  ...over,
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("keeps the balance explanation in memory without storing or resending a failed refund", async () => {
  const failed = reply({ state: "failed", refusalReason: "provider_balance_unavailable" });
  const api = {
    refundTransaction: vi.fn(async () => failed),
    getTenderRefund: vi.fn(async () => reply()),
    retryTenderRefund: vi.fn(async () => reply()),
  };
  const session = new TenderRefundSession(scope, api);
  await session.submit("sale-1", ask);
  expect(await session.resume("sale-1")).toMatchObject({
    state: "failed",
    refusalReason: "provider_balance_unavailable",
  });
  expect(session.read("sale-1")).toBeNull();
  const fresh = new TenderRefundSession(scope, api);
  expect(fresh.read("sale-1")).toBeNull();
  await expect(fresh.resume("sale-1")).rejects.toMatchObject({ kind: "missing" });
  expect(api.refundTransaction).toHaveBeenCalledTimes(1);
});

it.each([
  {
    label: "a submission id containing the PIN digits",
    submissionId: "a11234a4-2836-4178-8508-c9cdc414fead",
    unrelated: false,
  },
  {
    label: "unrelated storage containing the PIN digits",
    submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    unrelated: true,
  },
] as const)(
  "saves a normalized non-secret request before a lost answer and reuses it after reopening, with $label",
  async ({ submissionId, unrelated }) => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(submissionId);
    if (unrelated) localStorage.setItem("waitron.unrelated", "1234");
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const sent: TenderRefundRequest[] = [];
    const api = {
      refundTransaction: vi.fn(async (_sale: string, request: TenderRefundRequest) => {
        sent.push(structuredClone(request));
        expect(new TenderRefundAttempts().read(scope, "sale-1")!.request).toEqual({
          ...ask,
          manualConfirmed: false,
          submissionId: request.submissionId,
        });
        if (sent.length === 1) throw new TypeError("Lost response after acceptance");
        return reply();
      }),
      getTenderRefund: vi.fn(async () => reply()),
      retryTenderRefund: vi.fn(async () => reply()),
    };
    const first = new TenderRefundSession(scope, api);
    await expect(
      first.submit(
        "sale-1",
        { ...ask, appliedAmount: "012.5", reason: " Courtesy return " },
        { personId: "approver", pin: "1234" },
      ),
    ).rejects.toThrow("Lost response");
    const reopened = new TenderRefundSession(scope, api);
    expect(reopened.read("sale-1")!.request.submissionId).toBe(sent[0]!.submissionId);
    await reopened.resume("sale-1");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({
      ...ask,
      manualConfirmed: false,
      submissionId: sent[0]!.submissionId,
    });
    expect(sent[0]!.override).toEqual({ personId: "approver", pin: "1234" });
    const key = 'waitron.tender-refund:["device-1","person-1"]:"sale-1"';
    const expected = {
      version: 1,
      saleId: "sale-1",
      request: { ...ask, manualConfirmed: false, submissionId },
    };
    expect(writes.mock.calls).toEqual([
      [key, JSON.stringify({ ...expected, refundId: null })],
      [key, JSON.stringify({ ...expected, refundId: "refund-1" })],
    ]);
    const stored = localStorage.getItem(key)!;
    expect(stored).not.toContain('"1234"');
    expect(stored).not.toContain("override");
    expect(stored).not.toContain("approver");
    expect(reopened.read("sale-1")!.refundId).toBe("refund-1");
  },
);

it("uses status and same-attempt retry after the refund id is known, releasing only terminal results", async () => {
  const api = {
    refundTransaction: vi.fn(async () => reply()),
    getTenderRefund: vi.fn(async () => reply()),
    retryTenderRefund: vi.fn(async () =>
      reply({ state: "completed", completedAt: "2026-10-16T10:01:00Z" }),
    ),
  };
  const session = new TenderRefundSession(scope, api);
  await session.submit("sale-1", ask);
  const originalId = session.read("sale-1")!.request.submissionId;
  await new TenderRefundSession(scope, api).resume("sale-1");
  expect(api.refundTransaction).toHaveBeenCalledTimes(1);
  expect(api.getTenderRefund).toHaveBeenCalledExactlyOnceWith("refund-1");
  expect(session.read("sale-1")!.refundId).toBe("refund-1");
  await session.retry("sale-1", { personId: "supervisor", pin: "2222" });
  expect(api.retryTenderRefund).toHaveBeenCalledExactlyOnceWith("refund-1", {
    personId: "supervisor",
    pin: "2222",
  });
  expect(session.read("sale-1")).toBeNull();
  const next = new TenderRefundAttempts().prepare(scope, "sale-1", ask);
  expect(next.request.submissionId).toBeTypeOf("string");
  expect(next.request.submissionId).not.toBe(originalId);
});

it.each(["appliedAmount", "tipAmount", "reason", "tenderId", "manualConfirmed"] as const)(
  "locks changes to %s until the original request has a terminal result",
  (field) => {
    const store = new TenderRefundAttempts();
    const sent = store.prepare(scope, "sale-1", ask);
    const changes = {
      appliedAmount: "11.00",
      tipAmount: "1.00",
      reason: "Other",
      tenderId: "tender-2",
      manualConfirmed: true,
    };
    expect(() => store.prepare(scope, "sale-1", { ...ask, [field]: changes[field] })).toThrow(
      "locked",
    );
    expect(store.read(scope, "sale-1")).toEqual(sent);
  },
);

it("keeps normalized equivalents and ignores property order and transient authorization", () => {
  const store = new TenderRefundAttempts();
  const withTransientPin = { ...ask, override: { personId: "boss", pin: "9999" } };
  const one = store.prepare(scope, "sale-1", withTransientPin);
  const two = store.prepare(scope, "sale-1", {
    reason: " Courtesy return ",
    appliedAmount: "00012.50",
    tipAmount: "0",
    tenderId: "tender-1",
    manualConfirmed: false,
  });
  expect(two).toEqual(one);
  expect(Object.keys(one.request).sort()).toEqual([
    "appliedAmount",
    "manualConfirmed",
    "reason",
    "submissionId",
    "tenderId",
    "tipAmount",
  ]);
});

it("scopes requests by device, person and sale, and logout clears only that person's device data", () => {
  const store = new TenderRefundAttempts();
  const first = store.prepare(scope, "sale-1", ask);
  const second = store.prepare(other, "sale-1", ask);
  const third = store.prepare({ ...scope, personId: "person-2" }, "sale-1", ask);
  const fourth = store.prepare(scope, "sale-2", ask);
  localStorage.setItem("waitron.unrelated", "keep");
  expect(new Set([first, second, third, fourth].map((row) => row.request.submissionId)).size).toBe(
    4,
  );
  store.clear(scope);
  expect(store.read(scope, "sale-1")).toBeNull();
  expect(store.read(scope, "sale-2")).toBeNull();
  expect(store.read(other, "sale-1")).toEqual(second);
  expect(store.read({ ...scope, personId: "person-2" }, "sale-1")).toEqual(third);
  expect(localStorage.getItem("waitron.unrelated")).toBe("keep");
});

it("cannot collide device/person/sale boundaries in storage keys", () => {
  const store = new TenderRefundAttempts();
  const a = store.prepare({ deviceId: "a:b", personId: "c" }, "d", ask);
  const b = store.prepare({ deviceId: "a", personId: "b:c" }, "d", ask);
  expect(a.request.submissionId).not.toBe(b.request.submissionId);
  store.clear({ deviceId: "a:b", personId: "c" });
  expect(store.read({ deviceId: "a", personId: "b:c" }, "d")).toEqual(b);
});

it.each(["pending", "completed", "failed"] as const)(
  "ignores a late %s reply after logout and a replacement request",
  (state) => {
    const store = new TenderRefundAttempts();
    const old = store.prepare(scope, "sale-1", ask);
    store.clear(scope);
    store.answer(scope, old, reply({ state }));
    expect(store.read(scope, "sale-1")).toBeNull();
    const next = store.prepare(scope, "sale-1", ask);
    store.answer(scope, old, reply({ state }));
    expect(store.read(scope, "sale-1")).toEqual(next);
  },
);

it.each([
  { saleId: "foreign" },
  { tenderId: "foreign" },
  { appliedAmount: "9.00" },
  { tipAmount: "0.01" },
])("refuses a mismatched answer and retains the pending request: %j", (change) => {
  const store = new TenderRefundAttempts();
  const sent = store.prepare(scope, "sale-1", ask);
  expect(() => store.answer(scope, sent, reply(change))).toThrow("mismatch");
  expect(store.read(scope, "sale-1")).toEqual(sent);
});

it("refuses a different refund id once one has been learned", () => {
  const store = new TenderRefundAttempts();
  const sent = store.prepare(scope, "sale-1", ask);
  store.answer(scope, sent, reply());
  expect(() => store.answer(scope, sent, reply({ id: "refund-2", state: "failed" }))).toThrow(
    "mismatch",
  );
  expect(store.read(scope, "sale-1")!.refundId).toBe("refund-1");
});

it.each([
  "authorization.not_permitted",
  "pin.invalid",
  "session.expired",
  "server.internal",
  "submission.id_reused",
])("keeps unknown previous outcomes through the refusal %s", async (code) => {
  const api = {
    refundTransaction: vi.fn().mockRejectedValue({ code }),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toEqual({ code });
  const id = session.read("sale-1")!.request.submissionId;
  await expect(new TenderRefundSession(scope, api).resume("sale-1")).rejects.toEqual({ code });
  expect(api.refundTransaction.mock.calls.map((call) => call[1].submissionId)).toEqual([id, id]);
});

it("does not send when durable storage refuses the request", async () => {
  const api = { refundTransaction: vi.fn(), getTenderRefund: vi.fn(), retryTenderRefund: vi.fn() };
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("Quota full", "QuotaExceededError");
    },
  } as unknown as Storage;
  const session = new TenderRefundSession(scope, api, new TenderRefundAttempts(storage));
  await expect(session.submit("sale-1", ask)).rejects.toThrow("storage");
  expect(api.refundTransaction).not.toHaveBeenCalled();
});

it("does not replace unreadable saved data or silently dropped writes with a fresh attempt", async () => {
  const api = { refundTransaction: vi.fn(), getTenderRefund: vi.fn(), retryTenderRefund: vi.fn() };
  for (const data of ["{", "null", '{"version":2}', '{"version":1,"request":{}}']) {
    const storage = { getItem: () => data, setItem: vi.fn() } as unknown as Storage;
    const session = new TenderRefundSession(scope, api, new TenderRefundAttempts(storage));
    await expect(session.submit("sale-1", ask)).rejects.toThrow("storage");
    expect(storage.setItem).not.toHaveBeenCalled();
  }
  const dropped = { getItem: () => null, setItem: () => {} } as unknown as Storage;
  await expect(
    new TenderRefundSession(scope, api, new TenderRefundAttempts(dropped)).submit("sale-1", ask),
  ).rejects.toThrow("storage");
  expect(api.refundTransaction).not.toHaveBeenCalled();
});

it("blocks a second action while sending and releases busy after rejection", async () => {
  let refuse!: (reason: unknown) => void;
  const api = {
    refundTransaction: vi.fn(
      () =>
        new Promise<TenderRefundView>((_, reject) => {
          refuse = reject;
        }),
    ),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  const first = session.submit("sale-1", ask);
  await expect(session.submit("sale-1", ask)).rejects.toThrow("busy");
  await expect(session.resume("sale-1")).rejects.toThrow("busy");
  await expect(session.retry("sale-1")).rejects.toThrow("busy");
  refuse(new TypeError("Lost"));
  await expect(first).rejects.toThrow("Lost");
  api.refundTransaction.mockResolvedValue(reply());
  await session.resume("sale-1");
  expect(api.refundTransaction).toHaveBeenCalledTimes(2);
});

it("does not retry or resume an absent attempt", async () => {
  const api = { refundTransaction: vi.fn(), getTenderRefund: vi.fn(), retryTenderRefund: vi.fn() };
  const session = new TenderRefundSession(scope, api);
  await expect(session.resume("sale-1")).rejects.toThrow("missing");
  await expect(session.retry("sale-1")).rejects.toThrow("missing");
  expect(api.refundTransaction).not.toHaveBeenCalled();
  expect(api.getTenderRefund).not.toHaveBeenCalled();
  expect(api.retryTenderRefund).not.toHaveBeenCalled();
});

it.each([
  { appliedAmount: "0", tipAmount: "0" },
  { appliedAmount: "-1" },
  { tipAmount: "-0.01" },
  { appliedAmount: "0.001" },
  { appliedAmount: "1,000.00" },
  { appliedAmount: "abc" },
  { appliedAmount: "" },
  { reason: " " },
  { reason: "x".repeat(501) },
  { tenderId: "" },
  { manualConfirmed: null },
])("refuses malformed request %j without retaining or sending it", async (change) => {
  const api = { refundTransaction: vi.fn(), getTenderRefund: vi.fn(), retryTenderRefund: vi.fn() };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", { ...ask, ...change } as typeof ask)).rejects.toThrow(
    "invalid",
  );
  expect(session.read("sale-1")).toBeNull();
  expect(api.refundTransaction).not.toHaveBeenCalled();
});

it("an older saved attempt holding cashConfirmed drops it and is not locked", () => {
  const store = new TenderRefundAttempts();
  const sent = store.prepare(scope, "sale-1", ask);
  const key = localStorage.key(0)!;
  const saved = JSON.parse(localStorage.getItem(key)!) as { request: Record<string, unknown> };
  localStorage.setItem(
    key,
    JSON.stringify({ ...saved, request: { ...saved.request, cashConfirmed: true } }),
  );
  expect(localStorage.getItem(key)).toContain('"cashConfirmed":true');
  const read = store.read(scope, "sale-1")!;
  expect(read.request).not.toHaveProperty("cashConfirmed");
  expect(store.prepare(scope, "sale-1", ask).request.submissionId).toBe(sent.request.submissionId);
});

it.each(["completed", "failed"] as const)(
  "a known %s outcome releases the request even after reopening",
  async (state) => {
    const api = {
      refundTransaction: vi.fn(async () => reply()),
      getTenderRefund: vi.fn(async () => reply({ state })),
      retryTenderRefund: vi.fn(),
    };
    const session = new TenderRefundSession(scope, api);
    await session.submit("sale-1", ask);
    expect(await new TenderRefundSession(scope, api).resume("sale-1")).toEqual(reply({ state }));
    expect(session.read("sale-1")).toBeNull();
  },
);

it("retry before the id is known replays the same request with a fresh transient PIN", async () => {
  const requests: TenderRefundRequest[] = [];
  const api = {
    refundTransaction: vi.fn(async (_sale: string, request: TenderRefundRequest) => {
      requests.push(request);
      if (requests.length === 1) throw new DOMException("Timed out", "AbortError");
      return reply();
    }),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toThrow("Timed out");
  await new TenderRefundSession(scope, api).retry("sale-1", { personId: "boss", pin: "5467" });
  expect(requests[1]).toEqual({ ...requests[0], override: { personId: "boss", pin: "5467" } });
  expect(api.retryTenderRefund).not.toHaveBeenCalled();
});

it("logout while the send is out prevents its reply from repopulating the journal", async () => {
  let answer!: (value: TenderRefundView) => void;
  const api = {
    refundTransaction: vi.fn(
      () =>
        new Promise<TenderRefundView>((resolve) => {
          answer = resolve;
        }),
    ),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const store = new TenderRefundAttempts();
  const session = new TenderRefundSession(scope, api, store);
  const pending = session.submit("sale-1", ask);
  store.clear(scope);
  answer(reply());
  await pending;
  expect(session.read("sale-1")).toBeNull();
});

it.each([["an empty invoice correction id", { invoiceCorrectionId: "" }]])(
  "refuses to prepare an ask carrying %s",
  (_case, change) => {
    const store = new TenderRefundAttempts();
    expect(() =>
      store.prepare(scope, "sale-1", { ...ask, ...change } as unknown as typeof ask),
    ).toThrow("invalid");
  },
);

it("retains the server's twelve-digit money range and rejects a total above it", () => {
  const store = new TenderRefundAttempts();
  const sent = store.prepare(scope, "sale-1", {
    ...ask,
    appliedAmount: "999999999999.98",
    tipAmount: "0.01",
  });
  expect(sent.request.appliedAmount).toBe("999999999999.98");
  expect(() =>
    store.prepare(scope, "sale-2", { ...ask, appliedAmount: "999999999999.99", tipAmount: "0.01" }),
  ).toThrow("invalid");
});

it.each(["completed", "failed"] as const)(
  "a reopened caller of the same session can read the settled %s attempt without another money request",
  async (state) => {
    const terminal = reply({ state });
    const api = {
      refundTransaction: vi.fn(async () => terminal),
      getTenderRefund: vi.fn(),
      retryTenderRefund: vi.fn(),
    };
    const session = new TenderRefundSession(scope, api);
    await session.submit("sale-1", ask);
    expect(session.read("sale-1")).toBeNull();
    expect(await session.resume("sale-1")).toEqual(terminal);
    expect(await session.retry("sale-1")).toEqual(terminal);
    expect(api.refundTransaction).toHaveBeenCalledTimes(1);
    expect(api.getTenderRefund).not.toHaveBeenCalled();
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "allows correction after a definitive first refusal, PIN fallback=%s",
  async (fallback) => {
    const api = {
      refundTransaction: vi.fn(),
      getTenderRefund: vi.fn(),
      retryTenderRefund: vi.fn(),
    };
    const session = new TenderRefundSession(scope, api);
    if (fallback) {
      api.refundTransaction.mockRejectedValueOnce({ code: "authorization.not_permitted" });
      await expect(session.submit("sale-1", ask)).rejects.toMatchObject({
        code: "authorization.not_permitted",
      });
    }
    api.refundTransaction.mockRejectedValueOnce({ code: "tender.refund_exceeds_payment" });
    const denied = fallback
      ? session.retry("sale-1", { personId: "manager", pin: "0123" })
      : session.submit("sale-1", ask);
    await expect(denied).rejects.toMatchObject({ code: "tender.refund_exceeds_payment" });
    const firstId = api.refundTransaction.mock.calls[0]![1].submissionId;
    expect(session.read("sale-1")).toBeNull();
    api.refundTransaction.mockResolvedValueOnce(
      reply({ appliedAmount: "1.00", state: "completed" }),
    );
    await session.submit("sale-1", { ...ask, appliedAmount: "1.00" });
    expect(api.refundTransaction.mock.calls.at(-1)![1]).toMatchObject({ appliedAmount: "1.00" });
    expect(api.refundTransaction.mock.calls.at(-1)![1].submissionId).not.toBe(firstId);
  },
);
it("keeps an above-cancel request retryable with fresh approval", async () => {
  const api = {
    refundTransaction: vi
      .fn()
      .mockRejectedValueOnce({ code: "tender.refund_exceeds_cancelled" })
      .mockResolvedValueOnce(reply({ state: "completed" })),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject({
    code: "tender.refund_exceeds_cancelled",
  });
  const firstId = api.refundTransaction.mock.calls[0]![1].submissionId;
  expect(session.read("sale-1")?.request.submissionId).toBe(firstId);
  await session.retry("sale-1", { personId: "manager", pin: "0123" });
  expect(api.refundTransaction.mock.calls[1]![1]).toEqual({
    ...api.refundTransaction.mock.calls[0]![1],
    override: { personId: "manager", pin: "0123" },
  });
  expect(session.read("sale-1")).toBeNull();
});
it.each([false, true])(
  "retains an earlier unknown request through an amount refusal, reload=%s",
  async (reload) => {
    const api = {
      refundTransaction: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("lost answer"))
        .mockRejectedValueOnce({ code: "tender.refund_exceeds_payment" }),
      getTenderRefund: vi.fn(),
      retryTenderRefund: vi.fn(),
    };
    const first = new TenderRefundSession(scope, api);
    await expect(first.submit("sale-1", ask)).rejects.toThrow("lost answer");
    const saved = first.read("sale-1");
    const next = reload ? new TenderRefundSession(scope, api) : first;
    await expect(next.resume("sale-1")).rejects.toMatchObject({
      code: "tender.refund_exceeds_payment",
    });
    expect(next.read("sale-1")).toEqual(saved);
    await expect(next.submit("sale-1", { ...ask, appliedAmount: "1.00" })).rejects.toThrow(
      "locked",
    );
    expect(api.refundTransaction).toHaveBeenCalledTimes(2);
  },
);

it.each([
  "tender.refund_needs_correction",
  "tender.refund_of_advance",
  "advance.taken_off_final_invoice",
  "sale.correction_not_admitted",
])("drops an earlier unknown request once the server refuses it with %s", async (code) => {
  const api = {
    refundTransaction: vi
      .fn()
      .mockRejectedValueOnce(new TypeError("lost answer"))
      .mockRejectedValueOnce({ code })
      .mockResolvedValueOnce(reply({ appliedAmount: "1.00", state: "completed" })),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toThrow("lost answer");
  await expect(session.resume("sale-1")).rejects.toMatchObject({ code });
  expect(session.read("sale-1")).toBeNull();
  await session.submit("sale-1", { ...ask, appliedAmount: "1.00" });
  expect(api.refundTransaction).toHaveBeenCalledTimes(3);
});

it("frees the form for a tip alone once a refused filing refuses its payment money", async () => {
  const refusal = { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } };
  const api = {
    refundTransaction: vi
      .fn()
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce(
        reply({ appliedAmount: "0.00", tipAmount: "1.00", state: "completed" }),
      ),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject(refusal);
  expect(session.read("sale-1")).toBeNull();
  await session.submit("sale-1", { ...ask, appliedAmount: "0.00", tipAmount: "1.00" });
  expect(api.refundTransaction.mock.calls[1]![1]).toMatchObject({
    appliedAmount: "0.00",
    tipAmount: "1.00",
  });
});

it.each(["replacement", "pending"] as const)(
  "a late refusal never removes a %s record saved by another consumer",
  async (change) => {
    const attempts = new TenderRefundAttempts();
    let kept: ReturnType<TenderRefundAttempts["read"]>;
    const api = {
      refundTransaction: vi.fn(async () => {
        const sent = attempts.read(scope, "sale-1")!;
        if (change === "replacement") {
          attempts.clear(scope);
          attempts.prepare(scope, "sale-1", { ...ask, appliedAmount: "1.00" });
        } else attempts.answer(scope, sent, reply());
        kept = attempts.read(scope, "sale-1");
        throw { code: "tender.refund_exceeds_payment" };
      }),
      getTenderRefund: vi.fn(),
      retryTenderRefund: vi.fn(),
    };
    const session = new TenderRefundSession(scope, api, attempts);
    await expect(session.submit("sale-1", ask)).rejects.toMatchObject({
      code: "tender.refund_exceeds_payment",
    });
    expect(session.read("sale-1")).toEqual(kept!);
    expect(kept!).not.toBeNull();
  },
);

it.each([false, true])(
  "preserves an unknown request created by another consumer before prepare, interleave=%s",
  async (interleave) => {
    const attempts = new TenderRefundAttempts();
    const prepare = attempts.prepare.bind(attempts);
    let rejectOther!: (reason: unknown) => void;
    const otherApi = {
      refundTransaction: vi.fn(
        () =>
          new Promise<TenderRefundView>((_resolve, reject) => {
            rejectOther = reject;
          }),
      ),
      getTenderRefund: vi.fn(),
      retryTenderRefund: vi.fn(),
    };
    const other = new TenderRefundSession(scope, otherApi);
    let unknown: Promise<TenderRefundView> | undefined;
    let saved: ReturnType<TenderRefundAttempts["read"]> = null;
    vi.spyOn(attempts, "prepare").mockImplementationOnce((...args) => {
      if (interleave) {
        unknown = other.submit("sale-1", ask);
        saved = new TenderRefundAttempts().read(scope, "sale-1");
      }
      return prepare(...args);
    });
    const api = {
      refundTransaction: vi.fn().mockRejectedValue({ code: "tender.refund_exceeds_payment" }),
      getTenderRefund: vi.fn(),
      retryTenderRefund: vi.fn(),
    };
    const local = new TenderRefundSession(scope, api, attempts);
    try {
      await expect(local.submit("sale-1", ask)).rejects.toMatchObject({
        code: "tender.refund_exceeds_payment",
      });
      if (interleave) {
        expect(otherApi.refundTransaction).toHaveBeenCalledOnce();
        expect(api.refundTransaction.mock.calls[0]![1].submissionId).toBe(
          saved!.request.submissionId,
        );
        expect(local.read("sale-1")).toEqual(saved);
      } else expect(local.read("sale-1")).toBeNull();
    } finally {
      if (unknown) {
        rejectOther(new TypeError("lost other answer"));
        await unknown.catch(() => {});
      }
    }
  },
);

it("forgets on abandon a request only refusals for a right answered", async () => {
  const api = {
    refundTransaction: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toEqual({
    code: "authorization.not_permitted",
  });
  await expect(session.retry("sale-1", { personId: "m", pin: "1" })).rejects.toEqual({
    code: "authorization.not_permitted",
  });
  session.abandon("sale-1");
  expect(session.read("sale-1")).toBeNull();
});

it("says a saved request only refusals for a right answered is refused, and one ever lost is not", async () => {
  const api = {
    refundTransaction: vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce({ code: "authorization.not_permitted" }),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  expect(session.refusedOnly("sale-1")).toBe(false);
  await expect(session.submit("sale-1", ask)).rejects.toBeTruthy();
  expect(session.refusedOnly("sale-1")).toBe(true);
  expect(session.refusedOnly("sale-2")).toBe(false);
  expect(new TenderRefundSession(scope, api).refusedOnly("sale-1")).toBe(false);
  await expect(session.retry("sale-1")).rejects.toThrow("Failed to fetch");
  expect(session.refusedOnly("sale-1")).toBe(false);
  await expect(session.retry("sale-1")).rejects.toBeTruthy();
  expect(session.refusedOnly("sale-1")).toBe(false);
});

it("keeps on abandon a request whose answer was ever lost", async () => {
  const api = {
    refundTransaction: vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce({ code: "authorization.not_permitted" }),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toThrow("Failed to fetch");
  session.abandon("sale-1");
  expect(session.read("sale-1")).not.toBeNull();
  await expect(session.retry("sale-1")).rejects.toEqual({ code: "authorization.not_permitted" });
  session.abandon("sale-1");
  expect(session.read("sale-1")).not.toBeNull();
});

it("keeps on abandon a request while it is being sent", async () => {
  let answer!: (error: unknown) => void;
  const api = {
    refundTransaction: vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (answer = reject))),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toBeTruthy();
  const sending = session.retry("sale-1", { personId: "m", pin: "1" });
  session.abandon("sale-1");
  expect(session.read("sale-1")).not.toBeNull();
  answer(new TypeError("Failed to fetch"));
  await expect(sending).rejects.toThrow("Failed to fetch");
  expect(session.read("sale-1")).not.toBeNull();
});

it("forgets a first request refused because another refund on the payment waits", async () => {
  const api = {
    refundTransaction: vi.fn().mockRejectedValue({ code: "tender.refund_in_progress" }),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toEqual({
    code: "tender.refund_in_progress",
  });
  expect(session.read("sale-1")).toBeNull();
});

it("keeps a request refused because another refund waits after its answer was lost", async () => {
  const api = {
    refundTransaction: vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce({ code: "tender.refund_in_progress" }),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
  const session = new TenderRefundSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toThrow("Failed to fetch");
  await expect(session.retry("sale-1")).rejects.toEqual({ code: "tender.refund_in_progress" });
  expect(session.read("sale-1")).not.toBeNull();
});

describe("having the box ask the card company again about what waits on a receipt", () => {
  const row = (over: Partial<RefundableTender> = {}): RefundableTender => ({
    tenderId: "tender-1",
    method: "card",
    last4: "4242",
    appliedRemaining: "0.00",
    tipRemaining: "0.00",
    pendingRefundId: "refund-1",
    manual: false,
    ...over,
  });
  const CARDS = ["integrated-card-payment"];
  const fakeApi = () => ({
    refundTransaction: vi.fn(async () => reply()),
    getTenderRefund: vi.fn(async () => reply()),
    retryTenderRefund: vi.fn<TillApi["retryTenderRefund"]>(async (id) =>
      reply({ id, state: "completed", completedAt: "2026-10-16T10:01:00Z" }),
    ),
  });

  it("asks under each waiting refund's own id with the approver's PIN, and nothing about the rest", async () => {
    const api = fakeApi();
    const session = new TenderRefundSession(scope, api);
    const approver = { personId: "boss", pin: "1234" };
    const answers = await session.askAgain(
      [
        row({ tenderId: "settled", pendingRefundId: null }),
        row(),
        row({ tenderId: "tender-2", pendingRefundId: "refund-2", last4: null }),
      ],
      CARDS,
      approver,
    );
    expect(api.retryTenderRefund.mock.calls).toEqual([
      ["refund-1", approver],
      ["refund-2", approver],
    ]);
    expect(answers).toMatchObject([
      { id: "refund-1", state: "completed", last4: "4242" },
      { id: "refund-2", state: "completed", last4: null },
    ]);
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("asks nothing for a payment this device's profile does not take", async () => {
    const api = fakeApi();
    const session = new TenderRefundSession(scope, api);
    expect(await session.askAgain([row()], ["take-cash"])).toEqual([]);
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
  });

  it("settles the request this device saved for the refund, and leaves another alone", async () => {
    const api = fakeApi();
    const session = new TenderRefundSession(scope, api);
    await session.submit("sale-1", ask);
    await session.askAgain([row({ pendingRefundId: "refund-2" })], CARDS);
    expect(session.read("sale-1")).not.toBeNull();
    api.retryTenderRefund.mockResolvedValueOnce(reply());
    await session.askAgain([row()], CARDS);
    expect(session.read("sale-1")?.refundId).toBe("refund-1");
    await session.askAgain([row()], CARDS);
    expect(session.read("sale-1")).toBeNull();
    expect((await session.resume("sale-1")).state).toBe("completed");
  });

  it("answers what the card company said though the saved request cannot be read", async () => {
    const session = new TenderRefundSession(scope, fakeApi());
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    expect(await session.askAgain([row()], CARDS)).toMatchObject([{ state: "completed" }]);
  });

  it("refuses an answer that is not the refund this device saved", async () => {
    const api = fakeApi();
    const session = new TenderRefundSession(scope, api);
    await session.submit("sale-1", ask);
    api.retryTenderRefund.mockResolvedValueOnce(reply({ tenderId: "tender-9" }));
    await expect(session.askAgain([row()], CARDS)).rejects.toMatchObject({ kind: "mismatch" });
    expect(session.read("sale-1")).not.toBeNull();
  });

  it("asks about a refund once while that is out", async () => {
    const api = fakeApi();
    let answer!: (value: TenderRefundView) => void;
    api.retryTenderRefund.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const session = new TenderRefundSession(scope, api);
    const out = session.askAgain([row()], CARDS);
    await expect(session.askAgain([row()], CARDS)).rejects.toMatchObject({ kind: "busy" });
    answer(reply());
    expect(await out).toMatchObject([{ state: "pending" }]);
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
  });

  it("keeps an outcome already had when a later refund is refused, and throws the refusal when it has none", async () => {
    const api = fakeApi();
    const session = new TenderRefundSession(scope, api);
    const refusal = { code: "authorization.not_permitted", permission: "sale.refund" };
    const both = [row(), row({ tenderId: "tender-2", pendingRefundId: "refund-2" })];
    api.retryTenderRefund.mockResolvedValueOnce(reply()).mockRejectedValueOnce(refusal);
    await expect(session.askAgain(both, CARDS)).rejects.toBe(refusal);
    api.retryTenderRefund
      .mockResolvedValueOnce(reply({ state: "failed" }))
      .mockRejectedValueOnce(refusal);
    expect(await session.askAgain(both, CARDS)).toMatchObject([{ state: "failed" }]);
  });

  it.each(
    (["completed", "failed"] as const).flatMap((state) =>
      ["session.required", "session.not_open"].map((code) => [state, code] as const),
    ),
  )(
    "throws a later refund's refusal for an ended sign-in though one was answered %s (%s), settling that one",
    async (state, code) => {
      const api = fakeApi();
      const session = new TenderRefundSession(scope, api);
      await session.submit("sale-1", ask);
      const ended = { code, status: 401 };
      api.retryTenderRefund.mockResolvedValueOnce(reply({ state })).mockRejectedValueOnce(ended);
      await expect(
        session.askAgain(
          [row(), row({ tenderId: "tender-2", pendingRefundId: "refund-2" })],
          CARDS,
        ),
      ).rejects.toBe(ended);
      expect(session.read("sale-1")).toBeNull();
    },
  );

  it("asks about no further refund once its window is gone, and answers those asked", async () => {
    const api = fakeApi();
    let open = true;
    api.retryTenderRefund.mockImplementationOnce(async (id) => {
      open = false;
      return reply({ id, state: "completed" });
    });
    const answers = await new TenderRefundSession(scope, api).askAgain(
      [row(), row({ tenderId: "tender-2", pendingRefundId: "refund-2" })],
      CARDS,
      { personId: "boss", pin: "1234" },
      () => open,
    );
    expect(answers).toMatchObject([{ id: "refund-1", state: "completed" }]);
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
  });
});
