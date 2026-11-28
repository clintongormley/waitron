import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GiveBackAsk,
  GiveBackOutcome,
  GiveBackPreview,
  GiveBackRequest,
  GiveBackWrite,
} from "../api/give-back-types.js";
import { GiveBackSession } from "./give-back.js";

type GiveBackRetry = (
  refundId: string,
  override?: { personId: string; pin: string },
) => Promise<{ state: string; refusalReason?: "provider_balance_unavailable" }>;

const scope = { deviceId: "device-1", personId: "person-1" };
const request: GiveBackRequest = {
  purpose: "dishes",
  lineIds: ["line-2", "line-1"],
  amount: "20.00",
  extra: "0.00",
  way: "card-1",
};
const ask: GiveBackAsk = {
  request,
  reasonId: "reason-1",
  note: null,
  expected: [
    { kind: "refund", amount: "8.00", way: "card-1" },
    { kind: "correction", amount: "12.00", way: "card-1", lineIds: ["line-1"] },
  ],
};
const outcome = (over: Partial<GiveBackOutcome> = {}): GiveBackOutcome => ({
  parts: [
    { kind: "refund", amount: "8.00", state: "completed", refundId: "refund-1" },
    { kind: "correction", amount: "12.00", state: "completed", correctionId: "c-1" },
  ],
  refusal: null,
  underWay: null,
  rest: null,
  ...over,
});
const rest: GiveBackRequest = {
  purpose: "dishes",
  lineIds: ["line-1"],
  amount: "12.00",
  extra: "0.00",
  way: "card-1",
};
const pendingWithRest = outcome({
  parts: [
    { kind: "refund", amount: "8.00", state: "pending", refundId: "refund-1" },
    { kind: "correction", amount: "12.00", state: "not_started" },
  ],
  rest,
});
const restPreview: GiveBackPreview = {
  parts: [{ kind: "correction", amount: "12.00", way: "card-1", lineIds: ["line-1"] }],
  leftUnderWay: "0.00",
  needs: [],
  manual: false,
};

const sent = (api: ReturnType<typeof fakeApi>, index: number) => api.giveBack.mock.calls[index]![1];

function fakeApi() {
  const sent: GiveBackWrite[] = [];
  return {
    sent,
    giveBack: vi.fn(async (_saleId: string, body: GiveBackWrite): Promise<GiveBackOutcome> => {
      sent.push(structuredClone(body));
      return outcome();
    }),
    previewGiveBack: vi.fn(async (): Promise<GiveBackPreview> => restPreview),
    getTenderRefund: vi.fn(async () => ({ state: "completed" as string })),
    retryTenderRefund: vi.fn<GiveBackRetry>(async () => ({ state: "pending" })),
  };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("saves the request and its ids before sending, and keeps no PIN", async () => {
  const api = fakeApi();
  api.giveBack.mockImplementationOnce(async (_saleId, body) => {
    const saved = new GiveBackSession(scope, api).read("sale-1")!;
    expect(saved.sent).toEqual({
      ...ask,
      submissionIds: body.submissionIds,
      needs: [],
      firstSendRefused: false,
      refusal: null,
    });
    expect(JSON.stringify(localStorage)).not.toContain("1234");
    throw new TypeError("lost answer");
  });
  const session = new GiveBackSession(scope, api);
  await expect(
    session.submit("sale-1", ask, { personId: "boss", pin: "1234" }),
  ).rejects.toBeInstanceOf(TypeError);
  const ids = api.giveBack.mock.calls[0]![1].submissionIds;
  expect(new Set(Object.values(ids)).size).toBe(4);
  expect(api.giveBack.mock.calls[0]![1].override).toEqual({ personId: "boss", pin: "1234" });
});

it("sends a lost answer again with the same ids, also after reopening, then forgets it", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce(new TypeError("lost answer"));
  await expect(new GiveBackSession(scope, api).submit("sale-1", ask)).rejects.toThrow(
    "lost answer",
  );
  const reopened = new GiveBackSession(scope, api);
  expect(reopened.read("sale-1")?.sent?.request).toEqual(request);
  expect(await reopened.resend("sale-1")).toEqual(outcome());
  expect(api.giveBack).toHaveBeenCalledTimes(2);
  expect(api.giveBack.mock.calls[1]![1].submissionIds).toEqual(
    api.giveBack.mock.calls[0]![1].submissionIds,
  );
  expect(reopened.read("sale-1")).toBeNull();
});

it("pressing again with the same request after a lost answer reuses its ids", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce(new TypeError("lost answer"));
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toThrow();
  await session.submit("sale-1", {
    ...ask,
    request: { ...request, lineIds: ["line-1", "line-2"] },
  });
  expect(api.giveBack.mock.calls[1]![1].submissionIds).toEqual(
    api.giveBack.mock.calls[0]![1].submissionIds,
  );
});

