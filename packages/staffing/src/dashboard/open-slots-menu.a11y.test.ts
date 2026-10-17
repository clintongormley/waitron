import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { rotaWeek } from "../testing/rota-fixture.js";
import { OpenSlotsMenu } from "./open-slots-menu.js";
import type { RotaPopup } from "./rota-popup.js";
import "./rota-popup.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Open slots menu accessibility (%s)", (theme) => {
  test.each(["own and other", "none", "busy", "refusal"])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed(
      `<div><button>+ Add shift</button><rota-popup heading="Fri 4 Dec · Marc"></rota-popup></div>`,
      theme,
    )) as HTMLElement;
    const popup = el.querySelector<RotaPopup>("rota-popup")!;
    const menu = new OpenSlotsMenu();
    menu.week = rotaWeek();
    const friday = menu.week.days[4]!.areas[0]!.match.slots;
    friday.push({
      slot: { ...friday[0]!.slot, key: "head-open", staffRoleId: "head" },
      status: { kind: "unfilled" },
    });
    menu.personId = "laia";
    menu.businessDay = state === "none" ? "2026-12-02" : "2026-12-04";
    menu.busy = state === "busy";
    menu.error = state === "refusal" ? "Could not fill the slot. Try again." : "";
    popup.append(menu);
    await popup.updateComplete;
    await menu.updateComplete;
    popup.show(el.querySelector("button")!);
    expect(popup.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    if (state === "own and other") expect(menu.shadowRoot!.querySelectorAll("h3")).toHaveLength(2);
    await expectNoA11yViolations(el);
  });
});
