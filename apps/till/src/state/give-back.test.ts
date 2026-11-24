import { afterEach, expect, it, vi } from "vitest";
import type {
  GiveBackAsk,
  GiveBackOutcome,
  GiveBackPreview,
  GiveBackRequest,
  GiveBackWrite,
} from "../api/give-back-types.js";
import { GiveBackSession } from "./give-back.js";

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