it("refuses a different request while an earlier one's answer is unknown", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce(new TypeError("lost answer"));
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toThrow();
  await expect(
    session.submit("sale-1", { ...ask, request: { ...request, amount: "19.00" } }),
  ).rejects.toMatchObject({ kind: "locked" });
  expect(api.giveBack).toHaveBeenCalledTimes(1);
});

it.each(["give_back.changed", "sale.correction_not_admitted", "clock.unconfirmed"])(
  "forgets a press the server refused with %s, so a changed press gets fresh ids",
  async (code) => {
    const api = fakeApi();
    api.giveBack.mockRejectedValueOnce({ code, status: 409 });
    const session = new GiveBackSession(scope, api);
    await expect(session.submit("sale-1", ask)).rejects.toMatchObject({ code });
    expect(session.read("sale-1")).toBeNull();
    await session.submit("sale-1", { ...ask, request: { ...request, amount: "19.00" } });
    expect(api.giveBack.mock.calls[1]![1].submissionIds.refund).not.toBe(
      api.giveBack.mock.calls[0]![1].submissionIds.refund,
    );
  },
);

it("sends a press refused for a PIN again with the same ids once a PIN is given", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce({ code: "authorization.not_permitted", status: 403 });
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject({
    code: "authorization.not_permitted",
  });
  await session.submit("sale-1", ask, { personId: "boss", pin: "1234" });
  expect(api.giveBack.mock.calls[1]![1].submissionIds).toEqual(
    api.giveBack.mock.calls[0]![1].submissionIds,
  );
});

it("keeps a press refused for its PIN while it is sent again with one, so reopening cannot forget it", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce({ code: "authorization.not_permitted", status: 403 });
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject({
    code: "authorization.not_permitted",
  });
  let answer!: (value: GiveBackOutcome) => void;
  api.giveBack.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  const out = session.submit("sale-1", ask, { personId: "boss", pin: "1234" });
  const ids = sent(api, 0).submissionIds;

  session.abandon("sale-1");
  new GiveBackSession(scope, api).abandon("sale-1");
  expect(session.read("sale-1")?.sent?.submissionIds).toEqual(ids);
  await expect(
    session.submit("sale-1", { ...ask, request: { ...request, amount: "19.00" } }),
  ).rejects.toMatchObject({ kind: "busy" });
  answer(outcome());
  expect(await out).toEqual(outcome());
  expect(await session.resend("sale-1", undefined, ids)).toEqual(outcome());
  expect(api.giveBack).toHaveBeenCalledTimes(2);
});

it("marks a press refused again for its PIN as refused once more, so it may still be forgotten", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce({ code: "authorization.not_permitted", status: 403 });
  api.giveBack.mockRejectedValueOnce({ code: "pin.invalid", status: 403 });
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject({
    code: "authorization.not_permitted",
  });
  await expect(
    session.submit("sale-1", ask, { personId: "boss", pin: "0000" }),
  ).rejects.toMatchObject({ code: "pin.invalid" });
  expect(session.read("sale-1")?.sent?.firstSendRefused).toBe(true);
  session.abandon("sale-1");
  expect(session.read("sale-1")).toBeNull();
});

it("lets a first press refused for its PIN be changed", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce({ code: "pin.invalid", status: 403 });
  const session = new GiveBackSession(scope, api);
  await expect(
    session.submit("sale-1", ask, { personId: "boss", pin: "0000" }),
  ).rejects.toMatchObject({ code: "pin.invalid" });
  await session.submit("sale-1", { ...ask, request: { ...request, amount: "19.00" } });
  expect(api.giveBack).toHaveBeenCalledTimes(2);
});

it("keeps a rest after a pending part, and sends it with fresh ids once the card company answered", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  const saved = new GiveBackSession(scope, api).read("sale-1")!;
  expect(saved.sent).toBeNull();
  expect(saved.rest).toEqual({
    request: rest,
    reasonId: "reason-1",
    note: null,
    waitFor: "refund-1",
    amount: "8.00",
    way: "card-1",
  });

  const checked = await session.checkRest("sale-1");
  expect(api.getTenderRefund).toHaveBeenCalledWith("refund-1", {});
  expect(checked).toEqual({ state: "completed", preview: restPreview });
  expect(api.previewGiveBack).toHaveBeenCalledWith("sale-1", rest);

  await session.sendRest("sale-1", restPreview);
  const first = api.giveBack.mock.calls[0]![1].submissionIds;
  const second = api.giveBack.mock.calls[1]![1];
  expect(second).toMatchObject({
    request: rest,
    reasonId: "reason-1",
    expected: restPreview.parts,
  });
  for (const id of Object.values(second.submissionIds))
    expect(Object.values(first)).not.toContain(id);
  expect(session.read("sale-1")).toBeNull();
});

