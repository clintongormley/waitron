import { describe, expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { AdjustmentsApi, type AdjustmentReason, type AdjustmentReasonInput } from "./client.js";

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
      { method: "GET", credentials: "include" },
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
});
