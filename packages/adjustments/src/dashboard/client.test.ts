import { describe, expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import {
  AdjustmentsApi,
  type AdjustmentEntry,
  type AdjustmentReason,
  type AdjustmentReasonInput,
  type AdjustmentReport,
} from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: true, status, text: async () => JSON.stringify(body) } as Response;
}
function emptyResponse(): Response {
  return { ok: true, status: 204, text: async () => "" } as Response;
}

const input: AdjustmentReasonInput = {
  name: "Complaint",
  names: { en: "Complaint", es: "Queja" },
  actions: ["comp", "discount_percent"],
  maxPercentBp: 5000,
  maxAmount: "30.00",
  applyRole: "supervisor",
  approverRole: "manager",
  noteRequired: true,
};
const reason: AdjustmentReason = { ...input, id: "r1", active: true, position: 0 };

function api(fetchImpl: ReturnType<typeof vi.fn>, passive = false) {
  const client = new AdjustmentsApi(
    createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
  );
  return passive ? client.background : client;
}

describe("AdjustmentsApi", () => {
  it("lists every reason, inactive ones included, from the reasons envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ reasons: [reason] }));
    expect(await api(fetchImpl).listReasons()).toEqual([reason]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/adjustments/reasons?includeInactive=true",
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
    );
  });

  it("marks a background read passive, and keeps the live data it was given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ reasons: [] }));
    const liveData = {} as never;
    const client = new AdjustmentsApi(
      createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    );
    expect(client.background.liveData).toBe(liveData);
    await client.background.listReasons();
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
  });

  it("creates a reason with a POST of every field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(reason, 201));
    expect(await api(fetchImpl).createReason(input)).toEqual(reason);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/adjustments/reasons", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("replaces a reason's fields with a PUT to its own path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(reason));
    expect(await api(fetchImpl).updateReason("r1", input)).toEqual(reason);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/adjustments/reasons/r1", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("deactivates a reason with a DELETE", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    await api(fetchImpl).deactivateReason("r1");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/adjustments/reasons/r1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("sends the whole active order to the reorder route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    await api(fetchImpl).reorderReasons(["r2", "r1"]);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/adjustments/reason-order", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["r2", "r1"] }),
    });
  });

  it("reads the venue's bill discount limit, passively on the background client", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ maxBillDiscountBp: 1500 }));
    expect(await api(fetchImpl).getSettings()).toEqual({ maxBillDiscountBp: 1500 });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/adjustments/settings", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
    await api(fetchImpl, true).getSettings();
    const init = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
  });

  it("replaces the venue's bill discount limit with a PUT, a null limit included", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ maxBillDiscountBp: null }));
    expect(await api(fetchImpl).saveSettings({ maxBillDiscountBp: null })).toEqual({
      maxBillDiscountBp: null,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/adjustments/settings", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxBillDiscountBp: null }),
    });
  });

  it("reads the report over a range of business days, or over the current one", async () => {
    const report = {
      fromBusinessDay: "2026-09-01",
      toBusinessDay: "2026-09-02",
    } as AdjustmentReport;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(report));
    expect(await api(fetchImpl).getReport({ from: "2026-09-01", to: "2026-09-02" })).toEqual(
      report,
    );
    await api(fetchImpl).getReport();
    expect(fetchImpl.mock.calls).toEqual([
      [
        "/management-api/adjustments/report?from=2026-09-01&to=2026-09-02",
        { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
      ],
      [
        "/management-api/adjustments/report",
        { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
      ],
    ]);
  });

  it("lists everyone's adjustments, one person's, or the guests', a page at a time", async () => {
    const page = {
      entries: [{ id: "a1" } as AdjustmentEntry],
      next: "2026-09-01T20:00:00.000Z_a1",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page));
    const client = api(fetchImpl);
    expect(await client.listEntries("2026-09-01", "2026-09-01", "everyone")).toEqual(page);
    await client.listEntries("2026-09-01", "2026-09-02", {
      personId: "5b1e6a52-0c1d-4f6e-9a3b-2d7c8e9f0a1b",
    });
    await client.listEntries("2026-09-01", "2026-09-02", "guests");
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "/management-api/adjustments/report/entries?from=2026-09-01&to=2026-09-01",
      "/management-api/adjustments/report/entries?from=2026-09-01&to=2026-09-02&personId=5b1e6a52-0c1d-4f6e-9a3b-2d7c8e9f0a1b",
      "/management-api/adjustments/report/entries?from=2026-09-01&to=2026-09-02&guests=true",
    ]);
  });

  it("asks for the page after a cursor, and for a page size", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ entries: [], next: null }));
    const client = api(fetchImpl);
    await client.listEntries("2026-09-01", "2026-09-01", "guests", {
      after: "2026-09-01T20:00:00.000Z_a1",
      limit: 50,
    });
    await client.listEntries("2026-09-01", "2026-09-01", "everyone", { limit: 10 });
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "/management-api/adjustments/report/entries?from=2026-09-01&to=2026-09-01&guests=true&after=2026-09-01T20%3A00%3A00.000Z_a1&limit=50",
      "/management-api/adjustments/report/entries?from=2026-09-01&to=2026-09-01&limit=10",
    ]);
  });

  it("marks each report read passive on the background client", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ entries: [], next: null }));
    const client = api(fetchImpl, true);
    await client.getReport();
    await client.getReport({ from: "2026-09-01", to: "2026-09-01" });
    await client.listEntries("2026-09-01", "2026-09-01", "everyone");
    for (const call of fetchImpl.mock.calls) {
      expect(new Headers((call[1] as RequestInit).headers).get("x-waitron-live")).toBe("1");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