it("sends a rest's lost answer again with the rest's own ids", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  api.giveBack.mockRejectedValueOnce(new TypeError("lost answer"));
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  await expect(session.sendRest("sale-1", restPreview)).rejects.toThrow("lost answer");
  await session.resend("sale-1");
  expect(api.giveBack.mock.calls[2]![1].submissionIds).toEqual(
    api.giveBack.mock.calls[1]![1].submissionIds,
  );
});

it("keeps the rest when its send is refused as changed", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  api.giveBack.mockRejectedValueOnce({ code: "give_back.changed", status: 409 });
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  await expect(session.sendRest("sale-1", restPreview)).rejects.toMatchObject({
    code: "give_back.changed",
  });
  expect(session.read("sale-1")).toEqual({
    saleId: "sale-1",
    sent: null,
    rest: {
      request: rest,
      reasonId: "reason-1",
      note: null,
      waitFor: "refund-1",
      amount: "8.00",
      way: "card-1",
    },
  });
});

it("says a rest still waits while the card company has not answered", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  api.getTenderRefund.mockResolvedValueOnce({ state: "pending" });
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  expect(await session.checkRest("sale-1")).toEqual({ state: "pending" });
  expect(api.previewGiveBack).not.toHaveBeenCalled();
});

it("has the box ask the card company again about the same refund while it waits, with the approver's PIN, and takes its answer", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  api.getTenderRefund.mockResolvedValue({ state: "pending" });
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  const approver = { personId: "boss", pin: "1234" };

  expect(await session.checkRest("sale-1")).toEqual({ state: "pending" });
  api.retryTenderRefund.mockResolvedValueOnce({ state: "completed" });
  expect(await session.checkRest("sale-1", approver)).toEqual({
    state: "completed",
    preview: restPreview,
  });
  expect(api.retryTenderRefund.mock.calls).toEqual([
    ["refund-1", undefined],
    ["refund-1", approver],
  ]);
  expect(api.giveBack).toHaveBeenCalledOnce();
});

it.each(["completed", "failed"])(
  "only reads a refund the box already knows is %s, asking the card company nothing",
  async (state) => {
    const api = fakeApi();
    api.giveBack.mockResolvedValueOnce(pendingWithRest);
    api.getTenderRefund.mockResolvedValueOnce({ state });
    const session = new GiveBackSession(scope, api);
    await session.submit("sale-1", ask);
    expect(await session.checkRest("sale-1")).toMatchObject({ state });
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
  },
);

it("forgets a rest whose refund the asked card company did not make, saying why when it says", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  api.getTenderRefund.mockResolvedValueOnce({ state: "pending" });
  api.retryTenderRefund.mockResolvedValueOnce({
    state: "failed",
    refusalReason: "provider_balance_unavailable",
  });
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  expect(await session.checkRest("sale-1")).toEqual({
    state: "failed",
    refusalReason: "provider_balance_unavailable",
  });
  expect(session.read("sale-1")).toBeNull();
});

it.each([
  ["refused", { code: "authorization.not_permitted", permission: "sale.refund" }],
  ["lost", new TypeError("Failed to fetch")],
])(
  "keeps the rest when the box's asking again is %s, so it can be asked again",
  async (_, error) => {
    const api = fakeApi();
    api.giveBack.mockResolvedValueOnce(pendingWithRest);
    api.getTenderRefund.mockResolvedValue({ state: "pending" });
    api.retryTenderRefund.mockRejectedValueOnce(error);
    const session = new GiveBackSession(scope, api);
    await session.submit("sale-1", ask);
    const saved = session.read("sale-1");
    await expect(session.checkRest("sale-1")).rejects.toBe(error);
    expect(session.read("sale-1")).toEqual(saved);
    api.retryTenderRefund.mockResolvedValueOnce({ state: "completed" });
    expect(await session.checkRest("sale-1")).toMatchObject({ state: "completed" });
    expect(api.retryTenderRefund.mock.calls.map(([id]) => id)).toEqual(["refund-1", "refund-1"]);
  },
);

it("asks the card company nothing, and keeps the rest, once its window is gone while the refund's state is read", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  let read!: (value: { state: string }) => void;
  api.getTenderRefund.mockImplementationOnce(() => new Promise((resolve) => (read = resolve)));
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  const saved = session.read("sale-1");
  let open = true;
  const out = session.checkRest("sale-1", { personId: "boss", pin: "1234" }, () => open);
  await vi.waitFor(() => expect(api.getTenderRefund).toHaveBeenCalledOnce());
  open = false;
  read({ state: "pending" });
  expect(await out).toEqual({ state: "pending" });
  expect(api.retryTenderRefund).not.toHaveBeenCalled();
  expect(session.read("sale-1")).toEqual(saved);
});

