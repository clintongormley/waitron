import { afterEach, describe, expect, it, vi } from "vitest";
import { setImmediate as nextTurn } from "node:timers/promises";
import { setTimeout as timerTurn } from "node:timers/promises";
import { discoverRelease } from "./discovery.mjs";

const old = "a".repeat(64);
const candidate = "b".repeat(64);
const image = `sha256:${"c".repeat(64)}`;
const secondImage = `sha256:${"d".repeat(64)}`;
const now = 1_800_000_000_000;
const release = () => ({
  releaseDigest: candidate,
  sourceDigest: old,
  platform: "linux/amd64",
  minimumHostProtocol: 1,
  imageDigests: [image, secondImage],
  requiresNewInstallation: false,
});
const hold = () => ({
  kind: "clear",
  releaseDigest: candidate,
  checkedAt: now,
  expiresAt: now + 60_000,
  proofDigest: "e".repeat(64),
});

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const stopped = () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", stopped);
      resolve();
    }, ms);
    signal.addEventListener("abort", stopped, { once: true });
  });
}

function harness(overrides = {}) {
  const calls = [];
  const bytes = new Uint8Array([1, 2, 3]);
  const deps = {
    platform: "linux/amd64",
    hostProtocol: 1,
    now: () => now,
    sleep,
    fetchManifest: async (signal) => {
      calls.push(["manifest", signal]);
      return bytes;
    },
    verifyManifest: (value) => {
      expect(value).toEqual(bytes);
      return release();
    },
    hold: {
      check: async (digest, signal) => {
        calls.push(["hold", digest, signal]);
        return hold();
      },
    },
    pullImage: async (digest, signal) => {
      calls.push(["image", digest, signal]);
      return digest;
    },
    ...overrides,
  };
  return {
    deps,
    calls,
    input: { nowMs: now, installedDigest: old },
    signal: new globalThis.AbortController().signal,
  };
}

afterEach(() => vi.useRealTimers());

