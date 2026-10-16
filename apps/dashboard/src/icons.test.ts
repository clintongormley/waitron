import { afterEach, expect, test } from "vitest";
import { NUTRITION_ICONS, registerIcons, type WtIcon } from "@waitron/ui";
import { DASHBOARD_ICONS } from "./icons.js";

afterEach(() => document.body.replaceChildren());

test("the dashboard registers every shared nutrition glyph", async () => {
  registerIcons(DASHBOARD_ICONS);
  for (const [name, path] of Object.entries(NUTRITION_ICONS)) {
    const icon = document.createElement("wt-icon") as WtIcon;
    icon.name = name;
    document.body.append(icon);
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector("path")?.getAttribute("d"), name).toBe(path);
  }
});
