import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  withDevDeviceHeader,
  readDevDeviceId,
  setDevDeviceId,
  clearDevDeviceId,
  DEV_DEVICE_STORAGE_KEY,
  DEV_DEVICE_HEADER,
} from "./dev-device.js";

beforeEach(() => sessionStorage.clear());

describe("readDevDeviceId / setDevDeviceId", () => {
  it("round-trips a stored id under the documented key", () => {
    setDevDeviceId("dev-123");
    expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBe("dev-123");
    expect(readDevDeviceId()).toBe("dev-123");
  });

  it("reads null when nothing is stored", () => {
    expect(readDevDeviceId()).toBeNull();
  });

  it("treats an empty stored value as no override", () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "");
    expect(readDevDeviceId()).toBeNull();
  });

  it("degrades to no override when getItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readDevDeviceId()).toBeNull();
    spy.mockRestore();
  });

  it("swallows a throwing setItem (blocked/private-window storage)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setDevDeviceId("dev-123")).not.toThrow();
    spy.mockRestore();
  });

  it("clearDevDeviceId removes a stored override", () => {
    setDevDeviceId("dev-123");
    clearDevDeviceId();
    expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBeNull();
    expect(readDevDeviceId()).toBeNull();
  });

  it("swallows a throwing removeItem (blocked/private-window storage)", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => clearDevDeviceId()).not.toThrow();
    spy.mockRestore();
  });
});

describe("withDevDeviceHeader", () => {
  it("adds x-waitron-dev-device iff sessionStorage holds the key", async () => {
    const base = vi.fn<typeof fetch>(async () => new Response(null));
    setDevDeviceId("dev-123");
    await withDevDeviceHeader(base as unknown as typeof fetch)("/x");
    const init = base.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get(DEV_DEVICE_HEADER)).toBe("dev-123");
    expect(DEV_DEVICE_HEADER).toBe("x-waitron-dev-device");
  });

  it("omits the header when no id is stored", async () => {
    const base = vi.fn<typeof fetch>(async () => new Response(null));
    await withDevDeviceHeader(base as unknown as typeof fetch)("/x");
    const init = (base.mock.calls[0][1] ?? {}) as RequestInit;
    expect(new Headers(init.headers).get("x-waitron-dev-device")).toBeNull();
  });

  it("preserves the caller's init headers alongside the override", async () => {
    const base = vi.fn<typeof fetch>(async () => new Response(null));
    setDevDeviceId("dev-123");
    await withDevDeviceHeader(base as unknown as typeof fetch)("/x", {
      headers: { "content-type": "application/json" },
    });
    const init = base.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-waitron-dev-device")).toBe("dev-123");
  });

  it("degrades to no header if sessionStorage throws", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const base = vi.fn<typeof fetch>(async () => new Response(null));
    await expect(
      withDevDeviceHeader(base as unknown as typeof fetch)("/x"),
    ).resolves.toBeInstanceOf(Response);
    spy.mockRestore();
  });
});
