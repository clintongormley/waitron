import { afterEach, it } from "vitest";
import { userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  servedMenus,
} from "./test-helpers.js";
import { special } from "../../test/set-menu-widgets.js";
import { TillMenuBrowser } from "./menu-browser.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

it.each(["light", "dark"] as const)(
  "names the no-place dialog and choices in %s theme",
  async (theme) => {
    setLocale("en-GB");
    const [menu] = servedMenus(
      [{ id: "lunch", name: "Lunch", versionId: "lunch", isDefault: true }],
      [],
    );
    menu!.structure.members.push({ kind: "set_menu", menuId: special.menuId, name: special.name });
    const { host, el } = await mountWidget<TillMenuBrowser>(
      "till-menu-browser",
      {
        menu,
        store: new WorkingOrderStore(),
        setMenuCopies: [{ copy: special, versionId: "lunch" }],
        addSetMenu: async () => undefined,
      },
      theme,
    );
    await userEvent.click(el.shadowRoot!.querySelector('[data-kind="set_menu"]')!);
    const folder = el.shadowRoot!.querySelector("till-set-menu-folder")!;
    await folder.updateComplete;
    const dish = [...folder.shadowRoot!.querySelectorAll("wt-button")].find((button) =>
      button.textContent!.includes("Sea bass"),
    )!;
    await userEvent.click(dish);
    await expectNoA11yViolations(host);
  },
);