describe("bounded release discovery without application", () => {
  it.each(["async-wrapper", "two-awaits", "next-turn", "timer-turn"])(
    "retries timed-out adapters after %s cancellation settles",
    async (kind) => {
      vi.useFakeTimers();
      let attempts = 0;
      const stopOnAbort = (signal) =>
        new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      const h = harness({
        fetchManifest: async (signal) => {
          attempts++;
          await stopOnAbort(signal);
          if (kind === "two-awaits") {
            await Promise.resolve();
            await Promise.resolve();
          }
          if (kind === "next-turn") await nextTurn();
          if (kind === "timer-turn") await timerTurn();
          throw new Error("aborted");
        },
      });
      const pending = discoverRelease(h.input, h.deps, h.signal);
      for (let attempt = 0; attempt < 3; attempt++) {
        const beforeWait = Date.now();
        await vi.waitUntil(() => attempts === attempt + 1 && vi.getTimerCount() === 1, {
          interval: 0,
        });
        expect(Date.now()).toBe(beforeWait);
        await vi.advanceTimersByTimeAsync(30_000);
        await timerTurn();
      }
      expect(await pending).toMatchObject({ kind: "deferred", reason: "manifest-unavailable" });
      expect(attempts).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
      await timerTurn();
    },
  );

  it.each([
    null,
    {},
    { nowMs: now, installedDigest: "latest" },
    { nowMs: -1, installedDigest: old },
    { nowMs: now, installedDigest: old, extra: true },
  ])("refuses invalid discovery input before effects %#", async (input) => {
    const h = harness();
    expect(await discoverRelease(input, h.deps, h.signal)).toEqual({
      kind: "deferred",
      reason: "discovery-input",
      nextCheckMs: null,
    });
    expect(h.calls).toEqual([]);
  });

  it.each([{ platform: 5 }, { hostProtocol: -1 }, { hostProtocol: NaN }])(
    "refuses invalid host inventory %#",
    async (values) => {
      const h = harness(values);
      expect(await discoverRelease(h.input, h.deps, h.signal)).toEqual({
        kind: "deferred",
        reason: "discovery-input",
        nextCheckMs: now + 86_400_000,
      });
      expect(h.calls).toEqual([]);
    },
  );

  it("does not overflow a deferred daily deadline", async () => {
    const h = harness({
      now: () => Number.MAX_SAFE_INTEGER,
      fetchManifest: async () => {
        throw new Error("offline");
      },
    });
    expect(
      await discoverRelease(
        { nowMs: Number.MAX_SAFE_INTEGER, installedDigest: old },
        h.deps,
        h.signal,
      ),
    ).toEqual({ kind: "deferred", reason: "manifest-unavailable", nextCheckMs: null });
  });

  it.each(["verify", "hold", "image"])(
    "cancels during %s without offering or retrying",
    async (stage) => {
      const controller = new globalThis.AbortController();
      const overrides =
        stage === "verify"
          ? {
              verifyManifest: () => {
                controller.abort();
                return release();
              },
            }
          : stage === "hold"
            ? {
                hold: {
                  check: async () => {
                    controller.abort();
                    return hold();
                  },
                },
              }
            : {
                pullImage: async () => {
                  controller.abort();
                  return image;
                },
              };
      const h = harness(overrides);
      expect(await discoverRelease(h.input, h.deps, controller.signal)).toMatchObject({
        kind: "deferred",
        reason: "cancelled",
      });
      expect(h.calls.filter((c) => c[0] === "image")).toEqual([]);
    },
  );

  it("offers a verified inventory only after a fresh clear answer and every exact image", async () => {
    const h = harness();
    const result = await discoverRelease(h.input, h.deps, h.signal);
    expect(result).toEqual({ kind: "ready", release: release(), hold: hold() });
    expect(h.calls.map((c) => c.slice(0, c[0] === "manifest" ? 1 : 2))).toEqual([
      ["manifest"],
      ["hold", candidate],
      ["image", image],
      ["image", secondImage],
    ]);
    expect(Object.isFrozen(result.release)).toBe(true);
    expect(Object.isFrozen(result.release.imageDigests)).toBe(true);
  });

  it.each(["signature", "key", "platform", "protocol", "source", "digest"])(
    "defers a verifier's %s refusal before hold or image calls",
    async (reason) => {
      const h = harness({
        verifyManifest: () => {
          throw new Error(reason);
        },
      });
      expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
        kind: "deferred",
        reason: "manifest-invalid",
      });
      expect(h.calls.map((c) => c[0])).toEqual(["manifest"]);
    },
  );

  it.each([
    null,
    {},
    { ...release(), extra: true },
    { ...release(), releaseDigest: "" },
    { ...release(), sourceDigest: candidate },
    { ...release(), platform: "linux/arm64" },
    { ...release(), minimumHostProtocol: 2 },
    { ...release(), minimumHostProtocol: -1 },
    { ...release(), minimumHostProtocol: 1.5 },
    { ...release(), requiresNewInstallation: true },
    { ...release(), requiresNewInstallation: "false" },
    { ...release(), imageDigests: [] },
    { ...release(), imageDigests: [image, image] },
    { ...release(), imageDigests: ["latest"] },
    {
      ...release(),
      imageDigests: Array.from(
        { length: 17 },
        (_, i) => `sha256:${i.toString(16).padStart(64, "0")}`,
      ),
    },
  ])("refuses an invalid or incompatible verified envelope %#", async (value) => {
    const h = harness({ verifyManifest: () => value });
    expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
      kind: "deferred",
      reason: "release-incompatible",
    });
    expect(h.calls.map((c) => c[0])).toEqual(["manifest"]);
  });

  it.each([null, new Uint8Array(), new Uint8Array(65_537), "manifest"])(
    "bounds manifest input before verification %#",
    async (bytes) => {
      let verified = false;
      const h = harness({
        fetchManifest: async () => bytes,
        verifyManifest: () => {
          verified = true;
          return release();
        },
      });
      expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
        kind: "deferred",
        reason: "manifest-invalid",
      });
      expect(verified).toBe(false);
    },
  );

  it.each([
    undefined,
    { check: async () => ({ ...hold(), kind: "unknown", proofDigest: null }) },
    { check: async () => ({ ...hold(), kind: "clear", proofDigest: null }) },
    { check: async () => ({ ...hold(), releaseDigest: old }) },
    { check: async () => ({ ...hold(), extra: true }) },
    { check: async () => ({ ...hold(), checkedAt: now + 1 }) },
    { check: async () => ({ ...hold(), expiresAt: now }) },
    { check: async () => ({ ...hold(), checkedAt: NaN }) },
    { check: async () => ({ ...hold(), expiresAt: Infinity }) },
    { check: async () => null },
  ])("does not offer or pull with absent, unknown or stale hold evidence %#", async (value) => {
    const h = harness({ hold: value });
    expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
      kind: "deferred",
      reason: "hold-unknown",
    });
    expect(h.calls.filter((c) => c[0] === "image")).toEqual([]);
  });

  it("honours an authenticated held release", async () => {
    const h = harness({ hold: { check: async () => ({ ...hold(), kind: "held" }) } });
    expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
      kind: "deferred",
      reason: "release-held",
    });
    expect(h.calls.filter((c) => c[0] === "image")).toEqual([]);
  });

  it("checks hold freshness again after the image downloads", async () => {
    let clock = now;
    const h = harness({
      now: () => clock,
      pullImage: async (digest) => {
        clock = now + 60_000;
        return digest;
      },
    });
    expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
      kind: "deferred",
      reason: "hold-unknown",
    });
  });

  it.each(["manifest", "hold", "image"])(
    "makes three sequential attempts after settled %s failures",
    async (stage) => {
      let attempts = 0;
      const failing = async () => {
        attempts++;
        throw new Error("offline");
      };
      const overrides =
        stage === "manifest"
          ? { fetchManifest: failing }
          : stage === "hold"
            ? { hold: { check: failing } }
            : { pullImage: failing };
      const h = harness(overrides);
      expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
        kind: "deferred",
        reason:
          stage === "manifest"
            ? "manifest-unavailable"
            : stage === "hold"
              ? "hold-unknown"
              : "image-unavailable",
      });
      expect(attempts).toBe(3);
    },
  );

  it("succeeds after a transient failure without a fourth attempt", async () => {
    let attempts = 0;
    const h = harness({
      fetchManifest: async () => {
        if (++attempts < 3) throw new Error("offline");
        return new Uint8Array([1, 2, 3]);
      },
    });
    expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({ kind: "ready" });
    expect(attempts).toBe(3);
  });

  it("refuses a returned image digest that differs from the requested immutable digest", async () => {
    const h = harness({ pullImage: async () => `sha256:${old}` });
    expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
      kind: "deferred",
      reason: "image-digest",
    });
  });

  it.each([
    ["manifest", 30_000],
    ["hold", 30_000],
    ["image", 600_000],
  ])("bounds each cooperative %s attempt at %i ms", async (stage, budget) => {
    vi.useFakeTimers();
    let attempts = 0;
    const armed = Array.from({ length: 3 }, () => Promise.withResolvers());
    const signals = [];
    const hanging = (signal) => {
      attempts++;
      signals.push(signal);
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    };
    const overrides =
      stage === "manifest"
        ? { fetchManifest: hanging }
        : stage === "hold"
          ? { hold: { check: (_, signal) => hanging(signal) } }
          : { pullImage: (_, signal) => hanging(signal) };
    const h = harness({
      ...overrides,
      sleep: (ms, signal) => {
        const pending = sleep(ms, signal);
        if (attempts > 0) armed[attempts - 1].resolve();
        return pending;
      },
    });
    let completed = false;
    const pending = discoverRelease(h.input, h.deps, h.signal).then((result) => {
      completed = true;
      return result;
    });
    await armed[0].promise;
    await vi.advanceTimersByTimeAsync(budget - 1);
    expect(attempts).toBe(1);
    expect(completed).toBe(false);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0].aborted).toBe(true);
    await timerTurn();
    await armed[1].promise;
    await vi.advanceTimersByTimeAsync(budget);
    await timerTurn();
    await armed[2].promise;
    await vi.advanceTimersByTimeAsync(budget);
    await timerTurn();
    expect(await pending).toMatchObject({ kind: "deferred" });
    expect(attempts).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns on an uncooperative timeout but admits no retry or second discovery until it settles", async () => {
    vi.useFakeTimers();
    let finish;
    let attempts = 0;
    const h = harness({
      fetchManifest: () => {
        attempts++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    const pending = discoverRelease(h.input, h.deps, h.signal);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({ kind: "deferred", reason: "manifest-unavailable" });
    const other = harness();
    expect(await discoverRelease(other.input, other.deps, other.signal)).toMatchObject({
      kind: "deferred",
      reason: "discovery-busy",
    });
    expect(attempts).toBe(1);
    expect(other.calls).toEqual([]);
    finish(new Uint8Array([1, 2, 3]));
    await vi.advanceTimersByTimeAsync(0);
    expect(await discoverRelease(other.input, other.deps, other.signal)).toMatchObject({
      kind: "ready",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels without starting another attempt", async () => {
    const controller = new globalThis.AbortController();
    const h = harness({
      fetchManifest: async () => {
        controller.abort();
        throw new Error("cancelled");
      },
    });
    expect(await discoverRelease(h.input, h.deps, controller.signal)).toMatchObject({
      kind: "deferred",
      reason: "cancelled",
    });
    expect(h.calls).toEqual([]);
  });

  it("does no work for a pre-cancelled request", async () => {
    const controller = new globalThis.AbortController();
    controller.abort();
    const h = harness();
    expect(await discoverRelease(h.input, h.deps, controller.signal)).toMatchObject({
      kind: "deferred",
      reason: "cancelled",
    });
    expect(h.calls).toEqual([]);
  });

  it("rejects a backward or nonfinite clock", async () => {
    for (const clock of [now - 1, NaN, Infinity]) {
      const h = harness({ now: () => clock });
      expect(await discoverRelease(h.input, h.deps, h.signal)).toMatchObject({
        kind: "deferred",
        reason: "clock-uncertain",
      });
      expect(h.calls).toEqual([]);
    }
  });
});
