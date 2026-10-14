import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { ModelWatches } from "./model-watch.js";

type Held<T> = { resolve: (value: T) => void };

function heldLoad<T>() {
  const reads: Held<T>[] = [];
  const load = () => new Promise<T>((resolve) => reads.push({ resolve }));
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
