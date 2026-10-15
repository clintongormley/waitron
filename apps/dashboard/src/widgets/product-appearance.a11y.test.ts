import { afterEach, describe, expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ProductEditor } from "./product-editor.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("appearance %s", (theme) => {
  it.each([false, true])("combined image/colour controls, open=%s", async (open) => {
    const { el, host } = await mountWidget<ProductEditor>(
      "dashboard-product-editor",
      {
        open: true,
        locales: ["en"],
        api: { imageLibraryRequest: vi.fn() } as never,
      },
      theme,
    );
    const appearance = el.shadowRoot!.querySelector("dashboard-product-appearance")!;
    await appearance.updateComplete;
    if (open) appearance.openPanel();
    expect(el.shadowRoot!.querySelector("fieldset.color")!.checkVisibility()).toBe(open);
    expect(
      appearance.shadowRoot!.querySelector(".pencil wt-icon")!.shadowRoot!.querySelector("path"),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
