import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { ModelWatches } from "./model-watch.js";

type Held<T> = { resolve: (value: T) => void; reject: (error: unknown) => void };

function heldLoad<T>() {
  const reads: Held<T>[] = [];
  const load = () => new Promise<T>((resolve, reject) => reads.push({ resolve, reject }));
  return { reads, load };
}

const detaches: (() => void)[] = [];
afterEach(() => {
  for (const detach of detaches.splice(0)) detach();
});

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "a read that started before a write's reread is never applied after it (%s)",
  async (_, live) => {
    const watches = new ModelWatches(live ? new LiveData() : undefined);
    const { reads, load } = heldLoad<string>();
    const apply = vi.fn();
    detaches.push(watches.watch("k", ["t"], load, apply, vi.fn(), vi.fn()));
    await expect.poll(() => reads.length).toBe(1);
    watches.reread(["t"]);
    reads[0]!.resolve("before the write");
    await expect.poll(() => reads.length).toBe(2);
    reads[1]!.resolve("after the write");
    await expect.poll(() => apply.mock.calls.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apply.mock.calls).toEqual([["after the write"]]);
  },
);

it("a write's reread holds back only the watches it asks to read again", async () => {
  const watches = new ModelWatches(new LiveData());
  const a = heldLoad<string>();
  const b = heldLoad<string>();
  const applyA = vi.fn();
  const applyB = vi.fn();
  detaches.push(watches.watch("a", ["t"], a.load, applyA, vi.fn(), vi.fn()));
  detaches.push(watches.watch("b", ["u"], b.load, applyB, vi.fn(), vi.fn()));
  await expect.poll(() => a.reads.length + b.reads.length).toBe(2);
  watches.reread(["t"]);
  b.reads[0]!.resolve("b first");
  await expect.poll(() => applyB.mock.calls).toEqual([["b first"]]);
  a.reads[0]!.resolve("a first");
  await expect.poll(() => a.reads.length).toBe(2);
  a.reads[1]!.resolve("a reread");
  await expect.poll(() => applyA.mock.calls.length).toBeGreaterThan(0);
  expect(applyA.mock.calls).toEqual([["a reread"]]);
  expect(applyB.mock.calls).toEqual([["b first"]]);
});

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "reread returns its hold-back point, and an applied model's read number places it before or after (%s)",
  async (_, live) => {
    const watches = new ModelWatches(live ? new LiveData() : undefined);
    const { reads, load } = heldLoad<{ name: string }>();
    const apply = vi.fn();
    detaches.push(watches.watch("k", ["t"], load, apply, vi.fn(), vi.fn()));
    await expect.poll(() => reads.length).toBe(1);
    const first = { name: "first" };
    reads[0]!.resolve(first);
    await expect.poll(() => apply.mock.calls.length).toBe(1);
    const barrier = watches.reread(["t"]);
    await expect.poll(() => reads.length).toBe(2);
    const second = { name: "second" };
    reads[1]!.resolve(second);
    await expect.poll(() => apply.mock.calls.length).toBe(2);
    expect(watches.readNumberOf(first)).toBeLessThan(barrier);
    expect(watches.readNumberOf(second)).toBeGreaterThan(barrier);
    expect(watches.readNumberOf({})).toBeUndefined();
  },
);

it("nextReadNumber falls between a read started before it and one started after", async () => {
  const watches = new ModelWatches();
  const { reads, load } = heldLoad<{ name: string }>();
  const apply = vi.fn();
  detaches.push(watches.watch("k", ["t"], load, apply, vi.fn(), vi.fn()));
  await expect.poll(() => reads.length).toBe(1);
  const mark = watches.nextReadNumber();
  const before = { name: "before" };
  const after = { name: "after" };
  reads[0]!.resolve(before);
  await expect.poll(() => apply.mock.calls.length).toBe(1);
  watches.reread(["t"]);
  await expect.poll(() => reads.length).toBe(2);
  reads[1]!.resolve(after);
  await expect.poll(() => apply.mock.calls.length).toBe(2);
  expect(watches.readNumberOf(before)).toBeLessThan(mark);
  expect(watches.readNumberOf(after)).toBeGreaterThan(mark);
  expect(watches.nextReadNumber()).toBeGreaterThan(watches.readNumberOf(after)!);
});