it("asks about a waiting refund once while that is out, and answers it though it cannot be forgotten afterwards", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce({ ...pendingWithRest, rest: null });
  api.getTenderRefund.mockResolvedValueOnce({ state: "pending" });
  let answer!: (value: { state: string }) => void;
  api.retryTenderRefund.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  const out = session.checkRest("sale-1");
  await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
  await expect(session.checkRest("sale-1")).rejects.toMatchObject({ kind: "busy" });
  expect(api.getTenderRefund).toHaveBeenCalledOnce();

  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  answer({ state: "completed" });
  expect(await out).toEqual({ state: "completed", preview: null });
  expect(api.retryTenderRefund).toHaveBeenCalledOnce();
});

it.each([
  ["a press with no answer", () => Promise.reject(new TypeError("Failed to fetch"))],
  [
    "another refund left waiting",
    async () =>
      outcome({
        parts: [{ kind: "refund", amount: "5.00", state: "pending", refundId: "refund-2" }],
      }),
  ],
])(
  "leaves %s saved since the device locked alone when the old asking is answered",
  async (_what, next) => {
    const api = fakeApi();
    api.giveBack.mockResolvedValueOnce(pendingWithRest);
    api.getTenderRefund.mockResolvedValueOnce({ state: "pending" });
    let answer!: (value: { state: string }) => void;
    api.retryTenderRefund.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const locked = new GiveBackSession(scope, api);
    await locked.submit("sale-1", ask);
    const out = locked.checkRest("sale-1");
    await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
    localStorage.clear();
    api.giveBack.mockImplementationOnce(next);
    const session = new GiveBackSession(scope, api);
    await session.submit("sale-1", ask).catch(() => {});
    const saved = session.read("sale-1");
    expect(saved).not.toBeNull();

    answer({ state: "failed" });
    expect(await out).toEqual({ state: "failed" });
    expect(session.read("sale-1")).toEqual(saved);
  },
);

/** Sends `request`'s press, its answer still out, then signs out, which clears what is saved. */
async function sentBeforeSignOut(refusedFirst = false) {
  const api = fakeApi();
  const old = new GiveBackSession(scope, api);
  if (refusedFirst) {
    api.giveBack.mockRejectedValueOnce({ code: "tender.refund_exceeds_payment", status: 409 });
    await old.submit("sale-1", ask).catch(() => {});
  }
  let settle!: { answer: (value: GiveBackOutcome) => void; refuse: (error: unknown) => void };
  api.giveBack.mockImplementationOnce(
    () => new Promise((answer, refuse) => (settle = { answer, refuse })),
  );
  const out = refusedFirst ? old.resend("sale-1") : old.submit("sale-1", ask);
  localStorage.clear();
  return { api, out, settle };
}

describe("a press's late answer, once the device was signed out and in again", () => {
  type Settle = Awaited<ReturnType<typeof sentBeforeSignOut>>["settle"];
  const lateAnswers: [string, (late: Settle) => void, boolean?][] = [
    ["that it went back", (late) => late.answer(outcome())],
    [
      "that it did not go back",
      (late) =>
        late.answer(
          outcome({
            parts: [{ kind: "refund", amount: "8.00", state: "failed", refundId: "refund-1" }],
            refusal: { code: "give_back.refund_failed", params: {} },
          }),
        ),
    ],
    ["that a card refund waits, with a rest", (late) => late.answer(pendingWithRest)],
    ["that nothing was written", (late) => late.refuse({ code: "give_back.changed", status: 409 })],
    [
      "that it may not be sent",
      (late) => late.refuse({ code: "authorization.not_permitted", status: 403 }),
    ],
    [
      "that it was refused",
      (late) => late.refuse({ code: "tender.refund_exceeds_payment", status: 409 }),
    ],
    [
      "that was lost, to a press refused before",
      (late) => late.refuse(new TypeError("Failed to fetch")),
      true,
    ],
  ];

  it.each(lateAnswers)(
    "%s, leaves the newer press with no answer saved under its own ids",
    async (_what, late, refusedFirst) => {
      const { api, out, settle } = await sentBeforeSignOut(refusedFirst);
      api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const session = new GiveBackSession(scope, api);
      await session.submit("sale-1", ask).catch(() => {});
      const newer = session.read("sale-1");
      expect(newer?.sent?.submissionIds).toEqual(sent(api, refusedFirst ? 2 : 1).submissionIds);

      late(settle);
      await out.catch(() => {});
      expect(session.read("sale-1")).toEqual(newer);
    },
  );

  it.each(lateAnswers)("%s, saves nothing again", async (_what, late, refusedFirst) => {
    const { api, out, settle } = await sentBeforeSignOut(refusedFirst);
    late(settle);
    await out.catch(() => {});
    expect(new GiveBackSession(scope, api).read("sale-1")).toBeNull();
  });
});

