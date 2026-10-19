import { afterEach, describe, expect, it, vi } from "vitest";
import { receiptDateTime, receiptDateTimeNumeric, receiptDay } from "./receipt-dates.js";

const AT = (time: string) => `2026-01-15T${time}:00.000Z`;

describe("receiptDateTime", () => {
  it.each([
    ["es-ES", "00:34", "15 ene 2026, 00:34"],
    ["es-ES", "09:05", "15 ene 2026, 09:05"],
    ["es-ES", "12:34", "15 ene 2026, 12:34"],
    ["ca-ES", "00:34", "15 de gen. 2026, 00:34"],
    ["ca-ES", "09:05", "15 de gen. 2026, 09:05"],
    ["ca-ES", "12:34", "15 de gen. 2026, 12:34"],
    ["gl-ES", "00:34", "15 de xan. de 2026, 00:34"],
    ["gl-ES", "09:05", "15 de xan. de 2026, 09:05"],
    ["gl-ES", "12:34", "15 de xan. de 2026, 12:34"],
    ["eu-ES", "00:34", "2026(e)ko urt. 15(a) (00:34)"],
    ["eu-ES", "09:05", "2026(e)ko urt. 15(a) (09:05)"],
    ["eu-ES", "12:34", "2026(e)ko urt. 15(a) (12:34)"],
  ])("prints %s at %s in words with a two-digit hour", (locale, time, want) => {
    expect(receiptDateTime(AT(time), locale, 0)).toBe(want);
  });

  it.each([
    [60, "1 mar 2026, 00:05"],
    [0, "28 feb 2026, 23:05"],
    [-480, "28 feb 2026, 15:05"],
  ])("reads the saved offset %s, not the host's zone", (offset, want) => {
    expect(receiptDateTime("2026-02-28T23:05:00.000Z", "es-ES", offset)).toBe(want);
  });

  it("uses the host's zone when no offset is given", () => {
    const local = new Date(2026, 0, 15, 9, 5).toISOString();
    expect(receiptDateTime(local, "es-ES")).toBe("15 ene 2026, 09:05");
  });

  it("pads the hour of a 12-hour language too", () => {
    expect(receiptDateTime(AT("09:05"), "en-US", 0)).toMatch(/^Jan 15, 2026, 09:05\sAM$/u);
  });
});

describe("receiptDateTimeNumeric", () => {
  it.each([
    ["es-ES", "00:34", "15/01/2026 00:34"],
    ["es-ES", "09:05", "15/01/2026 09:05"],
    ["es-ES", "12:34", "15/01/2026 12:34"],
    ["ca-ES", "00:34", "15/01/2026 00:34"],
    ["ca-ES", "09:05", "15/01/2026 09:05"],
    ["ca-ES", "12:34", "15/01/2026 12:34"],
    ["gl-ES", "00:34", "15/01/2026 00:34"],
    ["gl-ES", "09:05", "15/01/2026 09:05"],
    ["gl-ES", "12:34", "15/01/2026 12:34"],
    ["eu-ES", "00:34", "2026/01/15 00:34"],
    ["eu-ES", "09:05", "2026/01/15 09:05"],
    ["eu-ES", "12:34", "2026/01/15 12:34"],
  ])("prints %s at %s in numbers", (locale, time, want) => {
    expect(receiptDateTimeNumeric(AT(time), locale, 0)).toBe(want);
  });

  it.each([
    [60, "01/03/2026 00:05"],
    [-480, "28/02/2026 15:05"],
  ])("reads the saved offset %s", (offset, want) => {
    expect(receiptDateTimeNumeric("2026-02-28T23:05:00.000Z", "es-ES", offset)).toBe(want);
  });

  it("uses the host's zone when no offset is given", () => {
    const local = new Date(2026, 0, 15, 9, 5).toISOString();
    expect(receiptDateTimeNumeric(local, "es-ES")).toBe("15/01/2026 09:05");
  });
});

describe("without an offset", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("follows a change of the host's zone made after an earlier print", () => {
    const iso = "2026-01-15T12:00:00.000Z";
    vi.stubEnv("TZ", "UTC");
    expect(receiptDateTime(iso, "es-ES")).toBe("15 ene 2026, 12:00");
    expect(receiptDateTimeNumeric(iso, "es-ES")).toBe("15/01/2026 12:00");
    vi.stubEnv("TZ", "Asia/Tokyo");
    expect(receiptDateTime(iso, "es-ES")).toBe("15 ene 2026, 21:00");
    expect(receiptDateTimeNumeric(iso, "es-ES")).toBe("15/01/2026 21:00");
  });
});

describe("receiptDay", () => {
  it.each([
    ["es-ES", "28 feb 2026"],
    ["ca-ES", "28 de febr. 2026"],
    ["gl-ES", "28 de feb. de 2026"],
    ["eu-ES", "2026(e)ko ots. 28(a)"],
  ])("prints the operation day in %s", (locale, want) => {
    expect(receiptDay("2026-02-28", locale)).toBe(want);
  });
});
