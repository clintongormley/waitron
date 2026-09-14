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
    await expect(isTrustBroken({ nav, protocol: "https:" })).resolves.toBe(true);
  });

  it("is false over plain HTTP even when the probe rejects with a SecurityError", async () => {
    // No certificate exists to distrust on http:. The Vite dev server answers the missing probe with
    // its HTML page, and Chromium refuses an HTML service worker with a SecurityError too.
    const nav = navWith(async () => {
      throw new DOMException(
        "The script has an unsupported MIME type ('text/html').",
        "SecurityError",
      );
    });
    await expect(isTrustBroken({ nav, protocol: "http:" })).resolves.toBe(false);
    expect(nav.serviceWorker?.register).not.toHaveBeenCalled();
  });

  it("does not probe on the http: test page when no protocol is given", async () => {
    expect(location.protocol).toBe("http:");
    const nav = navWith(async () => {
      throw new DOMException("registration blocked", "SecurityError");
    });
    await expect(isTrustBroken({ nav })).resolves.toBe(false);
    expect(nav.serviceWorker?.register).not.toHaveBeenCalled();
  });

  it("is false, not a throw, when reading serviceWorker itself throws", async () => {
    const nav = {
      get serviceWorker(): NavigatorLike["serviceWorker"] {
        throw new DOMException("Access to service workers is denied", "SecurityError");
      },
    };
    await expect(isTrustBroken({ nav, protocol: "https:" })).resolves.toBe(false);
  });

  it("is false when the probe registers (trusted origin)", async () => {
    const nav = navWith(async () => ({}));
    await expect(isTrustBroken({ nav, protocol: "https:" })).resolves.toBe(false);
  });

  it("is false when serviceWorker is absent (can't tell → not broken)", async () => {
    await expect(isTrustBroken({ nav: {}, protocol: "https:" })).resolves.toBe(false);
  });

  it("is false, not a throw, on a generic/network rejection (404, offline)", async () => {
    const nav = navWith(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(isTrustBroken({ nav, protocol: "https:" })).resolves.toBe(false);
  });

  it("never throws even when register throws synchronously", async () => {
    const nav: NavigatorLike = {
      serviceWorker: {
        register: () => {
          throw new Error("boom");
        },
      },
    };
    await expect(isTrustBroken({ nav, protocol: "https:" })).resolves.toBe(false);
  });

  it("resolves false within the timeout when register never settles (the till must always boot — C4)", async () => {
    // A registration that hangs forever must not hang boot: the bounded probe resolves "not broken"
    // when the timeout wins, so main.ts mounts the till. Uses a short real timeout.
    const nav = navWith(() => new Promise<unknown>(() => {})); // never resolves
    const started = performance.now();
    await expect(isTrustBroken({ nav, timeoutMs: 10, protocol: "https:" })).resolves.toBe(false);
    // Settling well before the 1500 ms default shows the given deadline was used.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
