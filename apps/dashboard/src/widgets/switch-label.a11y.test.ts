import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtModal } from "@waitron/ui";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { SwitchLabel } from "./switch-label.js";
import "./switch-label.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 768);
});

for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    it.each(["drawing", "ready"] as const)(
      `switch label ${locale}/${theme} %s is accessible at phone width`,
      async (state) => {
        setLocale(locale);
        await page.viewport(390, 844);
        const { el, host } = await mountWidget<SwitchLabel>(
          "dashboard-switch-label",
          {
            address: "https://box-abcd.waitron.local",
            ...(state === "drawing" ? { drawQr: () => new Promise<string>(() => {}) } : {}),
          },
          theme,
        );
        const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
        await modal.updateComplete;
        expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        if (state === "ready")
          await vi.waitFor(() => expect(el.shadowRoot!.querySelector("img")).not.toBeNull());
        await expectNoA11yViolations(host);
      },
    );
