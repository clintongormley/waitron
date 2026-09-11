import { afterEach, describe, expect, test } from "vitest";
import axe from "axe-core";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtTabs } from "./wt-tabs.js";
import "./wt-tabs.js";

afterEach(cleanup);
describe.each(["light", "dark"] as const)("tabs accessibility (%s)", (theme) => {
  test("both selected states have named, associated tabs and panels", async () => {
    const el = (await mountThemed(
      '<wt-tabs label="Venue operations"><p slot="status">Ready for service</p><p slot="menus">Manage menus</p></wt-tabs>',
      theme,
    )) as WtTabs;
    el.items = [
      { key: "status", label: "Status" },
      { key: "menus", label: "Menus" },
    ];
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.value = "menus";
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector('[role="tab"]')!.textContent = "";
    expect((await axe.run(host)).violations.map((v) => v.id)).toContain("button-name");
  });
});
