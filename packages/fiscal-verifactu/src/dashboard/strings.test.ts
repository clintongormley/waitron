import { afterEach, beforeEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import { t } from "./strings.js";

let locale = "";

beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  setLocale(locale);
});

it("fills each placeholder, and leaves one with no value as written", () => {
  expect(t("aeat_certificate.days_left", { days: 12 })).toBe("12 days left");
  expect(t("aeat_certificate.days_left")).toBe("{days} days left");
});
