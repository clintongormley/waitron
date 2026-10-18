import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { ContentLanguagesScreen } from "./content-languages-screen.js";
import "./content-languages-screen.js";

registerIcons(DASHBOARD_ICONS);

const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(viewport.width, viewport.height);
});

describe.each(["light", "dark"] as const)("regional translation warnings (%s)", (theme) => {
  it.each([390, 1280])(
    "keeps the full note readable and actions reachable at %i px",
    async (width) => {
      await page.viewport(width, 850);
      expect(window.innerWidth).toBe(width);
      for (const locale of ["en-GB", "es-ES"]) {
        cleanupWidgets();
        setLocale(locale);
        const api = {
          getContentLanguages: vi
            .fn()
            .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "ca", "en"] }),
          getContentLanguageRules: vi
            .fn()
            .mockResolvedValue({ required: ["es", "ca"], official: ["es", "ca"] }),
          getContentTranslationGaps: vi.fn().mockResolvedValue([
            { language: "es", count: 0 },
            { language: "ca", count: 12345 },
            { language: "en", count: 0 },
          ]),
          getReceiptLanguage: vi
            .fn()
            .mockResolvedValue({ language: "es-ES", choices: ["es-ES", "ca-ES"], fixed: null }),
        } as unknown as DashboardApi;
        const { el, host } = await mountWidget<ContentLanguagesScreen>(
          "dashboard-content-languages-screen",
          { api },
          theme,
        );
        const table = () =>
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
            "[data-test=languages]",
          );
        await vi.waitFor(() =>
          expect(table()?.shadowRoot?.querySelector("[data-test=required-gaps-ca]")).toBeInstanceOf(
            HTMLElement,
          ),
        );
        await table()!.updateComplete;
        const note = table()!.shadowRoot!.querySelector<HTMLElement>(
          "[data-test=required-gaps-ca]",
        )!;
        expect(note.textContent!.trim()).toBe(
          t("content_gaps.required_warning")
            .replace("{count}", "12345")
            .replace("{language}", locale === "en-GB" ? "Catalan" : "catalán"),
        );
        const style = getComputedStyle(note);
        expect(style.whiteSpace).toBe("normal");
        expect(note.scrollWidth).toBeLessThanOrEqual(note.clientWidth + 1);
        expect(note.scrollHeight).toBeLessThanOrEqual(note.clientHeight + 1);
        const cell = note.closest("td")!;
        const range = document.createRange();
        range.selectNodeContents(note);
        const lines = [...range.getClientRects()];
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) {
          expect(line.left).toBeGreaterThanOrEqual(cell.getBoundingClientRect().left);
          expect(line.right).toBeLessThanOrEqual(cell.getBoundingClientRect().right + 1);
          expect(line.bottom).toBeLessThanOrEqual(cell.getBoundingClientRect().bottom);
        }
        const row = note.closest("tr")!;
        const required = [...row.querySelectorAll<HTMLElement>('[part="language-meta"]')].find(
          (meta) => meta.textContent!.trim() === t("content_languages.required"),
        )!;
        const requiredText = document.createRange();
        requiredText.selectNodeContents(required);
        expect([...requiredText.getClientRects()]).toHaveLength(1);
        const actions = row.querySelector("wt-row-actions")!;
        await actions.updateComplete;
        const button = actions.shadowRoot!.querySelector("button")!;
        const icon = actions.shadowRoot!.querySelector("wt-icon")!;
        await icon.updateComplete;
        expect(icon.shadowRoot!.querySelector("svg path")).not.toBeNull();
        const bounds = button.getBoundingClientRect();
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        await userEvent.click(button);
        const popup = actions.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
        const edit = actions.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=edit-translations-ca]",
        )!;
        await edit.updateComplete;
        expect(
          edit.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
        ).toBeGreaterThan(0);
        await userEvent.keyboard("{Escape}");
        await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: el,
          path: `__screenshots__/look/a682-notes-${locale}-${theme}-${width}.png`,
        });
      }
    },
  );
});
