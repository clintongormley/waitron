import { afterEach, expect, it, vi } from "vitest";
import type { TenderRefundRequest, TenderRefundView } from "../api/tender-refund-types.js";
import { TenderRefundAttempts, TenderRefundSession } from "./tender-refund.js";

const scope = { deviceId: "device-1", personId: "person-1" };
const other = { deviceId: "device-2", personId: "person-1" };
const ask = {
  tenderId: "tender-1",
  appliedAmount: "12.50",
  tipAmount: "0.00",
  reason: "Courtesy return",
  cashConfirmed: true,
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

it("saves a normalized non-secret request before a lost answer and reuses it after reopening", async () => {
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
  expect(sent[1]).toEqual({ ...ask, manualConfirmed: false, submissionId: sent[0]!.submissionId });
  expect(sent[0]!.override).toEqual({ personId: "approver", pin: "1234" });
  const stored = JSON.stringify(Object.values(localStorage));
  expect(stored).not.toContain("1234");
  expect(stored).not.toContain("override");
  expect(stored).not.toContain("approver");
  expect(reopened.read("sale-1")!.refundId).toBe("refund-1");
});

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

it.each([
  "appliedAmount",
  "tipAmount",
  "reason",
  "tenderId",
  "cashConfirmed",
  "manualConfirmed",
] as const)("locks changes to %s until the original request has a terminal result", (field) => {
  const store = new TenderRefundAttempts();
  const sent = store.prepare(scope, "sale-1", ask);
  const changes = {
    appliedAmount: "11.00",
    tipAmount: "1.00",
    reason: "Other",
    tenderId: "tender-2",
    cashConfirmed: false,
    manualConfirmed: true,
  };
  expect(() => store.prepare(scope, "sale-1", { ...ask, [field]: changes[field] })).toThrow(
    "locked",
  );
  expect(store.read(scope, "sale-1")).toEqual(sent);
});

it("keeps normalized equivalents and ignores property order and transient authorization", () => {
  const store = new TenderRefundAttempts();
  const withTransientPin = { ...ask, override: { personId: "boss", pin: "9999" } };
  const one = store.prepare(scope, "sale-1", withTransientPin);
  const two = store.prepare(scope, "sale-1", {
    reason: " Courtesy return ",
    appliedAmount: "00012.50",
    tipAmount: "0",
    tenderId: "tender-1",
    cashConfirmed: true,
    manualConfirmed: false,
  });
  expect(two).toEqual(one);
  expect(Object.keys(one.request).sort()).toEqual([
    "appliedAmount",
    "cashConfirmed",
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
  { cashConfirmed: "true" },
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
