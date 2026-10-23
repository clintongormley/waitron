import { expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

it("posts an empty body to the outbox retry route and returns the answer", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ waiting: 3 }));
  const api = new DashboardApi("", fetchImpl);
  expect(await api.retryFiscalSubmissions()).toEqual({ waiting: 3 });
  const calls = fetchImpl.mock.calls as [string, RequestInit][];
  expect(calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
    ["/management-api/fiscal-outbox/retry", "POST", "{}"],
  ]);
});

it("never sends a retry press as a passive read, even from the background client", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ waiting: 0 }));
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  await api.background.retryFiscalSubmissions();
  const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
  expect(new Headers(init.headers).has("x-waitron-live")).toBe(false);
  await api.retryFiscalSubmissions();
  expect(active).toHaveBeenCalledWith("/management-api/fiscal-outbox/retry");
});
