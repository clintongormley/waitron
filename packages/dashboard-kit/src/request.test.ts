import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    signal: expect.any(AbortSignal),
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
  // exactly that branch.
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

  await expect(request("/session", "POST", {})).rejects.toEqual({
    code: "password.invalid",
    status: 401,
  });
});

it("reports a rejected session before rejecting the request", async () => {
  const onError = vi.fn();
  const fetchImpl = vi
    .fn<FetchLike>()
    .mockResolvedValue(jsonResponse({ error: { code: "management_session.expired" } }, 401));
  const request = createRequest({ fetchImpl, onError });

  await expect(request("/management-api/staff", "GET")).rejects.toEqual({
    code: "management_session.expired",
    status: 401,
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
  ).rejects.toEqual({
    code: "payment.provider_merchant_ambiguous",
    params: { merchants },
    status: 409,
  });
});

it("rejects with server.internal when a non-2xx envelope names no code", async () => {
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, 500));
  const request = createRequest({ fetchImpl });

  await expect(request("/thing", "GET")).rejects.toEqual({ code: "server.internal", status: 500 });
});

it("rejects with server.internal (not a parse error) when the error body is not JSON", async () => {
  // A route that is gone answers Hono's own `404 Not Found` as `text/plain`, which `res.json()`
  // throws on. An unguarded parse turns that into a SyntaxError that surfaces to the caller as a
  // network outage. The status still rides along, so a caller can tell an answered box from a dead one.
  const onError = vi.fn();
  const fetchImpl = vi
    .fn<FetchLike>()
    .mockResolvedValue(
      new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } }),
    );
  const request = createRequest({ fetchImpl, onError });

  await expect(request("/gone", "GET")).rejects.toEqual({ code: "server.internal", status: 404 });
  expect(onError).toHaveBeenCalledWith("server.internal");
});

it("rejects with server.internal when the body is the literal JSON null", async () => {
  // `null` is valid JSON, so the parse SUCCEEDS and reading `.error` off it would throw a TypeError
  // — the case a bare try/catch around the parse still misses.
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(null, 500));
  const request = createRequest({ fetchImpl });

  await expect(request("/thing", "GET")).rejects.toEqual({ code: "server.internal", status: 500 });
});

it("defaults baseUrl to '' and fetchImpl to the global fetch", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
  const request = createRequest();

  const out = await request<{ ok: boolean }>("/thing", "GET");

  expect(out).toEqual({ ok: true });
  expect(spy).toHaveBeenCalledWith("/thing", {
    method: "GET",
    credentials: "include",
    signal: expect.any(AbortSignal),
  });
});

it("reports a connection failure without pretending an HTTP response arrived", async () => {
  const onError = vi.fn();
  const request = createRequest({
    fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    onError,
  });
  await expect(request("/printers", "GET")).rejects.toEqual({ code: "connection.failed" });
  expect(onError).toHaveBeenCalledWith("connection.failed");
});

it('returns a file\'s bytes untouched with as: "blob"', async () => {
  // 0xD1 is `Ñ` in ISO-8859-1 and not valid UTF-8 on its own: a text decode would turn it into
  // U+FFFD, which re-encodes as three bytes, so a decoded body comes back five bytes long.
  const bytes = new Uint8Array([0x4e, 0xd1, 0x0a]);
  const onSuccess = vi.fn();
  const request = createRequest({
    fetchImpl: vi.fn<FetchLike>().mockResolvedValue(new Response(bytes, { status: 200 })),
    onSuccess,
  });

  const out = await request<Blob>("/management-api/reports/modelo-303", "GET", undefined, {
    as: "blob",
  });

  expect(out).toBeInstanceOf(Blob);
  expect([...new Uint8Array(await out.arrayBuffer())]).toEqual([0x4e, 0xd1, 0x0a]);
  expect(onSuccess).toHaveBeenCalledWith("/management-api/reports/modelo-303");
});

it('decodes a refusal the same way with as: "blob"', async () => {
  const onError = vi.fn();
  const request = createRequest({
    fetchImpl: vi
      .fn<FetchLike>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "management.request_invalid", params: { field: "period" } } },
          400,
        ),
      ),
    onError,
  });

  await expect(
    request("/management-api/reports/modelo-303", "GET", undefined, { as: "blob" }),
  ).rejects.toEqual({
    code: "management.request_invalid",
    params: { field: "period" },
    status: 400,
  });
  expect(onError).toHaveBeenCalledWith("management.request_invalid");
});