it("without live data, a write's reread holds back every watch, whatever its types", async () => {
  const watches = new ModelWatches();
  const { reads, load } = heldLoad<string>();
  const apply = vi.fn();
  detaches.push(watches.watch("k", ["u"], load, apply, vi.fn(), vi.fn()));
  await expect.poll(() => reads.length).toBe(1);
  watches.reread(["t"]);
  await expect.poll(() => reads.length).toBe(2);
  reads[0]!.resolve("before the write");
  reads[1]!.resolve("after the write");
  await expect.poll(() => apply.mock.calls.length).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(apply.mock.calls).toEqual([["after the write"]]);
});

it("a held-back read after a failure does not count as the recovery", async () => {
  const live = new LiveData();
  const watches = new ModelWatches(live);
  const { reads, load } = heldLoad<string>();
  const apply = vi.fn();
  const failed = vi.fn();
  const recovered = vi.fn();
  detaches.push(watches.watch("k", ["t"], load, apply, failed, recovered));
  await expect.poll(() => reads.length).toBe(1);
  reads[0]!.reject(new Error("down"));
  await expect.poll(() => failed.mock.calls.length).toBe(1);
  live.invalidate([{ type: "t" }]);
  await expect.poll(() => reads.length).toBe(2);
  watches.reread(["t"]);
  reads[1]!.resolve("before the write");
  await expect.poll(() => reads.length).toBe(3);
  expect(apply).not.toHaveBeenCalled();
  expect(recovered).not.toHaveBeenCalled();
  reads[2]!.resolve("after the write");
  await expect.poll(() => apply.mock.calls).toEqual([["after the write"]]);
  expect(recovered).toHaveBeenCalledTimes(1);
});

it("with live data, a watch attached after a write is held back from a read that started before it", async () => {
  const watches = new ModelWatches(new LiveData());
  const { reads, load } = heldLoad<string>();
  detaches.push(watches.watch("k", ["t"], load, vi.fn(), vi.fn(), vi.fn()));
  await expect.poll(() => reads.length).toBe(1);
  watches.reread(["t", "v"]);
  const apply = vi.fn();
  detaches.push(watches.watch("k", ["t"], load, apply, vi.fn(), vi.fn()));
  reads[0]!.resolve("before the write");
  await expect.poll(() => reads.length).toBe(2);
  reads[1]!.resolve("after the write");
  await expect.poll(() => apply.mock.calls.length).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(apply.mock.calls).toEqual([["after the write"]]);
});

it("with live data, a watch attached after a write on types it does not depend on takes its read", async () => {
  const watches = new ModelWatches(new LiveData());
  const { reads, load } = heldLoad<string>();
  detaches.push(watches.watch("k", ["u"], load, vi.fn(), vi.fn(), vi.fn()));
  await expect.poll(() => reads.length).toBe(1);
  watches.reread(["t"]);
  const apply = vi.fn();
  detaches.push(watches.watch("k", ["u"], load, apply, vi.fn(), vi.fn()));
  reads[0]!.resolve("before the write");
  await expect.poll(() => apply.mock.calls).toEqual([["before the write"]]);
  expect(reads).toHaveLength(1);
});

it("with live data, a watch attached straight after a write is not handed the model read before it", async () => {
  const watches = new ModelWatches(new LiveData());
  const { reads, load } = heldLoad<string>();
  const first = vi.fn();
  detaches.push(watches.watch("k", ["t"], load, first, vi.fn(), vi.fn()));
  await expect.poll(() => reads.length).toBe(1);
  reads[0]!.resolve("before the write");
  await expect.poll(() => first.mock.calls.length).toBe(1);
  watches.reread(["t"]);
  const apply = vi.fn();
  detaches.push(watches.watch("k", ["t"], load, apply, vi.fn(), vi.fn()));
  await expect.poll(() => reads.length).toBe(2);
  reads[1]!.resolve("after the write");
  await expect.poll(() => apply.mock.calls.length).toBeGreaterThan(0);
  expect(apply.mock.calls).toEqual([["after the write"]]);
});
