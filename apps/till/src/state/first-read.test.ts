import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startFirstRead } from "./first-read.js";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

it("shows shapes at 300 ms, warns at 5 s and offers recovery at 15 s while the reply can still arrive", async () => {
  const show = vi.fn();
  let signal: AbortSignal | undefined;
  let answer!: (tables: string[]) => void;
  const read = startFirstRead((current) => {
    signal = current;
    return new Promise<string[]>((resolve) => (answer = resolve));
  }, show);
  const outcome = read.result.catch((error: unknown) => error);

  await vi.advanceTimersByTimeAsync(299);
  expect(show).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(show.mock.calls).toEqual([["placeholder"]]);
  await vi.advanceTimersByTimeAsync(4_699);
  expect(show).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(show.mock.calls).toEqual([["placeholder"], ["waiting"]]);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(show).toHaveBeenCalledTimes(2);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(show.mock.calls).toEqual([["placeholder"], ["waiting"], ["unreachable"]]);
  expect(signal?.aborted).toBe(false);
  answer(["Table 1"]);
  expect(await outcome).toEqual(["Table 1"]);
});

it("clears the pending stages when the box answers quickly", async () => {
  const show = vi.fn();
  const { result } = startFirstRead(() => Promise.resolve(["Table 1"]), show);

  await expect(result).resolves.toEqual(["Table 1"]);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(show).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the original refusal and aborts any other reads sharing the signal", async () => {
  const show = vi.fn();
  const failure = new TypeError("Failed to fetch");
  let signal: AbortSignal | undefined;
  const { result } = startFirstRead((current) => {
    signal = current;
    return Promise.reject(failure);
  }, show);

  await expect(result).rejects.toBe(failure);
  expect(signal?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(show).not.toHaveBeenCalled();
});

it("stops the read and its waiting notice when the caller cancels it", async () => {
  const show = vi.fn();
  const read = startFirstRead(() => new Promise(() => {}), show);
  const outcome = read.result.catch((error: unknown) => error);

  await vi.advanceTimersByTimeAsync(300);
  read.cancel();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(show.mock.calls).toEqual([["placeholder"]]);
  expect(await outcome).toMatchObject({ name: "AbortError" });
});
