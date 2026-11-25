import { expect, it, vi } from "vitest";
import { TillApi } from "./client.js";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const post = (body: unknown) => ({
  method: "POST",
  credentials: "include",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

it("gives a correction's cash leg on the encoded correction", async () => {
  const request = { submissionId: "submission-2", amount: "5.00" };
  const answer = { correction: { id: "correction/1" }, refunds: [], replayed: true };
  const fetcher = vi.fn().mockResolvedValue(response(answer));
  expect(await new TillApi("", fetcher).giveInvoiceCorrectionCash("correction/1", request)).toEqual(
    answer,
  );
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "/api/invoice-corrections/correction%2F1/cash",
    post(request),
  );
});

it("reads a correction on the encoded id, passing the signal", async () => {
  const answer = { id: "correction/1", state: "open", moneyBack: "2.00", left: "4.05" };
  const fetcher = vi.fn().mockResolvedValue(response(answer));
  const signal = new AbortController().signal;
  expect(await new TillApi("", fetcher).getInvoiceCorrection("correction/1", { signal })).toEqual(
    answer,
  );
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/invoice-corrections/correction%2F1", {
    method: "GET",
    credentials: "include",
    signal,
  });
});

it("files a correction with the split shown, and closes one, each with the PIN when given", async () => {
  const answer = { id: "correction/1", state: "filed" };
  const fetcher = vi.fn(async () => response(answer));
  const api = new TillApi("", fetcher);
  const filing = {
    expectedSplit: [{ rate: "21.00", base: "1.65", tax: "0.35" }],
    override: { personId: "manager", pin: "0123" },
  };
  expect(await api.fileInvoiceCorrection("correction/1", filing)).toEqual(answer);
  expect(await api.closeInvoiceCorrection("correction/1", {})).toEqual(answer);
  expect(fetcher.mock.calls).toEqual([
    ["/api/invoice-corrections/correction%2F1/file", post(filing)],
    ["/api/invoice-corrections/correction%2F1/close", post({})],
  ]);
});

it("lists the open corrections, passing the signal", async () => {
  const corrections = [{ id: "correction-1", saleId: "sale-1", state: "open", left: "4.05" }];
  const fetcher = vi.fn().mockResolvedValue(response({ corrections }));
  const signal = new AbortController().signal;
  expect(await new TillApi("", fetcher).listInvoiceCorrections({ signal })).toEqual(corrections);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/invoice-corrections", {
    method: "GET",
    credentials: "include",
    signal,
  });
});
