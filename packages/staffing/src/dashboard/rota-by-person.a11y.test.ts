import { afterEach, describe, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { rotaWeek } from "../testing/rota-fixture.js";
import { RotaByPerson } from "./rota-by-person.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Rota by person accessibility (%s)", (theme) => {
  test.each(["draft", "published", "warnings", "partly uncovered", "empty"])(
    "%s",
    async (state) => {
      setLocale("en");
      await mountThemed("<div></div>", theme);
      const el = new RotaByPerson();
      el.week = rotaWeek();
      el.editable = state !== "published";
      if (state === "warnings")
        el.breaches = [
          { kind: "night_work", personId: "ana", shiftId: "filled", nightMinutes: 120 },
        ];
      if (state === "partly uncovered")
        el.week.shifts = el.week.shifts.filter((s) => s.shiftId === "part");
      if (state === "empty") {
        el.week.people = [];
        el.week.shifts = [];
      }
      host.append(el);
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );
});
