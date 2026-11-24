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
