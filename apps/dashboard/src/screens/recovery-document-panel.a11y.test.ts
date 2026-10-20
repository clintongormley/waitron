import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtDialog } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { RecoveryDocumentPanel } from "./recovery-document-panel.js";

const oldLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(oldLocale);
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of ["idle", "confirm", "refusal", "ready"] as const)
        it(`${locale} ${theme} ${width} ${state}: manager PDF actions fit and remain accessible`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1000);
            setLocale(locale);
            const fetcher = vi.fn(async () =>
              state === "refusal"
                ? new Response(JSON.stringify({ error: { code: "authorization.not_permitted" } }), {
                    status: 403,
                  })
                : new Response("%PDF-synthetic-visual-only", {
                    headers: { "Content-Type": "application/pdf" },
                  }),
            );
            const { el, host } = await mountWidget<RecoveryDocumentPanel>(
              "dashboard-recovery-document",
              {
                api: new DashboardApi("", fetcher),
                canManage: true,
              },
              theme,
            );
            host.style.padding = "var(--wt-space-4)";
            const q = <T extends Element>(name: string) =>
              el.shadowRoot!.querySelector<T>(`[data-test=${name}]`)!;
            const click = async (name: string) => {
              const button = q<WtButton>(name);
              await button.updateComplete;
              await userEvent.click(button.shadowRoot!.querySelector("button")!);
              await el.updateComplete;
            };
            if (state !== "idle") await click("new-document");
            if (state === "refusal" || state === "ready") {
              await click("confirm-document");
              if (state === "refusal")
                await expect
                  .poll(() => q<HTMLElementTagNameMap["wt-form-actions"]>("document-error").error)
                  .toBeTruthy();
              else await expect.poll(() => q("download-document")).not.toBeNull();
            }
            await expectNoA11yViolations(host);
            const dialog = q<WtDialog>("confirm-dialog");
            await dialog.updateComplete;
            const frame = dialog.open ? dialog.shadowRoot!.querySelector("dialog")! : host;
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            expect(frame.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            const button = q<WtButton>(dialog.open ? "confirm-document" : "new-document");
            await button.updateComplete;
            const native = button.shadowRoot!.querySelector("button")!;
            native.focus();
            expect(button.shadowRoot!.activeElement).toBe(native);
            expect(native.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
            expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
            if (dialog.open) {
              const cancel = q<WtButton>("cancel-document");
              await cancel.updateComplete;
              expect(
                cancel.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
              ).toBeGreaterThan(0);
              expect(el.shadowRoot!.textContent).toContain(
                locale === "es-ES" ? "Las copias antiguas" : "Older backups",
              );
            }
            if (state === "ready") {
              const link = q<HTMLAnchorElement>("print-document");
              expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
              expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            }
            if (import.meta.env.VITE_A679_MANAGER_LOOK === "1")
              await page.screenshot({
                element: frame,
                path: `__screenshots__/a679-manager/${locale}-${theme}-${width}-${state}.png`,
              });
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
