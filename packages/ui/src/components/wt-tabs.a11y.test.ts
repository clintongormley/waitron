import { afterEach, describe, expect, test } from "vitest";
import axe from "axe-core";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtTabs } from "./wt-tabs.js";
import "./wt-tabs.js";

afterEach(cleanup);
describe.each(["light", "dark"] as const)("tabs accessibility (%s)", (theme) => {
  test("an action beside the tablist is named and separate from its tabs", async () => {
    const el = (await mountThemed(
      '<wt-tabs label="Venue operations"><div slot="actions"><button>Add department</button></div><p slot="status">Ready for service</p></wt-tabs>',
      theme,
    )) as WtTabs;
    el.items = [{ key: "status", label: "Status" }];
    await el.updateComplete;
    const actionSlot = el.shadowRoot!.querySelector('slot[name="actions"]')!;
    expect(actionSlot.closest('[role="tablist"]')).toBeNull();
    await expectNoA11yViolations(host);
  });

  test("a strip scrolling beside an action in a narrow row stays accessible", async () => {
    const el = (await mountThemed(
      '<wt-tabs label="Printers"><div slot="actions"><button>Añadir un agente</button></div><p slot="queue">Jobs</p><p slot="agents">Agents</p></wt-tabs>',
      theme,
    )) as WtTabs;
    el.items = [
      { key: "queue", label: "Cola de impresión" },
      { key: "printers", label: "Impresoras" },
      { key: "agents", label: "Agentes de impresión" },
    ];
    el.value = "agents";
    host.style.width = "310px";
    await el.updateComplete;
    const strip = el.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
    await expectNoA11yViolations(host);
  });

  test("a marked tab, selected and not, stays accessible", async () => {
    const el = (await mountThemed(
      '<wt-tabs label="Lunch Menu"><p slot="structure">Structure</p><p slot="preview">Preview</p></wt-tabs>',
      theme,
    )) as WtTabs;
    el.items = [
      { key: "structure", label: "Structure" },
      { key: "preview", label: "Preview", marked: "unpublished changes" },
    ];
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.value = "preview";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

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
