import { afterEach, describe, expect, it, vi } from "vitest";
import * as shared from "./index.js";

afterEach(() => vi.restoreAllMocks());

describe("classifyTimeZone", () => {
  it.each([undefined, null, "", "   "])("classifies %j as missing", (value) => {
    expect(shared.classifyTimeZone(value)).toStrictEqual({ kind: "missing" });
  });

  it.each(["Invalid/Zone", "+02:00", "-05:30", "+0200", 0, false, [], {}])(
    "classifies %j as invalid",
    (value) => {
      expect(shared.classifyTimeZone(value)).toStrictEqual({ kind: "invalid" });
    },
  );

  it.each([
    [" Europe/Madrid ", "Europe/Madrid"],
    ["US/Eastern", "America/New_York"],
    ["GB", "Europe/London"],
    ["UTC", "UTC"],
    ["Etc/UTC", "UTC"],
  ])("normalizes the supported named zone %s", (value, timeZone) => {
    expect(shared.classifyTimeZone(value)).toStrictEqual({ kind: "valid", timeZone });
  });

  it("does not treat a resolved-options fault as a rejected zone name", () => {
    const failure = new RangeError("runtime options unavailable");
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(() => {
      throw failure;
    });
    expect(() => shared.classifyTimeZone("Europe/Madrid")).toThrow(failure);
  });

  it("propagates runtime faults instead of offering zone repair", () => {
    const failure = new Error("formatter unavailable");
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      throw failure;
    });
    expect(() => shared.classifyTimeZone("Europe/Madrid")).toThrow(failure);
  });
});

describe("timeZoneOffsetMinutes", () => {
  it.each([
    ["Europe/Madrid", "2026-01-15T23:30:00Z", 60],
    ["Europe/Madrid", "2026-10-14T23:30:00Z", 120],
    ["Europe/Madrid", "2026-03-29T00:59:59Z", 60],
    ["Europe/Madrid", "2026-03-29T01:00:00Z", 120],
    ["Europe/Madrid", "2026-10-25T00:30:00Z", 120],
    ["Europe/Madrid", "2026-10-25T01:30:00Z", 60],
    ["Atlantic/Canary", "2026-01-15T12:00:00Z", 0],
    ["Atlantic/Canary", "2026-07-15T12:00:00Z", 60],
    ["America/New_York", "2026-01-15T12:00:00Z", -300],
    ["Asia/Kathmandu", "2026-01-15T12:00:00Z", 345],
    ["UTC", "2026-01-15T12:00:00Z", 0],
  ])("converts %s at %s to %i minutes", (zone, at, expected) => {
    const instant = new Date(at);
    expect(shared.timeZoneOffsetMinutes(zone, instant)).toBe(expected);
    expect(instant.toISOString()).toBe(new Date(at).toISOString());
  });

  it("refuses an invalid instant independently of zone validity", () => {
    expect(() => shared.timeZoneOffsetMinutes("Europe/Madrid", new Date(NaN))).toThrowError(
      expect.objectContaining({
        code: "venue.time_zone_conversion_failed",
        params: { reason: "invalid_instant" },
      }),
    );
  });

  it.each([undefined, "UTC", "GMT+01:60", "GMT+24:00", "GMT+00:00:01"])(
    "refuses unreadable offset %j without making the name invalid",
    (value) => {
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue(
        value === undefined ? [] : [{ type: "timeZoneName", value }],
      );
      expect(shared.classifyTimeZone("Europe/Madrid")).toStrictEqual({
        kind: "valid",
        timeZone: "Europe/Madrid",
      });
      expect(() => shared.timeZoneOffsetMinutes("Europe/Madrid", new Date(0))).toThrowError(
        expect.objectContaining({
          code: "venue.time_zone_conversion_failed",
          params: { reason: "unreadable_offset" },
        }),
      );
    },
  );

  it("propagates a formatting fault independently of zone eligibility", () => {
    const failure = new Error("conversion unavailable");
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(() => {
      throw failure;
    });
    expect(() => shared.timeZoneOffsetMinutes("Europe/Madrid", new Date(0))).toThrow(failure);
  });
});

describe("classifySavedTimeZone", () => {
  it.each([undefined, null, "", "   "])("classifies saved %j as missing", (value) => {
    expect(shared.classifySavedTimeZone(value)).toStrictEqual({ kind: "missing" });
  });
  it.each([" Europe/Madrid", "Europe/Madrid ", "Invalid/Zone", "+02:00", 0, false, [], {}])(
    "rejects saved %j without normalizing it",
    (value) => {
      expect(shared.classifySavedTimeZone(value)).toStrictEqual({ kind: "invalid" });
    },
  );
  it.each([
    ["Europe/Madrid", "Europe/Madrid"],
    ["US/Eastern", "America/New_York"],
    ["UTC", "UTC"],
  ])("accepts the runtime-readable saved %s", (value, timeZone) => {
    expect(shared.classifySavedTimeZone(value)).toStrictEqual({ kind: "valid", timeZone });
  });
  it("propagates an unexpected runtime failure for a saved name", () => {
    const failure = new Error("formatter unavailable");
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      throw failure;
    });
    expect(() => shared.classifySavedTimeZone("Europe/Madrid")).toThrow(failure);
  });
});
