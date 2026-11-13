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

it("opens a correction on the encoded invoice with the whole request", async () => {
  const request = {
    submissionId: "submission-1",
    gross: "12.10",
    lineIds: ["line-1"],
    reasonId: "reason-1",
    note: null,
    expectedSplit: [{ rate: "21.00", base: "10.00", tax: "2.10" }],
    override: { personId: "manager", pin: "0123" },
  };
  const answer = { correction: { id: "correction-1" }, replayed: false };
  const fetcher = vi.fn().mockResolvedValue(response(answer));
  expect(await new TillApi("", fetcher).openInvoiceCorrection("sale/1", request)).toEqual(answer);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "/api/transactions/sale%2F1/corrections",
    post(request),
  );
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

it("hands back the open correction an already-open refusal names", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    response(
      {
        error: {
          code: "invoice_correction.already_open",
          params: { saleId: "sale-1", correctionId: "correction-1" },
        },
      },
      409,
    ),
  );
  await expect(
    new TillApi("", fetcher).openInvoiceCorrection("sale-1", {
      submissionId: "submission-1",
      gross: "1.00",
      reasonId: "reason-1",
      expectedSplit: [],
    }),
  ).rejects.toEqual({
    code: "invoice_correction.already_open",
    status: 409,
    saleId: "sale-1",
    correctionId: "correction-1",
  });
});