it("leaves a press saved beside the same rest alone when the rest's refund is answered late", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  api.getTenderRefund.mockResolvedValueOnce({ state: "pending" });
  let answer!: (value: { state: string }) => void;
  api.retryTenderRefund.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  const out = session.checkRest("sale-1");
  await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
  api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const otherTab = new GiveBackSession(scope, api);
  await otherTab.sendRest("sale-1", restPreview).catch(() => {});
  const { submissionIds } = sent(api, 1);

  answer({ state: "failed" });
  expect(await out).toEqual({ state: "failed" });
  expect(otherTab.read("sale-1")?.sent?.submissionIds).toEqual(submissionIds);
});

it.each([
  ["proving nothing went back", { code: "give_back.changed", status: 409 }],
  ["for another reason", { code: "tender.refund_exceeds_payment", status: 409 }],
  ["for a right", { code: "authorization.not_permitted", status: 403 }],
])(
  "hands back the box's refusal %s even when it cannot be saved afterwards, keeping the press to send again",
  async (_what, refusal) => {
    const api = fakeApi();
    api.giveBack.mockImplementationOnce(async () => {
      for (const method of ["removeItem", "setItem"] as const)
        vi.spyOn(Storage.prototype, method).mockImplementation(() => {
          throw new Error("full");
        });
      throw refusal;
    });
    const session = new GiveBackSession(scope, api);
    await expect(session.submit("sale-1", ask)).rejects.toBe(refusal);
    expect(session.read("sale-1")?.sent).toMatchObject({
      submissionIds: sent(api, 0).submissionIds,
      firstSendRefused: false,
    });
  },
);

it("keeps no rest after a refusal: what is left is given back from a new press", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce({
    ...pendingWithRest,
    refusal: { code: "give_back.refund_failed", params: {} },
  });
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  expect(session.read("sale-1")).toBeNull();
});

it("keeps each person's and device's presses apart", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce(new TypeError("lost answer"));
  await expect(new GiveBackSession(scope, api).submit("sale-1", ask)).rejects.toThrow();
  expect(new GiveBackSession({ ...scope, personId: "person-2" }, api).read("sale-1")).toBeNull();
  expect(new GiveBackSession(scope, api).read("sale-2")).toBeNull();
});

it("sends one press at a time", async () => {
  const api = fakeApi();
  let answer!: (value: GiveBackOutcome) => void;
  api.giveBack.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const session = new GiveBackSession(scope, api);
  const first = session.submit("sale-1", ask);
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject({ kind: "busy" });
  answer(outcome());
  await first;
});

it("refuses storage it cannot read back, sending nothing", async () => {
  const api = fakeApi();
  vi.spyOn(Storage.prototype, "getItem").mockReturnValue("not what was written");
  await expect(new GiveBackSession(scope, api).submit("sale-1", ask)).rejects.toMatchObject({
    kind: "storage",
  });
  expect(api.giveBack).not.toHaveBeenCalled();
});

it("forgets a rest whose card refund the card company did not make", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(pendingWithRest);
  api.getTenderRefund.mockResolvedValueOnce({ state: "failed" });
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  expect(await session.checkRest("sale-1")).toEqual({ state: "failed" });
  expect(session.read("sale-1")).toBeNull();
  expect(api.previewGiveBack).not.toHaveBeenCalled();
});

it("answers a Send again of a press answered meanwhile as that answer did, sending nothing", async () => {
  const api = fakeApi();
  let answer!: (value: GiveBackOutcome) => void;
  api.giveBack.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  const session = new GiveBackSession(scope, api);
  const first = session.submit("sale-1", ask);
  await expect(session.resend("sale-1")).rejects.toMatchObject({ kind: "busy" });
  answer(pendingWithRest);
  await first;
  expect(session.read("sale-1")?.sent).toBeNull();
  expect(await session.resend("sale-1", undefined, sent(api, 0).submissionIds)).toEqual(
    pendingWithRest,
  );
  expect(api.giveBack).toHaveBeenCalledOnce();
});

it("answers a Send again of a press refused meanwhile with a refusal proving nothing went back with that refusal, sending nothing", async () => {
  const api = fakeApi();
  const changed = { code: "give_back.changed", status: 409 };
  api.giveBack.mockRejectedValueOnce(changed);
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toBe(changed);
  expect(session.read("sale-1")).toBeNull();
  await expect(session.resend("sale-1", undefined, sent(api, 0).submissionIds)).rejects.toBe(
    changed,
  );
  expect(api.giveBack).toHaveBeenCalledOnce();
});

