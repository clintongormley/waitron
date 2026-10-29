import { describe, expect, it } from "vitest";
import { initialUpdateSettings, saveUpdateSettings } from "./settings.mjs";
import { parseUpdateSettings, parseUpdateSettingsDraft } from "./contracts.mjs";

const clock = "a".repeat(64);
const changedClock = "b".repeat(64);
const settings = () => ({
  version: 1,
  revision: 0,
  automatic: true,
  start: "03:00",
  end: "05:00",
  timeZone: "Europe/Madrid",
  clockDigest: clock,
  clockReviewRequired: false,
});
const draft = () => ({ automatic: true, start: "01:30", end: "08:00", reviewedClockDigest: clock });

describe("update settings", () => {
  it("initialises the editable automatic window without an initial save", () => {
    expect(initialUpdateSettings("Europe/Madrid", clock)).toEqual(settings());
  });

  it("saves custom hours and a pause without changing the original", () => {
    const original = settings();
    const custom = saveUpdateSettings(original, draft(), 0);
    expect(custom).toEqual({ ...original, revision: 1, start: "01:30", end: "08:00" });
    const paused = saveUpdateSettings(custom, { ...draft(), automatic: false }, 1);
    expect(paused).toEqual({ ...custom, revision: 2, automatic: false });
    expect(original).toEqual(settings());
  });

  it("round-trips an explicitly unset pair without reinstalling defaults", () => {
    const unset = saveUpdateSettings(settings(), { ...draft(), start: null, end: null }, 0);
    const restarted = parseUpdateSettings(JSON.parse(JSON.stringify(unset)));
    expect(restarted).toEqual({ ...settings(), revision: 1, start: null, end: null });
  });

  it("requires fresh clock review after a zone or pending-cutover change", () => {
    const changed = {
      ...settings(),
      timeZone: "Europe/London",
      clockDigest: changedClock,
      clockReviewRequired: true,
    };
    expect(() => saveUpdateSettings(changed, draft(), 0)).toThrowError(
      expect.objectContaining({ reason: "clock-review" }),
    );
    expect(
      saveUpdateSettings(changed, { ...draft(), reviewedClockDigest: changedClock }, 0),
    ).toEqual({
      ...changed,
      revision: 1,
      start: "01:30",
      end: "08:00",
      clockReviewRequired: false,
    });
  });

  it.each([-1, 1, NaN, Infinity, "0", null])("refuses stale or invalid revision %s", (revision) => {
    expect(() => saveUpdateSettings(settings(), draft(), revision)).toThrowError(
      expect.objectContaining({ reason: "settings-revision" }),
    );
  });

  it("does not overflow the saved revision", () => {
    expect(() =>
      saveUpdateSettings(
        { ...settings(), revision: Number.MAX_SAFE_INTEGER },
        draft(),
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrowError(expect.objectContaining({ reason: "settings-revision" }));
  });

  it.each([
    null,
    [],
    {},
    { ...draft(), automatic: "true" },
    { ...draft(), start: null },
    { ...draft(), end: null },
    { ...draft(), start: "" },
    { ...draft(), end: "" },
    { ...draft(), start: "3:00" },
    { ...draft(), start: "24:00" },
    { ...draft(), end: "08:60" },
    { ...draft(), start: "08:00" },
    { ...draft(), reviewedClockDigest: "" },
    { ...draft(), reviewedClockDigest: 4 },
    { ...draft(), clockReviewRequired: false },
    { ...draft(), path: "/tmp/settings" },
    { automatic: true, start: "03:00", end: "05:00" },
  ])("rejects a malformed draft %#", (value) => {
    expect(() => parseUpdateSettingsDraft(value)).toThrowError(
      expect.objectContaining({ code: "upgrade.invalid_settings", reason: "settings-invalid" }),
    );
    expect(() => saveUpdateSettings(settings(), value, 0)).toThrowError(
      expect.objectContaining({ reason: "settings-invalid" }),
    );
  });

  it.each([
    null,
    [],
    {},
    { ...settings(), version: 2 },
    { ...settings(), unknown: true },
    { ...settings(), revision: -1 },
    { ...settings(), revision: 1.5 },
    { ...settings(), automatic: 1 },
    { ...settings(), start: null },
    { ...settings(), end: "03:00" },
    { ...settings(), timeZone: "" },
    { ...settings(), timeZone: "+01:00" },
    { ...settings(), timeZone: "No/Such_Zone" },
    { ...settings(), clockDigest: "" },
    { ...settings(), clockReviewRequired: 0 },
  ])("rejects a malformed stored record %#", (value) => {
    expect(() => parseUpdateSettings(value)).toThrowError(
      expect.objectContaining({ reason: "settings-invalid" }),
    );
  });

  it.each([
    ["No/Such_Zone", clock],
    ["", clock],
    ["UTC", ""],
    ["UTC", 4],
  ])("refuses invalid initial binding %s", (zone, digest) => {
    expect(() => initialUpdateSettings(zone, digest)).toThrowError(
      expect.objectContaining({ reason: "settings-invalid" }),
    );
  });

  it("retains a complete valid draft and makes independent parsed records", () => {
    const value = settings();
    expect(parseUpdateSettingsDraft(draft())).toEqual(draft());
    expect(parseUpdateSettings(value)).not.toBe(value);
  });
});
