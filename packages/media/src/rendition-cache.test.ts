import { expect, it, vi } from "vitest";
import { RenditionCache } from "./rendition-cache.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
it("shares in-flight recipes and serializes distinct rendering work", async () => {
  const cache = new RenditionCache();
  const gate = deferred<Uint8Array>();
  const first = vi.fn(() => gate.promise);
  const second = vi.fn(async () => new Uint8Array([2]));
  const a = cache.get("a", first);
  const same = cache.get("a", first);
  const b = cache.get("b", second);
  await Promise.resolve();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  gate.resolve(new Uint8Array([1]));
  expect(await a).toEqual(new Uint8Array([1]));
  expect(await same).toEqual(new Uint8Array([1]));
  expect(await b).toEqual(new Uint8Array([2]));
  expect(second).toHaveBeenCalledTimes(1);
});
it("rejects queue overflow but admits a duplicate at capacity and recovers after failure", async () => {
  const cache = new RenditionCache({ maxPending: 1 });
  const gate = deferred<Uint8Array>();
  const a = cache.get("a", () => gate.promise);
  const failure = expect(a).rejects.toThrow("decode failed");
  const b = cache.get("b", async () => new Uint8Array([2]));
  const duplicate = cache.get("b", async () => new Uint8Array([99]));
  await expect(cache.get("c", async () => new Uint8Array([3]))).rejects.toMatchObject({
    code: "image.busy",
  });
  gate.reject(new Error("decode failed"));
  await failure;
  expect(await b).toEqual(new Uint8Array([2]));
  expect(await duplicate).toEqual(new Uint8Array([2]));
  expect(await cache.get("a", async () => new Uint8Array([4]))).toEqual(new Uint8Array([4]));
});
it("evicts least recently read bytes and never retains an oversized result", async () => {
  const cache = new RenditionCache({ maxBytes: 4 });
  const render = vi.fn(async () => new Uint8Array([1, 2]));
  await cache.get("a", render);
  await cache.get("b", render);
  await cache.get("a", render);
  await cache.get("c", render);
  expect(render).toHaveBeenCalledTimes(3);
  await cache.get("a", render);
  expect(render).toHaveBeenCalledTimes(3);
  await cache.get("b", render);
  expect(render).toHaveBeenCalledTimes(4);
  const oversized = vi.fn(async () => new Uint8Array(5));
  await cache.get("huge", oversized);
  await cache.get("huge", oversized);
  expect(oversized).toHaveBeenCalledTimes(2);
});
it("releases the rendering gate when a producer throws synchronously", async () => {
  const cache = new RenditionCache();
  await expect(
    cache.get("bad", () => {
      throw new Error("sync");
    }),
  ).rejects.toThrow("sync");
  expect(await cache.get("good", async () => new Uint8Array([8]))).toEqual(new Uint8Array([8]));
});
it("bounds the default queue to 100 distinct waiting recipes", async () => {
  const cache = new RenditionCache();
  const gate = deferred<Uint8Array>();
  const active = cache.get("active", () => gate.promise);
  const waiting = Array.from({ length: 100 }, (_, i) =>
    cache.get(`recipe-${i}`, async () => new Uint8Array([i])),
  );
  const overflow = cache
    .get("overflow", async () => new Uint8Array([0]))
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
  gate.resolve(new Uint8Array([255]));
  await active;
  expect(await overflow).toMatchObject({ ok: false, error: { code: "image.busy" } });
  const results = await Promise.all(waiting);
  expect(results.map((result) => result[0])).toEqual(Array.from({ length: 100 }, (_, i) => i));
});
it("keeps at most 32 MiB of completed bytes by default", async () => {
  const cache = new RenditionCache();
  const first = vi.fn(async () => new Uint8Array(16 * 1024 * 1024));
  const second = vi.fn(async () => new Uint8Array(16 * 1024 * 1024));
  await cache.get("a", first);
  await cache.get("b", second);
  await cache.get("a", first);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  await cache.get("c", async () => new Uint8Array(1));
  await cache.get("a", first);
  await cache.get("b", second);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
});
