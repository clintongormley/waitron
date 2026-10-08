import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import type { DashboardApi, TranslationPage, TranslationTarget } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ContentTranslationsDialog } from "./content-translations-dialog.js";

registerIcons(DASHBOARD_ICONS);
const row: TranslationTarget = {
  kind: "product",
  id: "one",
  name: "STAFF Croquetas de jamón y queso curado con una descripción larga",
  reason: "absent",
  selectedText: null,
  defaultText: null,
  effectiveSelectedText: null,
  effectiveDefaultText: null,
  defaultRequired: true,
  eligible: true,
  unavailableReason: null,
  owners: { kind: "product", parentId: null },
  expected: "baseline",
};
const result = (rows: TranslationTarget[]): TranslationPage => ({
  language: "es",
  config: { defaultLanguage: "en", languages: ["en", "es"] },
  required: [],
  rows,
  total: rows.length,
  next: null,
});
const original = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(original.width, original.height);
});

describe.each(["light", "dark"] as const)("translation dialog accessibility (%s)", (theme) => {
  it.each([390, 1280])(
    "renders all staged states in both languages at measured %i px",
    async (width) => {
      await page.viewport(width, 700);
      expect(window.innerWidth).toBe(width);
      for (const locale of ["en-GB", "es-ES"]) {
        setLocale(locale);
        for (const state of [
          "loading",
          "empty",
          "ready",
          "invalid",
          "refused",
          "conflict",
          "unavailable",
          "review",
        ] as const) {
          cleanupWidgets();
          const api = {
            getContentTranslationTargets: vi.fn(
              state === "loading"
                ? () => new Promise<TranslationPage>(() => {})
                : async () =>
                    result(
                      state === "empty"
                        ? []
                        : [
                            {
                              ...row,
                              ...(state === "unavailable"
                                ? { eligible: false, unavailableReason: "inactive" as const }
                                : {}),
                            },
                          ],
                    ),
            ),
            saveContentTranslations: vi.fn().mockRejectedValue(
              state === "conflict"
                ? { code: "content.translation_stale" }
                : {
                    code: "content.translation_refused",
                    params: {
                      kind: "product",
                      id: "one",
                      field: "text",
                      language: "es",
                      causeCode: "product.invalid",
                    },
                  },
            ),
          } as unknown as DashboardApi;
          const { el, host } = await mountWidget<ContentTranslationsDialog>(
            "dashboard-content-translations-dialog",
            { api, language: "es", open: true },
            theme,
          );
          if (state !== "loading")
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull(),
            );
          await el.updateComplete;
          const table = el.shadowRoot!.querySelector("wt-data-table");
          await table?.updateComplete;
          if (["invalid", "refused", "conflict", "review"].includes(state)) {
            const input = table!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
              '[name="translation-text-product-one"]',
            )!;
            input.dispatchEvent(
              new CustomEvent("wt-change", {
                detail: { value: "Croquetas de jamón" },
                bubbles: true,
                composed: true,
              }),
            );
            await el.updateComplete;
            await table!.updateComplete;
            if (state !== "invalid") {
              table!
                .shadowRoot!.querySelector("[name=translation-defaultText-product-one]")!
                .dispatchEvent(
                  new CustomEvent("wt-change", {
                    detail: { value: "Ham croquettes" },
                    bubbles: true,
                    composed: true,
                  }),
                );
              await el.updateComplete;
              await table!.updateComplete;
            }
            if (state === "review") {
              vi.mocked(api.getContentTranslationTargets).mockImplementation(
                async (_language, query) =>
                  result(
                    query.targets
                      ? [
                          {
                            ...row,
                            selectedText: "Current long name",
                            defaultText: "Current default",
                            effectiveSelectedText: "Current long name",
                            effectiveDefaultText: "Current default",
                            defaultRequired: false,
                            expected: "current",
                          },
                        ]
                      : [],
                  ),
              );
              el.shadowRoot!.querySelector<HTMLElement>("[data-test=review]")!.click();
              await vi.waitFor(() =>
                expect(
                  table!.shadowRoot!.querySelector("[data-test=review-product-one]"),
                ).not.toBeNull(),
              );
            } else {
              el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
              await vi.waitFor(() =>
                expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
              );
              await vi.waitFor(() =>
                expect(
                  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
                    "[data-test=close]",
                  )!.disabled,
                ).toBe(false),
              );
            }
          }
          const modal = el.shadowRoot!.querySelector("wt-modal")!;
          await modal.updateComplete;
          const native = modal.shadowRoot!.querySelector("dialog")!;
          expect(native.open).toBe(true);
          expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
          expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
          const bodyBounds = body.getBoundingClientRect();
          for (const field of table?.shadowRoot?.querySelectorAll("wt-input") ?? []) {
            expect(field.getBoundingClientRect().left).toBeGreaterThanOrEqual(bodyBounds.left);
            expect(field.getBoundingClientRect().right).toBeLessThanOrEqual(bodyBounds.right);
          }
          if (state === "review") {
            const review = table!.shadowRoot!.querySelector<HTMLElement>(
              "[data-test=review-product-one]",
            )!;
            review.scrollIntoView({ block: "center" });
            for (const button of review.querySelectorAll("wt-button")) {
              expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(bodyBounds.left);
              expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(bodyBounds.right);
            }
          }
          await expectNoA11yViolations(host);
          await page.screenshot({
            element: native,
            path: `__screenshots__/look/a420-task6-${locale}-${theme}-${width}-${state}.png`,
          });
        }
      }
    },
  );
});
