import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { SetupApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { SetupRecoveryCopy } from "./recovery-copy.js";
import { setLocale } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(["light", "dark"] as const)(
  "the sheet comparison preview stays readable in %s",
  async (theme) => {
    const previous = [window.innerWidth, window.innerHeight] as const;
    const saved = {
      sourceId: "selected-copy",
      createdAt: "2026-10-18T17:29:32.728Z",
      environment: "production",
      nodeId: "3262bf78-1d78-4b10-bae6-61fda564d5e8",
      nodeRecoveryKeyName: "2026-10-18 · K7QF",
      taxpayer: { legalName: "Olivo Restauración SL", taxId: "B12345674" },
      locationName: "Olivo Centro",
    };
    try {
      const { el, host } = await mountWidget<SetupRecoveryCopy>(
        "setup-recovery-copy",
        {
          api: new SetupApi("", async () => new Response(JSON.stringify(saved))),
          artifact: new File(["synthetic encrypted backup"], "olivo.backup"),
          recoveryKey: "synthetic-archive-password",
        },
        theme,
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
      await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("3262 BF78"));
      for (const locale of ["en-GB", "es-ES"] as const) {
        setLocale(locale);
        await el.updateComplete;
        for (const width of [390, 1280]) {
          await page.viewport(width, 1100);
          expect(window.innerWidth).toBe(width);
          const values = Array.from(el.shadowRoot!.querySelectorAll("dd"));
          expect(values.map((value) => value.textContent)).toContain("3262 BF78");
          expect(values.map((value) => value.textContent)).toContain("2026-10-18 · K7QF");
          expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          expect(el.shadowRoot!.textContent).not.toContain(saved.nodeId);
          await expectNoA11yViolations(host);
          if (import.meta.env.VITE_A679_PDF_LOOK === "1")
            await page.screenshot({
              path: `__screenshots__/a679-pdf-preview/${locale}-${theme}-${width}.png`,
            });
        }
      }
    } finally {
      await page.viewport(previous[0], previous[1]);
    }
  },
);
