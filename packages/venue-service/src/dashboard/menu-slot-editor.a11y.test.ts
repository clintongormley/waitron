import { afterEach, describe, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { MenuSlotEditor } from "./menu-slot-editor.js";
import "./menu-slot-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const periods = [
  { id: "mananas", name: "Mañanas", menuId: "m1", menuName: "Desayunos" },
  { id: "mediodia", name: "Mediodía", menuId: "m2", menuName: "Almuerzo" },
];

const states: Record<string, Partial<MenuSlotEditor>> = {
  "a special date following the normal week": {
    modes: ["inherit", "all_day", "periods"],
    draft: { mode: "inherit", slots: [] },
  },
  "a day with no periods": { draft: { mode: "all_day", slots: [] } },
  "two slots, one with no period and a refused time": {
    draft: {
      mode: "periods",
      slots: [
        { id: "a", periodId: "mananas", startsAt: "08:00", endsAt: "12:00" },
        { id: "b", periodId: "", startsAt: "11:00", endsAt: "" },
      ],
    },
    errors: {
      "monday.mode": "These times overlap Sunday's past midnight.",
      "monday.periods.1.periodId": "Choose a period.",
      "monday.periods.1.closesAt": "Enter a time.",
    },
  },
  "disabled while a save is out": {
    draft: {
      mode: "periods",
      slots: [{ id: "a", periodId: "mediodia", startsAt: "13:00", endsAt: "16:00" }],
    },
    disabled: true,
  },
};

describe.each(["light", "dark"] as const)("menu slot editor accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("menu-slot-editor");
    Object.assign(el, { label: "Monday", fieldPrefix: "monday", periods, ...states[state] });
    host.append(el);
    await el.updateComplete;
    await el.shadowRoot!.querySelector("hours-cell-editor")!.updateComplete;
    await expectNoA11yViolations(host);
  });
});
