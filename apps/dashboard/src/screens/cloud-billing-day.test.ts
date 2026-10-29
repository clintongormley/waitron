import { expect, it } from "vitest";
import { lastIncludedDay } from "./cloud-billing-day.js";

it("is the day before `until`, in the screen's language", () => {
  expect(lastIncludedDay("2026-11-30", "en-GB")).toBe("29 November 2026");
  expect(lastIncludedDay("2026-03-01", "es")).toBe("28 de febrero de 2026");
});

it("names the same day whatever zone the browser is in (control: formatting in New York moves it)", () => {
  expect(lastIncludedDay("2026-11-30", "en-GB", "UTC")).toBe("29 November 2026");
  expect(lastIncludedDay("2026-11-30", "en-GB", "America/New_York")).toBe("28 November 2026");
  expect(lastIncludedDay("2026-11-30", "en-GB", "Pacific/Kiritimati")).toBe("29 November 2026");
});
