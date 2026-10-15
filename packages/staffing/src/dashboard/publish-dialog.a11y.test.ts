import { afterEach, describe, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { rotaWeek } from "../testing/rota-fixture.js";
import { PublishDialog } from "./publish-dialog.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Rota publish accessibility (%s)", (theme) => {
  test.each(["clean", "warnings", "refused", "busy"])("%s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = new PublishDialog();
    el.week = rotaWeek();
    el.open = true;
    if (state === "warnings")
      el.breaches = [{ kind: "night_work", personId: "ana", shiftId: "filled", nightMinutes: 120 }];
    if (state === "refused") el.error = "Could not publish the week";
    el.busy = state === "busy";
    host.append(el);
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
