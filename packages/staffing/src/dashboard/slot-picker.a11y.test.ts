import { afterEach, describe, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { rotaWeek } from "../testing/rota-fixture.js";
import { SlotPicker } from "./slot-picker.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Slot picker accessibility (%s)", (theme) => {
  test.each(["holders", "everyone", "no holders", "busy", "refusal"])("%s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = new SlotPicker();
    el.week = rotaWeek();
    el.pickedSlot = el.week.days[4]!.areas[0]!.match.slots[0]!.slot;
    if (state === "no holders")
      el.week = { ...el.week, people: el.week.people.map((p) => ({ ...p, staffRoleIds: [] })) };
    el.busy = state === "busy";
    el.error = state === "refusal" ? "Could not fill the slot. Try again." : "";
    host.append(el);
    await el.updateComplete;
    if (state === "everyone") {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=show-everyone]")!.click();
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});
