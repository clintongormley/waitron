import { describe, expect, it } from "vitest";
import { activationInstant, checkedTimeZone, localTimeOf } from "./menu-publication-time.js";

const MADRID = "Europe/Madrid";

function refusal(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("activationInstant", () => {
  it("reads a venue-local date and time as the instant the venue clock shows it", () => {
    expect(activationInstant({ date: "2026-10-08", time: "08:00" }, MADRID)).toEqual(
      new Date("2026-10-08T06:00:00Z"),
    );
  });

  it("refuses a minute the spring clock change skips", () => {
    expect(
      refusal(() => activationInstant({ date: "2027-03-28", time: "02:30" }, MADRID)),
    ).toMatchObject({
      code: "menu_publication.time_skipped",
      params: { date: "2027-03-28", time: "02:30" },
    });
  });

  it("refuses a minute the autumn clock change repeats until one occurrence is chosen", () => {
    expect(
      refusal(() => activationInstant({ date: "2026-10-25", time: "02:30" }, MADRID)),
    ).toMatchObject({
      code: "menu_publication.time_repeated",
      params: {
        date: "2026-10-25",
        time: "02:30",
        occurrences: [
          { at: "2026-10-25T00:30:00.000Z", offset: "+02:00" },
          { at: "2026-10-25T01:30:00.000Z", offset: "+01:00" },
        ],
      },
    });
    expect(
      activationInstant({ date: "2026-10-25", time: "02:30", occurrence: "earlier" }, MADRID),
    ).toEqual(new Date("2026-10-25T00:30:00Z"));
    expect(
      activationInstant({ date: "2026-10-25", time: "02:30", occurrence: "later" }, MADRID),
    ).toEqual(new Date("2026-10-25T01:30:00Z"));
  });

  it("ignores occurrence on a time the clock shows once", () => {
    expect(
      activationInstant({ date: "2026-10-08", time: "08:00", occurrence: "later" }, MADRID),
    ).toEqual(new Date("2026-10-08T06:00:00Z"));
    expect(
      activationInstant({ date: "2026-10-08", time: "08:00", occurrence: "earlier" }, MADRID),
    ).toEqual(new Date("2026-10-08T06:00:00Z"));
  });

  it.each([
    [{ date: "2026-02-30", time: "08:00" }, "activatesAt.date"],
    [{ date: 20261008, time: "08:00" }, "activatesAt.date"],
    [{ date: "2026-10-08", time: "24:00" }, "activatesAt.time"],
    [{ date: "2026-10-08", time: "8:00" }, "activatesAt.time"],
    [{ date: "2026-10-08", time: "08:60" }, "activatesAt.time"],
    [{ date: "2026-10-08", time: "08:00", occurrence: "middle" }, "activatesAt.occurrence"],
    [{ date: "2026-10-08", time: "08:00", occurrence: null }, "activatesAt.occurrence"],
    ["2026-10-08T08:00", "activatesAt"],
    [null, "activatesAt"],
    [undefined, "activatesAt"],
    [["2026-10-08", "08:00"], "activatesAt"],
  ])("refuses %j as management.request_invalid on %s", (value, field) => {
    expect(refusal(() => activationInstant(value, MADRID))).toMatchObject({
      code: "management.request_invalid",
      params: { field },
    });
  });

  it("refuses a zone the venue clock cannot be read in", () => {
    expect(
      refusal(() => activationInstant({ date: "2026-10-08", time: "08:00" }, "Mars/Olympus")),
    ).toMatchObject({ code: "time_zone.unreadable", params: {} });
  });
});

describe("checkedTimeZone", () => {
  it("passes a named zone through and refuses one that cannot be read", () => {
    expect(checkedTimeZone(MADRID)).toBe(MADRID);
    expect(refusal(() => checkedTimeZone("Mars/Olympus"))).toMatchObject({
      code: "time_zone.unreadable",
      params: {},
    });
    expect(refusal(() => checkedTimeZone("+02:00"))).toMatchObject({
      code: "time_zone.unreadable",
    });
  });
});

describe("localTimeOf", () => {
  it("names the first of two occurrences of a repeated minute with its summer offset", () => {
    expect(localTimeOf(new Date("2026-10-25T00:30:00Z"), MADRID)).toEqual({
      date: "2026-10-25",
      time: "02:30",
      offset: "+02:00",
      repeated: true,
    });
  });

  it("names the second occurrence with its winter offset", () => {
    expect(localTimeOf(new Date("2026-10-25T01:30:00Z"), MADRID)).toEqual({
      date: "2026-10-25",
      time: "02:30",
      offset: "+01:00",
      repeated: true,
    });
  });

  it("names a minute the clock shows once", () => {
    expect(localTimeOf(new Date("2026-10-08T06:00:00Z"), MADRID)).toEqual({
      date: "2026-10-08",
      time: "08:00",
      offset: "+02:00",
      repeated: false,
    });
  });

  it("writes a negative and a part-hour offset with sign, hours and minutes", () => {
    expect(localTimeOf(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toMatchObject({
      date: "2026-01-15",
      time: "07:00",
      offset: "-05:00",
    });
    expect(localTimeOf(new Date("2026-01-15T23:00:00Z"), "Asia/Kolkata")).toMatchObject({
      date: "2026-01-16",
      time: "04:30",
      offset: "+05:30",
    });
  });
});
