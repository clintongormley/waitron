import { afterEach, describe, expect, it, vi } from "vitest";
import { withDestinationCall } from "./backup-destination-call.js";
import type { StorageCall } from "./storage-backend.js";

/** Counts the listeners a parent signal holds, so a leftover one is visible. */
function countedParent() {
  const controller = new AbortController();
  let listeners = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  vi.spyOn(controller.signal, "addEventListener").mockImplementation((...args) => {
    listeners += 1;
    add(...(args as Parameters<typeof add>));
  });
  vi.spyOn(controller.signal, "removeEventListener").mockImplementation((...args) => {
    listeners -= 1;
    remove(...(args as Parameters<typeof remove>));
  });
  return { controller, listeners: () => listeners };
}

/** A transfer that keeps going for `ms` after its signal aborts, then fails as a store would. */
function slowToStop(ms: number, settled: { at: number | null }) {
  return (call: StorageCall) =>
    new Promise<never>((_, reject) => {
      call.signal.addEventListener("abort", () => {
        setTimeout(() => {
          settled.at = Date.now();
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, ms);
      });
    });
}

describe("withDestinationCall", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts the call at its time limit and rejects with the code only once the work settles", async () => {
    vi.useFakeTimers({ now: 0 });
    const parent = countedParent();
    const settled = { at: null as number | null };
    let signal: AbortSignal | undefined;
    let rejectedAt: number | null = null;
    const outcome = withDestinationCall(parent.controller.signal, 1000, (call) => {
      signal = call.signal;
      return slowToStop(500, settled)(call);
    }).catch((error: unknown) => {
      rejectedAt = Date.now();
      return error;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(true);
    expect(rejectedAt).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toMatchObject({
      code: "backup.destination_timed_out",
      params: { timeoutMs: 1000 },
    });
    expect(rejectedAt).toBe(settled.at);
    expect(rejectedAt).toBe(1500);
    expect(vi.getTimerCount()).toBe(0);
    expect(parent.listeners()).toBe(0);
  });

  it("answers the work's value when it resolves after the time limit fired", async () => {
    vi.useFakeTimers({ now: 0 });
    const outcome = withDestinationCall(
      new AbortController().signal,
      1000,
      () => new Promise<string>((resolve) => setTimeout(() => resolve("stored"), 1500)),
    );
    await vi.advanceTimersByTimeAsync(1500);
    expect(await outcome).toBe("stored");
  });

  it("passes a parent's abort to the call, and rejects as a cancellation, not a destination failure", async () => {
    vi.useFakeTimers({ now: 0 });
    const parent = countedParent();
    const settled = { at: null as number | null };
    let rejectedAt: number | null = null;
    const outcome = withDestinationCall(
      parent.controller.signal,
      60_000,
      slowToStop(200, settled),
    ).catch((error: unknown) => {
      rejectedAt = Date.now();
      return error;
    });
    await vi.advanceTimersByTimeAsync(100);
    parent.controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(rejectedAt).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toMatchObject({ code: "backup.destination_cancelled" });
    expect(rejectedAt).toBe(300);
    expect(vi.getTimerCount()).toBe(0);
    expect(parent.listeners()).toBe(0);
  });

  it("answers a cancellation when the parent aborts after the time limit fired", async () => {
    vi.useFakeTimers({ now: 0 });
    const parent = new AbortController();
    let fail!: (error: unknown) => void;
    const outcome = withDestinationCall(
      parent.signal,
      1000,
      () => new Promise<never>((_, reject) => (fail = reject)),
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    parent.abort();
    fail(new Error("aborted"));
    expect(await outcome).toMatchObject({ code: "backup.destination_cancelled" });
  });

  it("starts no work when the parent is already aborted", async () => {
    const parent = new AbortController();
    parent.abort();
    const work = vi.fn(async () => "never");
    await expect(withDestinationCall(parent.signal, 1000, work)).rejects.toMatchObject({
      code: "backup.destination_cancelled",
    });
    expect(work).not.toHaveBeenCalled();
  });

  it("answers the work's value and leaves no timer or listener behind", async () => {
    vi.useFakeTimers({ now: 0 });
    const parent = countedParent();
    let signal: AbortSignal | undefined;
    const value = await withDestinationCall(parent.controller.signal, 1000, async (call) => {
      signal = call.signal;
      return 42;
    });
    expect(value).toBe(42);
    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(parent.listeners()).toBe(0);
  });

  it("passes the work's own error through when neither limit fired", async () => {
    vi.useFakeTimers({ now: 0 });
    const parent = countedParent();
    const failure = new Error("refused");
    await expect(
      withDestinationCall(parent.controller.signal, 1000, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
    expect(parent.listeners()).toBe(0);
  });
});
