import { afterEach, expect, it, vi } from "vitest";
import { createRequest, type FetchLike } from "./request.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

it("marks automatic reads as passive without reporting session activity", async () => {
  const fetchImpl = vi.fn<FetchLike>().mockImplementation(async () => jsonResponse({ count: 2 }));
  const onSuccess = vi.fn();
  const request = createRequest({ fetchImpl, onSuccess });
  await request("/management-api/print-jobs", "GET", undefined, { passive: true });
  expect(new Headers(fetchImpl.mock.calls[0]![1].headers).get("x-waitron-live")).toBe("1");
  expect(onSuccess).not.toHaveBeenCalled();
  await request("/management-api/printers", "POST", { name: "Kitchen" }, { passive: true });
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).has("x-waitron-live")).toBe(false);
  expect(onSuccess).toHaveBeenCalledOnce();
});

it("prefixes baseUrl, sends credentials, and resolves the parsed JSON body of a 200", async () => {
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true }));
  const request = createRequest({ baseUrl: "https://api.test", fetchImpl });

  const out = await request<{ ok: boolean }>("/thing", "GET");

  expect(out).toEqual({ ok: true });
  expect(fetchImpl).toHaveBeenCalledWith("https://api.test/thing", {
    method: "GET",
    credentials: "include",
  });
});

it("reports a successful request after the server accepts it", async () => {
  const onSuccess = vi.fn();
  const request = createRequest({
    fetchImpl: vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true })),
    onSuccess,
  });

  await request("/management-api/staff", "GET");

  expect(onSuccess).toHaveBeenCalledWith("/management-api/staff");
});

it("resolves undefined for a 2xx with an empty body (the 204 mutation routes)", async () => {
  // The empty-body branch keys off `res.text() === ""`, NOT the status (see createRequest's header);
  // the WHATWG Response constructor forbids a body on a 204, so a 200 with an empty body exercises
  // exactly that branch. The 204 routes (logout/updatePerson/…) hit it in the browser identically.
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(new Response("", { status: 200 }));
  const request = createRequest({ fetchImpl });

  const out = await request<void>("/logout", "DELETE");

  expect(out).toBeUndefined();
});

it("sends a JSON body under a content-type: application/json header", async () => {
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ id: "1" }));
  const request = createRequest({ fetchImpl });

  await request("/thing", "POST", { name: "x" });

  expect(fetchImpl).toHaveBeenCalledWith("/thing", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x" }),
  });
});

it("passes a FormData body through with NO content-type header", async () => {
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ id: "1" }));
  const request = createRequest({ fetchImpl });
  const form = new FormData();
  form.append("file", "data");

  await request("/upload", "POST", form);

  expect(fetchImpl).toHaveBeenCalledWith("/upload", {
    method: "POST",
    credentials: "include",
    body: form,
  });
});

it("rejects with { code } read from the server's { error: { code } } envelope on a non-2xx", async () => {
  const fetchImpl = vi
    .fn<FetchLike>()
    .mockResolvedValue(jsonResponse({ error: { code: "password.invalid" } }, 401));
  const request = createRequest({ fetchImpl });

  await expect(request("/session", "POST", {})).rejects.toEqual({ code: "password.invalid" });
});

it("reports a rejected session before rejecting the request", async () => {
  const onError = vi.fn();
  const fetchImpl = vi
    .fn<FetchLike>()
    .mockResolvedValue(jsonResponse({ error: { code: "management_session.expired" } }, 401));
  const request = createRequest({ fetchImpl, onError });

  await expect(request("/management-api/staff", "GET")).rejects.toEqual({
    code: "management_session.expired",
  });
  expect(onError).toHaveBeenCalledWith("management_session.expired");
});

it("carries the envelope's error params through on the rejection", async () => {
  const merchants = [
    { code: "M1", name: "Deli One" },
    { code: "M2", name: "Deli Two" },
  ];
  const fetchImpl = vi
    .fn<FetchLike>()
    .mockResolvedValue(
      jsonResponse(
        { error: { code: "payment.provider_merchant_ambiguous", params: { merchants } } },
        409,
      ),
    );
  const request = createRequest({ fetchImpl });

  await expect(
    request("/management-api/payments/providers/sumup/connect", "POST", {}),
  ).rejects.toEqual({ code: "payment.provider_merchant_ambiguous", params: { merchants } });
});

it("rejects with server.internal when a non-2xx envelope names no code", async () => {
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, 500));
  const request = createRequest({ fetchImpl });

  await expect(request("/thing", "GET")).rejects.toEqual({ code: "server.internal" });
});

it("defaults baseUrl to '' and fetchImpl to the global fetch", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
  const request = createRequest();

  const out = await request<{ ok: boolean }>("/thing", "GET");

  expect(out).toEqual({ ok: true });
  expect(spy).toHaveBeenCalledWith("/thing", { method: "GET", credentials: "include" });
});
