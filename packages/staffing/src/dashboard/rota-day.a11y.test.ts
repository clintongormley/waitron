import { afterEach, describe, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { rotaArea, rotaWeek } from "../testing/rota-fixture.js";
import { areaKey } from "../slots.js";
import { RotaDay } from "./rota-day.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
const kitchen = { kind: "area" as const, area: rotaArea, key: areaKey(rotaArea), name: "Kitchen" };
describe.each(["light", "dark"] as const)("rota-day accessibility (%s)", (theme) => {
  test.each(["area", "everyone", "closed day", "published"])("%s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = new RotaDay();
    el.week = rotaWeek();
    el.show = state === "everyone" ? { kind: "everyone" } : kitchen;
    el.businessDay = state === "closed day" ? "2026-11-30" : "2026-12-01";
    el.editable = state !== "published";
    if (state === "area") {
      el.week.days[1]!.areas[0]!.match.slots.push({
        ...el.week.days[4]!.areas[0]!.match.slots[0]!,
      });
      el.breaches = [{ kind: "night_work", personId: "ana", shiftId: "filled", nightMinutes: 120 }];
    }
    host.append(el);
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
