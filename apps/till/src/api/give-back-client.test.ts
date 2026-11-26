import { expect, it, vi } from "vitest";
import { TillApi } from "./client.js";

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

it("reads what Give money back lists on the encoded receipt", async () => {
  const body = { lines: [], ways: [], underWay: null, choices: {} };
  const fetcher = vi.fn().mockResolvedValue(response(body));
  const signal = new AbortController().signal;
  expect(await new TillApi("", fetcher).readGiveBack("sale/1", { signal })).toEqual(body);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/transactions/sale%2F1/give-back", {
    method: "GET",
    credentials: "include",
    signal,
  });
});

it("previews a give-back on the encoded receipt with the whole request", async () => {
  const request = {
    purpose: "dishes" as const,
    lineIds: ["line-1"],
    amount: "12.00",
    extra: "1.00",
    way: "cash",
  };
  const answer = { parts: [], leftUnderWay: "0.00", needs: [], manual: false };
  const fetcher = vi.fn().mockResolvedValue(response(answer));
  expect(await new TillApi("", fetcher).previewGiveBack("sale/1", request)).toEqual(answer);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/transactions/sale%2F1/give-back/preview", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
});

it("sends a give-back on the encoded receipt with the request's fields at the top level", async () => {
  const body = {
    request: { purpose: "goodwill" as const, amount: "5.00", extra: "0.00", way: "cash" },
    reasonId: "reason-1",
    note: null,
    expected: [{ kind: "refund" as const, amount: "5.00", way: "cash" }],
    submissionIds: { refund: "a", extra: "b", correction: "c", leg: "d" },
    override: { personId: "boss", pin: "1234" },
  };
  const answer = { parts: [], refusal: null, underWay: null, rest: null };
  const fetcher = vi.fn().mockResolvedValue(response(answer));
  expect(await new TillApi("", fetcher).giveBack("sale/1", body)).toEqual(answer);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/transactions/sale%2F1/give-back", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      purpose: "goodwill",
      amount: "5.00",
      extra: "0.00",
      way: "cash",
      reasonId: "reason-1",
      note: null,
      expected: [{ kind: "refund", amount: "5.00", way: "cash" }],
      submissionIds: { refund: "a", extra: "b", correction: "c", leg: "d" },
      override: { personId: "boss", pin: "1234" },
    }),
  });
});

it("lists the approvers holding every right a give-back needs", async () => {
  const fetcher = vi.fn().mockResolvedValue(response([]));
  await new TillApi("", fetcher).listApprovers(["sale.refund", "sale.rectify"]);
  expect(fetcher.mock.calls[0]![0]).toBe(
    "/api/adjustment-approvers?permission=sale.refund&permission=sale.rectify",
  );
});
