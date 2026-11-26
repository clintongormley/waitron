import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import type { WtMenuRow } from "./wt-menu-row.js";
import type { WtRowActions } from "./wt-row-actions.js";
import "./wt-button.js";
import "./wt-menu-row.js";
import "./wt-row-actions.js";

afterEach(cleanup);
afterEach(() => setHelpMode(false));

const MENU =
  '<wt-row-actions label="Actions" align="end">' +
  '<wt-menu-row help="Edits it." help-label="Help: Edit"><wt-button variant="secondary">Edit</wt-button></wt-menu-row>' +
  '<wt-button variant="secondary">Delete</wt-button>' +
  "</wt-row-actions>";

async function mountOpenMenu(theme: "light" | "dark", on: boolean): Promise<WtHelpTooltip> {
  const menu = (await mountThemed(MENU, theme)) as WtRowActions;
  const row = menu.querySelector<WtMenuRow>("wt-menu-row")!;
  await row.updateComplete;
  const badge = row.shadowRoot!.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
  setHelpMode(on);
  await badge.updateComplete;
  menu.show();
  const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  return badge;
}

describe.each(["light", "dark"] as const)("wt-menu-row a11y (%s theme)", (theme) => {
  test.each([
    ['action label="Print"', "Print"],
    ['action label="Allergies" value="Nuts"', "Allergies Nuts"],
    ['action label="Guests" value="3" chevron', "Guests 3"],
    ['action label="Move" disabled', "Move"],
    ['action label="Edit" help="Change the name." help-label="Help: Edit"', "Edit"],
  ])("an accessible action with %s", async (attributes, name) => {
    setHelpMode(true);
    await mountThemed(`<wt-menu-row ${attributes}></wt-menu-row>`, theme);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
    const action = page.getByRole("button", { name, exact: true });
    await expect.element(action).toBeVisible();
    expect((action.element() as HTMLButtonElement).disabled).toBe(name === "Move");
  });

  test("a plain row with its own control", async () => {
    await mountThemed(
      '<wt-menu-row label="Notifications"><input type="checkbox" aria-label="Notifications"></wt-menu-row>',
      theme,
    );
    await expect.element(page.getByRole("checkbox", { name: "Notifications" })).toBeVisible();
    await expectNoA11yViolations(host);
  });

  test("help off", async () => {
    await mountOpenMenu(theme, false);
    await expectNoA11yViolations(host);
  });

  test("help on", async () => {
    await mountOpenMenu(theme, true);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });

  test("help on, box open", async () => {
    const badge = await mountOpenMenu(theme, true);
    badge.shadowRoot!.querySelector("button")!.click();
    await badge.updateComplete;
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
