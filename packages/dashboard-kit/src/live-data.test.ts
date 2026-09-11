import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "./live-data.js";

afterEach(() => vi.useRealTimers());

describe("observed resources", () => {
  it("tracks the resource interests of mounted observers", async () => {
    const data = new LiveData();
    const changed = vi.fn();
    const stop = data.subscribeToInterests(changed);
    const a = data.observe(
      { key: "a", dependencies: [{ type: "printers", id: "p1" }], read: async () => 1 },
      () => {},
    );
    expect(data.interests).toEqual([{ type: "printers", id: "p1" }]);
    expect(changed).toHaveBeenCalledOnce();
    a.unsubscribe();
    expect(data.interests).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
  });
  it("refreshes every display of a changed object through one shared read", async () => {
    const data = new LiveData();
    let pending = 0;
    const read = vi.fn(async () => ({ pending }));
    const spec = { key: "printer/p1", dependencies: [{ type: "printer", id: "p1" }], read };
    const left = vi.fn();
    const right = vi.fn();
    const a = data.observe(spec, left);
    const b = data.observe(spec, right);
    await vi.waitFor(() => expect(a.snapshot.value).toEqual({ pending: 0 }));
    expect(read).toHaveBeenCalledTimes(1);

    pending = 2;
    data.invalidate([{ type: "printer", id: "p1" }]);
    await vi.waitFor(() => expect(a.snapshot.value).toEqual({ pending: 2 }));
    expect(b.snapshot.value).toEqual({ pending: 2 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(left).toHaveBeenCalled();
    expect(right).toHaveBeenCalled();
    a.unsubscribe();
    b.unsubscribe();
  });

  it("ignores unrelated objects but refreshes a collection when a new member appears", async () => {
    const data = new LiveData();
    const readObject = vi.fn(async () => "printer");
    const readCollection = vi.fn(async () => ["printer"]);
    const object = data.observe(
      { key: "printer/p1", dependencies: [{ type: "printer", id: "p1" }], read: readObject },
      () => {},
    );
    const collection = data.observe(
      { key: "printers", dependencies: [{ type: "printer" }], read: readCollection },
      () => {},
    );
    await vi.waitFor(() => expect(collection.snapshot.value).toEqual(["printer"]));
    data.invalidate([{ type: "printer", id: "p2" }]);
    await vi.waitFor(() => expect(readCollection).toHaveBeenCalledTimes(2));
    expect(readObject).toHaveBeenCalledTimes(1);
    object.unsubscribe();
    collection.unsubscribe();
  });

  it("remembers changes during a read and does not overlap requests", async () => {
    const data = new LiveData();
    let complete!: (value: number) => void;
    const read = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    );
    const observed = data.observe(
      { key: "queue/p1", dependencies: [{ type: "print-queue", id: "p1" }], read },
      () => {},
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    data.invalidate([{ type: "print-queue", id: "p1" }]);
    data.invalidate([{ type: "print-queue", id: "p1" }]);
    expect(read).toHaveBeenCalledTimes(1);
    complete(1);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    complete(3);
    await vi.waitFor(() => expect(observed.snapshot.value).toBe(3));
    observed.unsubscribe();
  });

  it("releases the last observer and ignores its late result", async () => {
    const data = new LiveData();
    let complete!: (value: number) => void;
    const listener = vi.fn();
    const read = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    );
    const observed = data.observe(
      { key: "printer/p1", dependencies: [{ type: "printer", id: "p1" }], read },
      listener,
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    observed.unsubscribe();
    listener.mockClear();
    complete(1);
    await Promise.resolve();
    data.invalidate([{ type: "printer", id: "p1" }]);
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps the last snapshot on failure and recovers on the next invalidation", async () => {
    const data = new LiveData();
    const read = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce({ code: "server.internal" })
      .mockResolvedValue(2);
    const observed = data.observe(
      { key: "jobs", dependencies: [{ type: "print-job" }], read },
      () => {},
    );
    await vi.waitFor(() => expect(observed.snapshot.value).toBe(1));
    data.invalidate([{ type: "print-job" }]);
    await vi.waitFor(() => expect(observed.snapshot.error).toEqual({ code: "server.internal" }));
    expect(observed.snapshot.value).toBe(1);
    data.invalidate([{ type: "print-job" }]);
    await vi.waitFor(() => expect(observed.snapshot.value).toBe(2));
    expect(observed.snapshot.error).toBeUndefined();
    observed.unsubscribe();
  });

  it("refreshes active queries after reconnecting, preserving their filters", async () => {
    const data = new LiveData();
    const read = vi.fn(async () => ({ status: "failed", limit: 20 }));
    const observed = data.observe(
      { key: "jobs?status=failed&limit=20", dependencies: [{ type: "print-job" }], read },
      () => {},
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    data.refresh();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(observed.snapshot.value).toEqual({ status: "failed", limit: 20 });
    observed.unsubscribe();
  });

  it("clears session-owned snapshots and prevents pending work from repopulating them", async () => {
    const data = new LiveData();
    const listener = vi.fn();
    const observed = data.observe(
      { key: "jobs", dependencies: [{ type: "print-job" }], read: async () => ["private job"] },
      listener,
    );
    await vi.waitFor(() => expect(observed.snapshot.value).toEqual(["private job"]));
    data.clear();
    expect(observed.snapshot.value).toBeUndefined();
    data.invalidate([{ type: "print-job" }]);
    await Promise.resolve();
    expect(observed.snapshot.value).toBeUndefined();
    observed.unsubscribe();
  });

  it("can refresh a time-dependent query on a timer and stops when detached", async () => {
    vi.useFakeTimers();
    const data = new LiveData();
    const read = vi.fn(async () => Date.now());
    const observed = data.observe(
      { key: "overdue", dependencies: [{ type: "order" }], read, refreshMs: 30_000 },
      () => {},
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(2);
    observed.unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
