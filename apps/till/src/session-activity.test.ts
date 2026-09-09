import { describe, expect, it, vi } from "vitest";
import { SessionActivity } from "./session-activity.js";

function fakeWakeLock() {
  const released: boolean[] = [];
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      released.push(true);
    }),
  };
  return { request: vi.fn(async () => sentinel), sentinel, released };
}

describe("SessionActivity", () => {
  it("acquires the wake lock while a session device is logged in, releases on logout", async () => {
    const wl = fakeWakeLock();
    const sa = new SessionActivity({
      wakeLock: wl as never,
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    await sa.start();
    expect(wl.request).toHaveBeenCalledTimes(1);
    sa.configure({ loggedIn: false, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    await Promise.resolve();
    expect(wl.sentinel.release).toHaveBeenCalled();
  });

  it("fires onIdle after the timeout with no interaction, and not for KDS", () => {
    let fn: (() => void) | undefined;
    let now = 0;
    const timers = {
      setTimer: (f: () => void) => {
        fn = f;
        return 1;
      },
      clearTimer: () => {
        fn = undefined;
      },
      now: () => now,
    };
    const onIdle = vi.fn();
    const sa = new SessionActivity({
      wakeLock: { request: async () => ({ released: false, release: async () => {} }) } as never,
      ...timers,
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: 300, onIdle });
    sa.start();
    now = 300_000;
    fn?.();
    expect(onIdle).toHaveBeenCalledTimes(1);

    onIdle.mockClear();
    sa.configure({ loggedIn: true, kind: "kds_station", timeoutSeconds: 300, onIdle });
    fn?.();
    expect(onIdle).not.toHaveBeenCalled(); // KDS is exempt
  });

  it("noteInteraction() resets the idle countdown", () => {
    let fn: (() => void) | undefined;
    let now = 0;
    const timers = {
      setTimer: (f: () => void) => {
        fn = f;
        return 1;
      },
      clearTimer: () => {},
      now: () => now,
    };
    const onIdle = vi.fn();
    const sa = new SessionActivity({
      wakeLock: { request: async () => ({ released: false, release: async () => {} }) } as never,
      ...timers,
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: 300, onIdle });
    sa.start();
    // Interaction at 200s pushes the deadline out to 500s.
    now = 200_000;
    sa.noteInteraction();
    // The original 300s mark arrives — but the reset moved the deadline, so no logout yet.
    now = 300_000;
    fn?.();
    expect(onIdle).not.toHaveBeenCalled();
    // The reset deadline arrives.
    now = 500_000;
    fn?.();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("KDS holds the wake lock while active even though it never logs in", async () => {
    const wl = fakeWakeLock();
    const sa = new SessionActivity({
      wakeLock: wl as never,
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    sa.configure({ loggedIn: false, kind: "kds_station", timeoutSeconds: null, onIdle: () => {} });
    await sa.start();
    expect(wl.request).toHaveBeenCalledTimes(1);
  });

  it("stop() releases the wake lock and cancels the idle timer", async () => {
    const wl = fakeWakeLock();
    const cleared: number[] = [];
    const sa = new SessionActivity({
      wakeLock: wl as never,
      now: () => 0,
      setTimer: () => 7,
      clearTimer: (h) => cleared.push(h),
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: 300, onIdle: () => {} });
    await sa.start();
    await sa.stop();
    expect(wl.sentinel.release).toHaveBeenCalled();
    expect(cleared).toContain(7);
  });

  it("is a clean no-op when the Wake Lock API is absent", async () => {
    // No wakeLock injected and no `navigator.wakeLock` in this branch would leave the feature undefined;
    // pass an explicit undefined to exercise the feature-absent path deterministically.
    const sa = new SessionActivity({
      wakeLock: undefined,
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    await expect(sa.start()).resolves.toBeUndefined();
    await expect(sa.stop()).resolves.toBeUndefined();
  });

  it("swallows a wake-lock request that rejects (hidden tab / policy) — never fatal", async () => {
    const request = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    const onIdle = vi.fn();
    const sa = new SessionActivity({
      wakeLock: { request } as never,
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: null, onIdle });
    await expect(sa.start()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    // A later release with no sentinel held is a clean no-op.
    await expect(sa.stop()).resolves.toBeUndefined();
  });

  it("swallows a sentinel release that rejects", async () => {
    const sentinel = {
      released: false,
      release: vi.fn(async () => {
        throw new Error("release failed");
      }),
    };
    const sa = new SessionActivity({
      wakeLock: { request: async () => sentinel } as never,
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    await sa.start();
    await expect(sa.stop()).resolves.toBeUndefined();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("reacquire() re-requests the wake lock after the browser dropped it on hide", async () => {
    const wl = fakeWakeLock();
    const sa = new SessionActivity({
      wakeLock: wl as never,
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    await sa.start();
    expect(wl.request).toHaveBeenCalledTimes(1);
    // The browser released the sentinel when the tab hid.
    wl.sentinel.released = true;
    sa.reacquire();
    await Promise.resolve();
    expect(wl.request).toHaveBeenCalledTimes(2);
  });

  it("releases a wake lock whose request resolves AFTER stop() — no strand (C3)", async () => {
    // The request is in flight when stop()/logout happens; it resolves afterwards. The late sentinel
    // must be released, not stored — a stored one would keep the screen awake with no way to give it
    // back. Before the fix release was called 0 times (the sentinel was stranded).
    let resolveRequest!: (s: unknown) => void;
    const sentinel = { released: false, release: vi.fn(async () => {}) };
    const request = vi.fn(() => new Promise((r) => (resolveRequest = r as (s: unknown) => void)));
    const sa = new SessionActivity({
      wakeLock: { request } as never,
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    const started = sa.start(); // request now pending
    await sa.stop(); // stop BEFORE the request resolves
    resolveRequest(sentinel); // the in-flight request resolves late
    await started;
    await Promise.resolve();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping acquisitions to a single retained sentinel (C3)", async () => {
    // Two requests in flight at once (e.g. reacquire racing an earlier acquire): the superseded one is
    // released, the current one retained, so stop() later has exactly one live sentinel to give back —
    // never a stranded one. Before the fix the second overwrote the first's reference (1 unreleased).
    const resolvers: Array<(s: unknown) => void> = [];
    const sentinels = [
      { released: false, release: vi.fn(async () => {}) },
      { released: false, release: vi.fn(async () => {}) },
    ];
    const request = vi.fn(() => new Promise((r) => resolvers.push(r as (s: unknown) => void)));
    const sa = new SessionActivity({
      wakeLock: { request } as never,
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    const started = sa.start(); // request #1 in flight
    sa.reacquire(); // request #2 in flight (#sentinel still undefined, so it proceeds)
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    // Resolve the SUPERSEDED request #1 first — it must release its sentinel, not store it.
    resolvers[0]!(sentinels[0]);
    await started;
    await Promise.resolve();
    // Resolve the CURRENT request #2 — it is retained.
    resolvers[1]!(sentinels[1]);
    await Promise.resolve();
    await Promise.resolve();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1); // superseded → released
    expect(sentinels[1].release).not.toHaveBeenCalled(); // current → held
    // The single retained sentinel is the one stop() gives back — no strand.
    await sa.stop();
    expect(sentinels[1].release).toHaveBeenCalledTimes(1);
  });
});
