import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  SALE_SOURCES,
  SOURCES,
  deviceOrigin,
  isSaleOrigin,
  jobOrigin,
  readOrigin,
  readSaleOrigin,
} from "./origin.js";

const DEVICE = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("the source vocabulary", () => {
  it("lists exactly the spec's sources, in order", () => {
    expect(SOURCES).toEqual([
      "device",
      "dashboard",
      "fiscal_filing",
      "payment_check",
      "kitchen_timer",
      "demo_seed",
      "readiness_test",
    ]);
  });

  it("allows a sale only from a device, the demo seed or the readiness test", () => {
    expect(SALE_SOURCES).toEqual(["device", "demo_seed", "readiness_test"]);
  });
});

describe("origins", () => {
  it("a device origin carries the device, folded to lower case", () => {
    expect(deviceOrigin(DEVICE.toUpperCase())).toEqual({ source: "device", deviceId: DEVICE });
  });

  it("a job origin carries no device", () => {
    expect(jobOrigin("fiscal_filing")).toEqual({ source: "fiscal_filing", deviceId: null });
  });

  it("reads a stored pair back", () => {
    expect(readOrigin("device", DEVICE)).toEqual({ source: "device", deviceId: DEVICE });
    expect(readOrigin("dashboard", null)).toEqual({ source: "dashboard", deviceId: null });
  });

  it.each([
    ["system", null],
    ["device", null],
    ["dashboard", DEVICE],
  ])("refuses the stored pair (%s, %s)", (source, device) => {
    const caught = (() => {
      try {
        readOrigin(source, device);
      } catch (error) {
        return error;
      }
    })();
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("origin.invalid");
    expect((caught as AppError).params).toEqual({ source, deviceId: device });
  });

  it("refuses a stored device that is not an id", () => {
    expect(() => readOrigin("device", "not-a-uuid")).toThrow(
      expect.objectContaining({
        code: "shared.invalid_id",
        params: { kind: "DeviceId", value: "not-a-uuid" },
      }),
    );
  });

  it("tells a sale origin from any other", () => {
    expect(isSaleOrigin(deviceOrigin(DEVICE))).toBe(true);
    expect(isSaleOrigin(jobOrigin("demo_seed"))).toBe(true);
    expect(isSaleOrigin(jobOrigin("readiness_test"))).toBe(true);
    expect(isSaleOrigin(jobOrigin("dashboard"))).toBe(false);
    expect(isSaleOrigin(jobOrigin("payment_check"))).toBe(false);
  });

  it("reads a stored sale pair back", () => {
    expect(readSaleOrigin("device", DEVICE)).toEqual({ source: "device", deviceId: DEVICE });
    expect(readSaleOrigin("readiness_test", null)).toEqual(jobOrigin("readiness_test"));
  });

  it.each([
    ["dashboard", null],
    ["device", null],
  ])("refuses (%s, %s) as a sale's stored pair", (source, device) => {
    expect(() => readSaleOrigin(source, device)).toThrow(
      expect.objectContaining({ code: "origin.invalid", params: { source, deviceId: device } }),
    );
  });
});
