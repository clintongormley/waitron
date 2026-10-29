import { afterEach, expect, it, vi } from "vitest";
import { createRequest, type FetchLike, type RequestOptions } from "./request.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it("does no work for an already stopped POST", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(json({ ok: true }));
  const request = createRequest({ fetchImpl });
  await expect(request("/inspect", "POST", {}, { signal: controller.signal })).rejects.toEqual({
    code: "connection.cancelled",
  });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it.each(["fetch", "text", "blob", "refusal"] as const)(
  "settles a stopped POST while %s ignores its signal, without late activity",
  async (stage) => {
    const controller = new AbortController();
    const fetchHeld = held<Response>();
    const bodyHeld = held<never>();
    const response = json(
      stage === "refusal" ? { error: { code: "management_session.expired" } } : { ok: true },
      stage === "refusal" ? 401 : 200,
    );
    if (stage === "text") vi.spyOn(response, "text").mockReturnValue(bodyHeld.promise);
    if (stage === "blob") vi.spyOn(response, "blob").mockReturnValue(bodyHeld.promise);
    if (stage === "refusal") vi.spyOn(response, "json").mockReturnValue(bodyHeld.promise);
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockImplementation(() =>
        stage === "fetch" ? fetchHeld.promise : Promise.resolve(response),
      );
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const request = createRequest({ fetchImpl, onSuccess, onError });
    const result = request(
      "/inspect",
      "POST",
      {},
      { signal: controller.signal, ...(stage === "blob" ? { as: "blob" as const } : {}) },
    );
    const rejection = expect(result).rejects.toEqual({ code: "connection.cancelled" });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await rejection;
    expect(fetchImpl.mock.calls[0]![1].signal?.aborted).toBe(true);
    fetchHeld.resolve(response);
    await Promise.resolve();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError.mock.calls.flat()).not.toContain("management_session.expired");
  },
);

it.each(["fetch", "text", "refusal"] as const)(
  "times out an explicitly bounded POST at %s and releases its timer/listener",
  async (stage) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = held<never>();
    const response = json(
      { error: { code: "management_session.expired" } },
      stage === "refusal" ? 401 : 200,
    );
    if (stage === "text") vi.spyOn(response, "text").mockReturnValue(pending.promise);
    if (stage === "refusal") vi.spyOn(response, "json").mockReturnValue(pending.promise);
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockImplementation(() => (stage === "fetch" ? pending.promise : Promise.resolve(response)));
    const request = createRequest({ fetchImpl });
    const result = request("/inspect", "POST", {}, { signal: controller.signal, timeLimitMs: 35 });
    const rejection = expect(result).rejects.toEqual({ code: "connection.timed_out" });
    await vi.advanceTimersByTimeAsync(35);
    await rejection;
    expect(fetchImpl.mock.calls[0]![1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  },
);

it("preserves cancellation when its deadline later elapses", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const request = createRequest({ fetchImpl: () => held<Response>().promise });
  const result = request("/inspect", "POST", {}, { signal: controller.signal, timeLimitMs: 35 });
  const rejection = expect(result).rejects.toEqual({ code: "connection.cancelled" });
  controller.abort();
  await rejection;
  await vi.advanceTimersByTimeAsync(40);
  expect(vi.getTimerCount()).toBe(0);
});

it("removes the caller listener and deadline after success without making a POST passive", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const onSuccess = vi.fn();
  const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(json({ ok: true }));
  const request = createRequest({ fetchImpl, onSuccess });
  await expect(
    request(
      "/inspect",
      "POST",
      {},
      { signal: controller.signal, timeLimitMs: 35, activity: "none", passive: true },
    ),
  ).resolves.toEqual({ ok: true });
  expect(onSuccess).not.toHaveBeenCalled();
  expect(new Headers(fetchImpl.mock.calls[0]![1].headers).has("x-waitron-live")).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("cancellation before the body continuation runs suppresses an already-resolved result", async () => {
  const controller = new AbortController();
  const body = held<string>();
  const reading = held<void>();
  const response = json({ ok: true });
  vi.spyOn(response, "text").mockImplementation(() => {
    reading.resolve();
    return body.promise;
  });
  const onSuccess = vi.fn();
  const request = createRequest({ fetchImpl: async () => response, onSuccess });
  const result = request("/inspect", "POST", {}, { signal: controller.signal });
  const rejection = expect(result).rejects.toEqual({ code: "connection.cancelled" });
  await reading.promise;
  body.resolve('{"ok":true}');
  controller.abort();
  await rejection;
  expect(onSuccess).not.toHaveBeenCalled();
});

it.each([
  "management_session.required",
  "management_session.expired",
  "person.suspended",
  "node.reset",
  "permission.denied",
])("scopes only session refusals to the caller: %s", async (code) => {
  const onError = vi.fn();
  const request = createRequest({ fetchImpl: async () => json({ error: { code } }, 401), onError });
  await expect(request("/me", "GET", undefined, { sessionErrors: "caller" })).rejects.toEqual({
    code,
    status: 401,
  });
  expect(onError.mock.calls).toEqual(
    ["node.reset", "permission.denied"].includes(code) ? [[code, 401]] : [],
  );
});

it.each(["success", "expiry", "reset", "network"] as const)(
  "does not report an old account's %s callback, except reset",
  async (kind) => {
    let generation = 1;
    const pending = held<Response>();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const request = createRequest({
      fetchImpl: () => pending.promise,
      onSuccess,
      onError,
      sessionGeneration: () => generation,
    });
    const result = request("/me", "POST");
    const observed = result.catch((error: unknown) => error);
    generation = 2;
    pending.resolve(
      kind === "success"
        ? json({ ok: true })
        : kind === "network"
          ? (Promise.reject(new Error("offline")) as never)
          : json(
              { error: { code: kind === "reset" ? "node.reset" : "management_session.expired" } },
              401,
            ),
    );
    await observed;
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError.mock.calls).toEqual(kind === "reset" ? [["node.reset", 401, 1]] : []);
  },
);

it("still reports current generation activity and a current ordinary session refusal", async () => {
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const request = createRequest({
    fetchImpl: async (path) =>
      path === "/ok"
        ? json({ ok: true })
        : json({ error: { code: "management_session.expired" } }, 401),
    onSuccess,
    onError,
    sessionGeneration: () => 2,
  });
  await request("/ok", "POST");
  await expect(request("/me", "GET")).rejects.toEqual({
    code: "management_session.expired",
    status: 401,
  });
  expect(onSuccess).toHaveBeenCalledWith("/ok", 2);
  expect(onError).toHaveBeenCalledWith("management_session.expired", 401, 2);
});

// Compile the opt-in options at their public boundary as well as executing them above.
const options: RequestOptions = {
  signal: new AbortController().signal,
  sessionErrors: "caller",
  activity: "none",
};
void options;