it("answers no Send again from an earlier press once a new press was made", async () => {
  const api = fakeApi();
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  api.giveBack.mockRejectedValueOnce({ code: "pin.invalid", status: 403 });
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject({ code: "pin.invalid" });
  session.abandon("sale-1");
  expect(session.read("sale-1")).toBeNull();
  for (const index of [0, 1])
    await expect(
      session.resend("sale-1", undefined, sent(api, index).submissionIds),
    ).rejects.toMatchObject({ kind: "missing" });
  expect(api.giveBack).toHaveBeenCalledTimes(2);
});

/** Two tabs on one device: each has a session of its own, and both use the same saved press. */
describe("Send again once another press is saved on the same receipt", () => {
  const newer: GiveBackAsk = { ...ask, request: { ...request, amount: "9.00" } };
  const lost = new TypeError("lost answer");

  it("sends nothing when its own press is no longer saved, and leaves the newer press alone", async () => {
    const api = fakeApi();
    api.giveBack.mockRejectedValueOnce(lost);
    const shown = new GiveBackSession(scope, api);
    await expect(shown.submit("sale-1", ask)).rejects.toBe(lost);
    const other = new GiveBackSession(scope, api);
    await other.resend("sale-1");
    api.giveBack.mockRejectedValueOnce(lost);
    await expect(other.submit("sale-1", newer)).rejects.toBe(lost);

    await expect(
      shown.resend("sale-1", { personId: "boss", pin: "1234" }, sent(api, 0).submissionIds),
    ).rejects.toMatchObject({ kind: "missing" });
    expect(api.giveBack).toHaveBeenCalledTimes(3);
    expect(shown.read("sale-1")?.sent?.submissionIds).toEqual(sent(api, 2).submissionIds);
    expect(await shown.resend("sale-1", undefined, sent(api, 2).submissionIds)).toEqual(outcome());
    expect(sent(api, 3).submissionIds).toEqual(sent(api, 2).submissionIds);
  });

  it("answers as its own press was answered, sending nothing", async () => {
    const api = fakeApi();
    const shown = new GiveBackSession(scope, api);
    await shown.submit("sale-1", ask);
    api.giveBack.mockRejectedValueOnce(lost);
    await expect(new GiveBackSession(scope, api).submit("sale-1", newer)).rejects.toBe(lost);
    expect(await shown.resend("sale-1", undefined, sent(api, 0).submissionIds)).toEqual(outcome());
    expect(api.giveBack).toHaveBeenCalledTimes(2);
  });
});

it("sends a press on one receipt while another receipt's press is out, and Send again takes only its own press's answer", async () => {
  const api = fakeApi();
  const cash: GiveBackAsk = {
    request: { purpose: "goodwill", amount: "5.00", extra: "0.00", way: "cash" },
    reasonId: "reason-1",
    note: null,
    expected: [{ kind: "refund", amount: "5.00", way: "cash" }],
  };
  const given = (id: string) =>
    outcome({ parts: [{ kind: "refund", amount: "5.00", state: "completed", refundId: id }] });
  const session = new GiveBackSession(scope, api);
  api.giveBack.mockResolvedValueOnce(given("first"));
  await session.submit("sale-b", cash);
  const firstIds = sent(api, 0).submissionIds;
  let answerA!: (value: GiveBackOutcome) => void;
  api.giveBack.mockImplementationOnce(() => new Promise((resolve) => (answerA = resolve)));
  const onA = session.submit("sale-a", ask);

  api.giveBack.mockResolvedValueOnce(given("second"));
  expect(await session.submit("sale-b", cash)).toEqual(given("second"));
  const secondIds = sent(api, 2).submissionIds;
  expect(secondIds).not.toEqual(firstIds);
  answerA(outcome());
  await onA;
  expect(session.read("sale-b")).toBeNull();
  await expect(session.resend("sale-b", undefined, firstIds)).rejects.toMatchObject({
    kind: "missing",
  });
  expect(await session.resend("sale-b", undefined, secondIds)).toEqual(given("second"));
  expect(api.giveBack).toHaveBeenCalledTimes(3);
});

it("refuses to send again, check or send a rest when nothing is saved", async () => {
  const session = new GiveBackSession(scope, fakeApi());
  await expect(session.resend("sale-1")).rejects.toMatchObject({ kind: "missing" });
  await expect(session.checkRest("sale-1")).rejects.toMatchObject({ kind: "missing" });
  await expect(session.sendRest("sale-1", restPreview)).rejects.toMatchObject({ kind: "missing" });
});

