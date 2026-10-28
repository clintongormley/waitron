import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { READ_AFTER_SAVE_RETRY_MS, readAfterSave } from "./read-after-save.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

it("waits 2, 4, 8 and 16 seconds between tries", () => {
  expect(READ_AFTER_SAVE_RETRY_MS).toEqual([2000, 4000, 8000, 16000]);
});

it("reads once when the first read succeeds", async () => {
  const read = vi.fn(async () => true);
  await readAfterSave(read, () => true, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(1);
});

it("reads again 2 seconds after a failed read, and stops at the first success", async () => {
  const read = vi
    .fn(async () => false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const done = readAfterSave(read, () => true, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  await done;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
});

it("a read that never succeeds is tried five times in all, then no more", async () => {
  const read = vi.fn(async () => false);
  const done = readAfterSave(read, () => true, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(4000);
  expect(read).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(8000);
  expect(read).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(16000);
  expect(read).toHaveBeenCalledTimes(5);
  await done;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(5);
});

it("reads nothing more once it is no longer wanted", async () => {
  const read = vi.fn(async () => false);
  let wanted = true;
  const done = readAfterSave(read, () => wanted, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(2);
  wanted = false;
  await vi.advanceTimersByTimeAsync(60_000);
  await done;
  expect(read).toHaveBeenCalledTimes(2);
});

it("aborting during a wait clears the pending timer and reads nothing more", async () => {
  const read = vi.fn(async () => false);
  const retries = new AbortController();
  const done = readAfterSave(read, () => true, retries.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  retries.abort();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  await done;
  expect(read).toHaveBeenCalledTimes(1);
});
