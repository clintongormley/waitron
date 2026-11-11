import { expect, it, vi } from "vitest";
import { createRequest, type DashboardRequest } from "@waitron/dashboard-kit";
import { createFreshSignInGate } from "./fresh-sign-in.js";

const refusal = { code: "management_session.proof_required", status: 400 };
const pending = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

it("shares one prompt and retries each original request once with its original body", async () => {
  const answer = pending<boolean>();
  const prompt = vi.fn(() => answer.promise);
  const calls: unknown[] = [];
  const seen = new Set<string>();
  const late = pending<void>();
  const request: DashboardRequest = async <T>(path: string, method: string, body?: unknown) => {
    calls.push([path, method, structuredClone(body)]);
    if (path === "/late" && !seen.has(path)) await late.promise;
    if (!seen.has(path)) {
      seen.add(path);
      throw refusal;
    }
    return path as T;
  };
  const gate = createFreshSignInGate({ sessionGeneration: () => 0, prompt });
  const wrapped = gate.wrap(request);
  const body = { selection: [1] };
  const a = wrapped("/a", "POST", body);
  const b = wrapped("/b", "GET");
  const c = wrapped("/late", "GET");
  void c.catch(() => {});
  void a.catch(() => {});
  void b.catch(() => {});
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  expect(prompt).toHaveBeenCalledWith(expect.any(AbortSignal), { allowRecoveryCode: true });
  body.selection.push(2);
  answer.resolve(true);
  expect(await Promise.all([a, b])).toEqual(["/a", "/b"]);
  late.resolve();
  expect(await c).toBe("/late");
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(calls).toEqual([
    ["/a", "POST", { selection: [1] }],
    ["/b", "GET", undefined],
    ["/late", "GET", undefined],
    ["/a", "POST", { selection: [1] }],
    ["/b", "GET", undefined],
    ["/late", "GET", undefined],
  ]);
});

it.each(["cancel", "abort", "sign-out", "late-refusal", "passive"])(
  "does not replay after %s",
  async (kind) => {
    let generation = 0;
    const answer = pending<boolean>();
    const first = pending<void>();
    const prompt = vi.fn(() => answer.promise);
    const raw = vi.fn(async () => {
      if (kind === "late-refusal") await first.promise;
      throw refusal;
    });
    const gate = createFreshSignInGate({ sessionGeneration: () => generation, prompt });
    const signal = new AbortController();
    const result = gate
      .wrap(raw as DashboardRequest)("/a", "GET", undefined, {
        signal: signal.signal,
        passive: kind === "passive",
      })
      .catch((e: unknown) => e);
    if (kind === "late-refusal") {
      generation++;
      first.resolve();
    } else if (kind !== "passive") {
      await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
      if (kind === "abort") signal.abort();
      else if (kind === "sign-out") {
        generation++;
        gate.cancel();
      } else answer.resolve(false);
    }
    expect(await result).toBe(refusal);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(kind === "late-refusal" || kind === "passive" ? 0 : 1);
  },
);

it("a second proof refusal is returned without another prompt", async () => {
  const prompt = vi.fn(async () => true);
  const raw = vi.fn(async () => {
    throw refusal;
  });
  const gate = createFreshSignInGate({ sessionGeneration: () => 0, prompt });
  await expect(gate.wrap(raw as DashboardRequest)("/a", "POST")).rejects.toBe(refusal);
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(raw).toHaveBeenCalledTimes(2);
});

it("each GET attempt owns its deadline; waiting for a person has none", async () => {
  vi.useFakeTimers();
  try {
    const answer = pending<boolean>();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: refusal }), { status: 400 }))
      .mockResolvedValueOnce(new Response('"done"'));
    const prompt = vi.fn(() => answer.promise);
    const gate = createFreshSignInGate({ sessionGeneration: () => 0, prompt });
    const result = gate.wrap(createRequest({ fetchImpl }))("/key", "GET");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_000);
    answer.resolve(true);
    expect(await result).toBe("done");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
