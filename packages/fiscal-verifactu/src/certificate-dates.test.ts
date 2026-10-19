import {
  calendarDaysLeft,
  CERTIFICATE_THRESHOLDS,
  certificateStage,
  localDate,
  localMidnight,
  stageSince,
} from "./certificate-dates.js";

const tz = "Europe/Madrid";
// 00:59 in Madrid on 25 October 2026, the night summer time ends.
const end = new Date("2026-10-24T22:59:00Z");

describe("CERTIFICATE_THRESHOLDS", () => {
  it("holds the owner's thresholds for each certificate kind", () => {
    expect(CERTIFICATE_THRESHOLDS).toEqual({
      sello: { warning: 90, urgent: 30 },
      representante: { warning: 60, urgent: 14 },
    });
  });
});

describe("localDate", () => {
  it("reads the calendar day in the venue's time zone, not in UTC", () => {
    expect(localDate(new Date("2026-10-24T22:10:00Z"), tz)).toBe("2026-10-25");
    expect(localDate(new Date("2026-10-24T21:59:59Z"), tz)).toBe("2026-10-24");
  });
});

describe("localMidnight", () => {
  it("gives the instant a day starts in the venue's time zone, summer and winter", () => {
    expect(localMidnight("2026-08-26", tz)).toBe("2026-08-25T22:00:00.000Z");
    expect(localMidnight("2026-10-26", tz)).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("calendarDaysLeft", () => {
  it("counts calendar days in the venue's zone across the night summer time ends (E9)", () => {
    const validUntil = new Date("2026-10-24T23:30:00Z");
    expect(calendarDaysLeft(new Date("2026-10-24T08:00:00Z"), validUntil, tz)).toBe(1);
    expect(calendarDaysLeft(new Date("2026-10-24T22:10:00Z"), validUntil, tz)).toBe(0);
  });

  it("goes negative once the end day has passed", () => {
    expect(calendarDaysLeft(new Date("2026-10-27T10:00:00Z"), end, tz)).toBe(-2);
  });
});

describe("certificateStage", () => {
  it("moves a representative certificate through its stages at 60 and 14 days (E8)", () => {
    const at = (iso: string) => certificateStage("representante", new Date(iso), end, tz);
    expect(at("2026-08-25T10:00:00Z")).toBeNull();
    expect(at("2026-08-26T10:00:00Z")).toBe("warning");
    expect(at("2026-10-10T10:00:00Z")).toBe("warning");
    expect(at("2026-10-11T10:00:00Z")).toBe("urgent");
    expect(at("2026-10-24T22:58:59Z")).toBe("urgent");
    expect(at("2026-10-24T22:59:00Z")).toBe("expired");
    expect(at("2026-11-30T10:00:00Z")).toBe("expired");
  });

  it("moves a company seal through its stages at 90 and 30 days", () => {
    const at = (iso: string) => certificateStage("sello", new Date(iso), end, tz);
    expect(at("2026-07-26T10:00:00Z")).toBeNull();
    expect(at("2026-07-27T10:00:00Z")).toBe("warning");
    expect(at("2026-09-24T10:00:00Z")).toBe("warning");
    expect(at("2026-09-25T10:00:00Z")).toBe("urgent");
  });
});

describe("stageSince", () => {
  it("gives the venue-midnight a stage begins, and the end instant for expired", () => {
    expect(stageSince("representante", "warning", end, tz)).toBe("2026-08-25T22:00:00.000Z");
    expect(stageSince("representante", "urgent", end, tz)).toBe("2026-10-10T22:00:00.000Z");
    expect(stageSince("sello", "warning", end, tz)).toBe("2026-07-26T22:00:00.000Z");
    expect(stageSince("sello", "urgent", end, tz)).toBe("2026-09-24T22:00:00.000Z");
    expect(stageSince("representante", "expired", end, tz)).toBe("2026-10-24T22:59:00.000Z");
    expect(stageSince("sello", "expired", end, tz)).toBe("2026-10-24T22:59:00.000Z");
  });
});
