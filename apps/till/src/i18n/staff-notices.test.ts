import { afterEach, describe, expect, it } from "vitest";
import { staffNoticeText } from "./staff-notices.js";
import { en, es } from "./strings.js";
import { clockTime, setLocale } from "./t.js";

afterEach(() => {
  setLocale("en-GB");
});

const LANGUAGES = [
  ["en-GB", en],
  ["es-ES", es],
] as const;

describe.each(LANGUAGES)("staffNoticeText in %s", (locale, words) => {
  it.each(["storage.disk_full", "clock.unusable", "storage.space_low"])(
    "words %s with its own words and the tell-a-manager hint",
    (code) => {
      setLocale(locale);
      expect(staffNoticeText({ code, params: {} })).toEqual({
        main: words[`staff_notice.${code}` as keyof typeof words],
        hint: words["staff_notice.tell_manager"],
      });
    },
  );

  it("words the clock-behind stop with its own words and the tell-a-manager hint", () => {
    setLocale(locale);
    expect(staffNoticeText({ code: "clock.behind_chain", params: {} })).toEqual({
      main: words["staff_notice.clock.behind_chain"],
      hint: words["staff_notice.tell_manager"],
    });
  });

  it("words the unsent count with its number and the retried hint while nothing is held", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "fiscal.records_unsent", params: { count: 12, held: 0 } }),
    ).toEqual({
      main: words["staff_notice.fiscal.records_unsent"].replace("{n}", "12"),
      hint: words["staff_notice.retried"],
    });
  });

  it("gives the unsent count the tell-a-manager hint while a held record is counted", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "fiscal.records_unsent", params: { count: 12, held: 1 } }),
    ).toEqual({
      main: words["staff_notice.fiscal.records_unsent"].replace("{n}", "12"),
      hint: words["staff_notice.tell_manager"],
    });
  });

  it.each([
    ["missing", { count: 12 }],
    ["a string", { count: 12, held: "0" }],
  ])("gives the unsent count the tell-a-manager hint when the held count is %s", (_, params) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "fiscal.records_unsent", params })).toEqual({
      main: words["staff_notice.fiscal.records_unsent"].replace("{n}", "12"),
      hint: words["staff_notice.tell_manager"],
    });
  });

  it("words a count of one with the singular", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "fiscal.records_unsent", params: { count: 1, held: 0 } }),
    ).toEqual({
      main: words["staff_notice.fiscal.records_unsent_one"],
      hint: words["staff_notice.retried"],
    });
  });

  it.each([
    ["zero", { count: 0, held: 0 }],
    ["a string", { count: "12", held: 0 }],
    ["a fraction", { count: 1.5, held: 0 }],
    ["missing", { held: 0 }],
  ])("words an unsent count that is %s as unknown", (_label, params) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "fiscal.records_unsent", params })).toEqual({
      main: words["staff_notice.unknown"],
      hint: words["staff_notice.tell_manager"],
    });
  });

  it("words a printer notice with the printer's name and the time its oldest ticket was sent", () => {
    setLocale(locale);
    expect(words["staff_notice.printer.jobs_waiting"]).toBeTypeOf("string");
    expect(words["staff_notice.since"]).toBeTypeOf("string");
    const since = "2026-10-23T19:16:00.000Z";
    expect(
      staffNoticeText({ code: "printer.jobs_waiting", params: { printer: "Kitchen", since } }),
    ).toEqual({
      main: words["staff_notice.printer.jobs_waiting"].replace("{printer}", "Kitchen"),
      hint: words["staff_notice.since"].replace("{time}", clockTime(Date.parse(since))),
    });
  });

  const since = "2026-10-23T19:16:00.000Z";
  it.each([
    {},
    { printer: "", since },
    { printer: "Kitchen" },
    { printer: "Kitchen", since: "not a time" },
    { printer: 7, since },
  ])("words a printer notice with %j as unknown", (params) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "printer.jobs_waiting", params })).toEqual({
      main: words["staff_notice.unknown"],
      hint: words["staff_notice.tell_manager"],
    });
  });

  it("keeps a printer name that looks like a replacement pattern", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "printer.jobs_waiting", params: { printer: "$& {time}", since } })
        .main,
    ).toContain("$& {time}");
  });

  it("words a code the till does not know as unknown", () => {
    setLocale(locale);
    expect(staffNoticeText({ code: "printer.offline", params: {} })).toEqual({
      main: words["staff_notice.unknown"],
      hint: words["staff_notice.tell_manager"],
    });
  });
});