it("refuses a saved press written for another receipt or in another shape", async () => {
  const session = new GiveBackSession(scope, fakeApi());
  const key = `waitron.tender-refund:${JSON.stringify(["device-1", "person-1"])}:${JSON.stringify(["give-back", "sale-1"])}`;
  localStorage.setItem(
    key,
    JSON.stringify({ version: 2, saleId: "sale-1", sent: null, rest: null }),
  );
  expect(() => session.read("sale-1")).toThrow(expect.objectContaining({ kind: "storage" }));
});

it("keeps a lost press whose resend is refused before the server looks its ids up", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce(new TypeError("lost answer"));
  api.giveBack.mockRejectedValueOnce({ code: "venue.time_zone_not_ready", status: 409 });
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toThrow();
  await expect(session.resend("sale-1")).rejects.toMatchObject({
    code: "venue.time_zone_not_ready",
  });
  expect(session.read("sale-1")?.sent?.submissionIds).toEqual(sent(api, 0).submissionIds);
  await session.resend("sale-1");
  expect(sent(api, 2).submissionIds).toEqual(sent(api, 0).submissionIds);
});

describe("a refusal of the corrective invoice's way", () => {
  const choice = {
    ...ask,
    request: { ...request, correctiveDelivery: { medium: "print" as const, printerId: "bar" } },
  };
  const refusals = [
    { code: "invoice_delivery.printer_invalid", field: "correctiveDelivery.printerId" },
    { code: "invoice_delivery.email_unavailable", field: "correctiveDelivery.recipient" },
    { code: "management.request_invalid", field: "correctiveDelivery.recipient" },
  ];

  it.each(refusals)(
    "forgets a first press refused with $code, so a changed press is sent",
    async (refusal) => {
      const api = fakeApi();
      api.giveBack.mockRejectedValueOnce({ ...refusal, status: 409 });
      const session = new GiveBackSession(scope, api);
      await expect(session.submit("sale-1", choice)).rejects.toMatchObject(refusal);
      expect(session.read("sale-1")).toBeNull();
      await session.submit("sale-1", ask);
      expect(sent(api, 1).request).not.toHaveProperty("correctiveDelivery");
      expect(sent(api, 1).submissionIds).not.toEqual(sent(api, 0).submissionIds);
    },
  );

  it.each(refusals)(
    "keeps a press whose resend is refused with $code, as its first send may have written",
    async (refusal) => {
      const api = fakeApi();
      api.giveBack.mockRejectedValueOnce(new TypeError("lost answer"));
      api.giveBack.mockRejectedValueOnce({ ...refusal, status: 409 });
      const session = new GiveBackSession(scope, api);
      await expect(session.submit("sale-1", choice)).rejects.toThrow("lost answer");
      await expect(session.resend("sale-1")).rejects.toMatchObject(refusal);
      expect(session.read("sale-1")?.sent?.submissionIds).toEqual(sent(api, 0).submissionIds);
    },
  );

  it("forgets a press refused with it once its PIN was given after a first PIN refusal", async () => {
    const api = fakeApi();
    api.giveBack.mockRejectedValueOnce({ code: "pin.invalid", status: 403 });
    api.giveBack.mockRejectedValueOnce({ ...refusals[0], status: 409 });
    const session = new GiveBackSession(scope, api);
    await expect(session.submit("sale-1", choice)).rejects.toMatchObject({ code: "pin.invalid" });
    await expect(
      session.submit("sale-1", choice, { personId: "boss", pin: "1234" }),
    ).rejects.toMatchObject(refusals[0]!);
    expect(session.read("sale-1")).toBeNull();
  });
});

it("keeps a card refund left waiting with nothing to follow, and forgets it once it is through", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(
    outcome({
      parts: [
        { kind: "refund", amount: "8.00", state: "pending", refundId: "refund-1" },
        { kind: "correction", amount: "12.00", state: "pending", correctionId: "c-1" },
      ],
    }),
  );
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  expect(new GiveBackSession(scope, api).read("sale-1")?.rest).toEqual({
    request: null,
    reasonId: "reason-1",
    note: null,
    waitFor: "refund-1",
    amount: "8.00",
    way: "card-1",
  });
  expect(await session.checkRest("sale-1")).toEqual({ state: "completed", preview: null });
  expect(api.previewGiveBack).not.toHaveBeenCalled();
  expect(session.read("sale-1")).toBeNull();
});

it("records a first send's PIN refusal with the press, so a new session may forget it", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce({ code: "pin.invalid", status: 403 });
  await expect(
    new GiveBackSession(scope, api).submit("sale-1", ask, { personId: "boss", pin: "0000" }),
  ).rejects.toMatchObject({ code: "pin.invalid" });
  const reopened = new GiveBackSession(scope, api);
  expect(reopened.read("sale-1")?.sent).toMatchObject({
    firstSendRefused: true,
    refusal: { code: "pin.invalid", params: {} },
  });
  reopened.abandon("sale-1");
  expect(reopened.read("sale-1")).toBeNull();
});

