import { afterEach, expect, test } from "vitest";
import { NUTRITION_ICONS, type WtIcon } from "@waitron/ui";
import "./till-app.js";

afterEach(() => document.body.replaceChildren());

test("the till registers every shared nutrition glyph", async () => {
  for (const [name, path] of Object.entries(NUTRITION_ICONS)) {
    const icon = document.createElement("wt-icon") as WtIcon;
    icon.name = name;
    document.body.append(icon);
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector("path")?.getAttribute("d"), name).toBe(path);
  }
});
