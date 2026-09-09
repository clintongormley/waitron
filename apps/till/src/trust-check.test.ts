import { describe, expect, it, vi } from "vitest";
import { isTrustBroken, type NavigatorLike } from "./trust-check.js";

function navWith(register: () => Promise<unknown>): NavigatorLike {
  return { serviceWorker: { register: vi.fn(register) } };
}

describe("isTrustBroken", () => {
  it("is true when the probe rejects with a SecurityError (the click-through signal)", async () => {
    const nav = navWith(async () => {
      throw new DOMException("registration blocked", "SecurityError");
    });
    await expect(isTrustBroken(nav)).resolves.toBe(true);
  });

  it("is false when the probe registers (trusted origin)", async () => {
    const nav = navWith(async () => ({}));
    await expect(isTrustBroken(nav)).resolves.toBe(false);
  });

  it("is false when serviceWorker is absent (can't tell → not broken)", async () => {
    await expect(isTrustBroken({})).resolves.toBe(false);
  });

  it("is false, not a throw, on a generic/network rejection (404, offline)", async () => {
    const nav = navWith(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(isTrustBroken(nav)).resolves.toBe(false);
  });

  it("never throws even when register throws synchronously", async () => {
    const nav: NavigatorLike = {
      serviceWorker: {
        register: () => {
          throw new Error("boom");
        },
      },
    };
    await expect(isTrustBroken(nav)).resolves.toBe(false);
  });

  it("resolves false within the timeout when register never settles (the till must always boot — C4)", async () => {
    // A registration that hangs forever must not hang boot: the bounded probe resolves "not broken"
    // when the timeout wins, so main.ts mounts the till. Uses a short real timeout.
    const nav = navWith(() => new Promise<unknown>(() => {})); // never resolves
    await expect(isTrustBroken(nav, 10)).resolves.toBe(false);
  });
});