it("keeps a press refused for another reason, with that refusal, even when asked to forget it", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce({
    code: "tender.refund_exceeds_payment",
    tenderId: "card-1",
    status: 409,
  });
  await expect(new GiveBackSession(scope, api).submit("sale-1", ask)).rejects.toMatchObject({
    code: "tender.refund_exceeds_payment",
  });
  const reopened = new GiveBackSession(scope, api);
  reopened.abandon("sale-1");
  expect(reopened.read("sale-1")?.sent).toMatchObject({
    firstSendRefused: false,
    refusal: { code: "tender.refund_exceeds_payment", params: { tenderId: "card-1" } },
  });
});

it("saves the preview's rights with the press", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce(new TypeError("lost answer"));
  const session = new GiveBackSession(scope, api);
  await expect(
    session.submit("sale-1", ask, undefined, ["sale.refund", "sale.rectify"]),
  ).rejects.toThrow();
  expect(session.read("sale-1")?.sent?.needs).toEqual(["sale.refund", "sale.rectify"]);
  expect(sent(api, 0)).not.toHaveProperty("needs");
});

it("hands back the answer even when it cannot be saved afterwards", async () => {
  const api = fakeApi();
  api.giveBack.mockImplementationOnce(async () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("full");
    });
    return outcome();
  });
  expect(await new GiveBackSession(scope, api).submit("sale-1", ask)).toEqual(outcome());
});

it("keeps a press whose answer has every part still to start, as its first send is still writing", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(
    outcome({
      parts: [
        { kind: "refund", amount: "8.00", state: "not_started" },
        { kind: "correction", amount: "12.00", state: "not_started" },
      ],
    }),
  );
  const session = new GiveBackSession(scope, api);
  await session.submit("sale-1", ask);
  expect(session.read("sale-1")?.sent?.request).toEqual(request);
});

it("saves a rest with nothing waiting, and Check again sends it with fresh ids, also after reopening", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(
    outcome({
      parts: [
        { kind: "refund", amount: "8.00", state: "completed", refundId: "refund-1" },
        { kind: "correction", amount: "12.00", state: "not_started" },
      ],
      rest,
    }),
  );
  await new GiveBackSession(scope, api).submit("sale-1", ask);
  const reopened = new GiveBackSession(scope, api);
  const saved = reopened.read("sale-1")!;
  expect(saved.sent).toBeNull();
  expect(saved.rest).toMatchObject({ request: rest, reasonId: "reason-1", way: "card-1" });
  expect(saved.rest).not.toHaveProperty("waitFor");

  expect(await reopened.checkRest("sale-1")).toEqual({ state: "completed", preview: restPreview });
  expect(api.getTenderRefund).not.toHaveBeenCalled();
  await reopened.sendRest("sale-1", restPreview);
  expect(sent(api, 1)).toMatchObject({ request: rest, expected: restPreview.parts });
  for (const id of Object.values(sent(api, 1).submissionIds))
    expect(Object.values(sent(api, 0).submissionIds)).not.toContain(id);
  expect(reopened.read("sale-1")).toBeNull();
});

it("keeps a first press refused while the venue's time zone is not ready, as a card refund may already have gone back", async () => {
  const api = fakeApi();
  api.giveBack.mockRejectedValueOnce({ code: "venue.time_zone_not_ready", status: 409 });
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject({
    code: "venue.time_zone_not_ready",
  });
  expect(session.read("sale-1")?.sent).toMatchObject({
    firstSendRefused: false,
    refusal: { code: "venue.time_zone_not_ready" },
    submissionIds: sent(api, 0).submissionIds,
  });
  await expect(
    session.submit("sale-1", { ...ask, request: { ...request, amount: "19.00" } }),
  ).rejects.toMatchObject({ kind: "locked" });
  expect(api.giveBack).toHaveBeenCalledOnce();
  await session.resend("sale-1");
  expect(sent(api, 1).submissionIds).toEqual(sent(api, 0).submissionIds);
});

it("rejects an answer it cannot read, keeping the press to send again", async () => {
  const api = fakeApi();
  api.giveBack.mockResolvedValueOnce(
    outcome({
      parts: [{ kind: "refund", amount: "eight", state: "pending", refundId: "refund-1" }],
    }),
  );
  const session = new GiveBackSession(scope, api);
  await expect(session.submit("sale-1", ask)).rejects.toMatchObject({
    code: "shared.invalid_decimal",
  });
  expect(session.read("sale-1")?.sent?.submissionIds).toEqual(sent(api, 0).submissionIds);
});