describe("the time limit on a read", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A fetch that never answers on its own, and rejects as a real fetch does when it is aborted. */
  function hangingFetch(): ReturnType<typeof vi.fn<FetchLike>> {
    return vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
  }

  /** A response whose body never finishes on its own and errors when `signal` aborts. */
  function stalledBody(status: number, signal?: AbortSignal | null): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener("abort", () =>
          controller.error(new DOMException("The operation was aborted.", "AbortError")),
        );
      },
    });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }

  /** Settles `promise` into an inspectable record without letting a rejection go unhandled. */
  function track<T>(promise: Promise<T>): { settled?: { value?: T; error?: unknown } } {
    const record: { settled?: { value?: T; error?: unknown } } = {};
    promise.then(
      (value) => (record.settled = { value }),
      (error: unknown) => (record.settled = { error }),
    );
    return record;
  }

  it("gives up on a GET the server never answers after 30 seconds, as a lost connection", async () => {
    const fetchImpl = hangingFetch();
    const onError = vi.fn();
    const out = track(createRequest({ fetchImpl, onError })("/management-api/staff", "GET"));

    await vi.advanceTimersByTimeAsync(29_999);
    expect(out.settled).toBeUndefined();
    expect(fetchImpl.mock.calls[0]![1].signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(out.settled).toEqual({ error: { code: "connection.failed" } });
    expect(fetchImpl.mock.calls[0]![1].signal?.aborted).toBe(true);
    expect(onError.mock.calls).toEqual([["connection.failed"]]);
  });

  it("does not cut off a GET answered just inside the limit", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      () => new Promise((resolve) => setTimeout(() => resolve(jsonResponse({ ok: 1 })), 29_000)),
    );
    const onError = vi.fn();
    const out = track(createRequest({ fetchImpl, onError })("/management-api/staff", "GET"));

    await vi.advanceTimersByTimeAsync(29_000);
    expect(out.settled).toEqual({ value: { ok: 1 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(out.settled).toEqual({ value: { ok: 1 } });
    expect(onError).not.toHaveBeenCalled();
  });

  it("gives up on a GET whose answer stops part-way through its body", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => stalledBody(200, init.signal));
    const onError = vi.fn();
    const out = track(createRequest({ fetchImpl, onError })("/management-api/staff", "GET"));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(out.settled).toEqual({ error: { code: "connection.failed" } });
    expect(onError.mock.calls).toEqual([["connection.failed"]]);
  });

  it("reports a refusal whose body stops part-way as a lost connection, not a server fault", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => stalledBody(500, init.signal));
    const onError = vi.fn();
    const out = track(createRequest({ fetchImpl, onError })("/management-api/staff", "GET"));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(out.settled).toEqual({ error: { code: "connection.failed" } });
    expect(onError.mock.calls).toEqual([["connection.failed"]]);
  });

  it("passes on a body that fails for another reason within the limit unchanged", async () => {
    const broken = new TypeError("network error");
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(broken),
    });
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(body, { status: 200 }));
    const onError = vi.fn();

    await expect(
      createRequest({ fetchImpl, onError })("/management-api/staff", "GET"),
    ).rejects.toBe(broken);
    expect(onError).not.toHaveBeenCalled();
  });

  it("settles at 30 seconds even when the fetch ignores its abort signal", async () => {
    const fetchImpl = vi.fn<FetchLike>(() => new Promise<Response>(() => {}));
    const out = track(createRequest({ fetchImpl })("/management-api/staff", "GET"));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(out.settled).toEqual({ error: { code: "connection.failed" } });
  });

  it("puts no limit on a write", async () => {
    const fetchImpl = hangingFetch();
    const out = track(createRequest({ fetchImpl })("/management-api/staff", "POST", { a: 1 }));

    await vi.advanceTimersByTimeAsync(120_000);
    expect(out.settled).toBeUndefined();
    expect(fetchImpl.mock.calls[0]![1]).not.toHaveProperty("signal");
  });

  it('puts no limit on a file download (as: "blob")', async () => {
    const fetchImpl = hangingFetch();
    const out = track(
      createRequest({ fetchImpl })("/management-api/reports/modelo-303", "GET", undefined, {
        as: "blob",
      }),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    expect(out.settled).toBeUndefined();
    expect(fetchImpl.mock.calls[0]![1]).not.toHaveProperty("signal");
  });
});
