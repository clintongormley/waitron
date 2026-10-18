import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import type { ContentSuggestionView, DashboardApi } from "../api/client.js";
import type {
  TranslationCell,
  TranslationCellRef,
  TranslationItem,
  TranslationItemPage,
} from "@waitron/catalogue/src/content-translation-types.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ContentTranslationsDialog } from "./content-translations-dialog.js";

registerIcons(DASHBOARD_ICONS);
const config = { defaultLanguage: "en", languages: ["en", "es"] };
const cell = (id = "one", language = "es"): TranslationCell => ({
  kind: "product",
  id,
  language,
  field: "name",
  owners: { kind: "product", parentId: null },
  text: null,
  inheritedText: null,
  effectiveText: null,
  defaultText: null,
  inheritedDefaultText: null,
  effectiveDefaultText: null,
  staffText: "STAFF Croquetas de jamón y queso curado con una descripción larga",
  expected: `baseline-${id}-${language}`,
  eligible: true,
  unavailableReason: null,
});
const row = (id = "one"): TranslationItem => ({
  kind: "product",
  id,
  name: cell(id).staffText!,
  owners: cell(id).owners,
  cells: config.languages.map((language) => cell(id, language)),
});
const result = (rows = [row()]): TranslationItemPage => ({
  config,
  required: [],
  configuration: "config-one",
  rows,
  total: rows.length,
  next: null,
});
const suggestions = (views: ContentSuggestionView[] = []) => ({
  config,
  required: [],
  configuration: "config-one",
  waitingFixes: 0,
  run: null,
  suggestions: views,
  next: null,
  service: "on" as const,
  cloudOrigin: null,
});
const original = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(original.width, original.height);
});
const windowFor = (el: ContentTranslationsDialog) =>
  el.shadowRoot!.querySelector("dashboard-content-translation-window")!;
const field = (el: ContentTranslationsDialog, language = "es") =>
  windowFor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="translation-product-one-${language}-name"]`,
  )!;
const button = (el: ContentTranslationsDialog, action: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${action}]`)!;

const states = [
  "loading",
  "empty",
  "ready",
  "invalid",
  "refused",
  "conflict",
  "unavailable",
  "review",
  "uncertain",
  "batch-review",
] as const;
describe.each(["light", "dark"] as const)("translation dialog accessibility (%s)", (theme) => {
  it.each(
    [390, 1280].flatMap((width) =>
      ["en-GB", "es-ES"].flatMap((locale) => states.map((state) => ({ width, locale, state }))),
    ),
  )("renders $state in $locale at measured $width px", async ({ width, locale, state }) => {
    await page.viewport(width, 700);
    expect(window.innerWidth).toBe(width);
    setLocale(locale);
    cleanupWidgets();
    const api = {
      getContentTranslationTargets: vi.fn(
        state === "loading"
          ? () => new Promise<TranslationItemPage>(() => {})
          : async () =>
              result(
                state === "empty"
                  ? []
                  : [
                      {
                        ...row(),
                        cells: row().cells.map((value) => ({
                          ...value,
                          ...(state === "unavailable"
                            ? { eligible: false, unavailableReason: "inactive" as const }
                            : {}),
                        })),
                      },
                    ],
              ),
      ),
      getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
        ...result(),
        cells: refs.map((ref) => ({ ...cell(ref.id, ref.language), ...ref })),
      })),
      saveContentTranslations: vi.fn().mockRejectedValue(
        state === "conflict"
          ? { code: "content.translation_stale" }
          : state === "uncertain" || state === "batch-review"
            ? { code: "connection.failed" }
            : {
                code: "content.translation_refused",
                params: {
                  kind: "product",
                  id: "one",
                  field: "name",
                  language: "es",
                  causeCode: "product.invalid",
                },
              },
      ),
      getContentSuggestions: vi.fn(async () => suggestions()),
    };
    const { el, host } = await mountWidget<ContentTranslationsDialog>(
      "dashboard-content-translations-dialog",
      { api: api as unknown as DashboardApi, config, language: "es", open: true },
      theme,
    );
    if (state !== "loading")
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull(),
      );
    await el.updateComplete;
    const view = windowFor(el);
    await view?.updateComplete;
    if (["invalid", "refused", "conflict", "review", "uncertain", "batch-review"].includes(state)) {
      const input = field(el);
      await input.updateComplete;
      await userEvent.fill(
        input.shadowRoot!.querySelector("input")!,
        state === "invalid" ? "é".repeat(2049) : "Croquetas de jamón",
      );
      await el.updateComplete;
      await view.updateComplete;
      expect(field(el, "en").shadowRoot!.querySelector("input")!.value).toBe("");
      if (state === "review") {
        api.getContentTranslationCells.mockImplementation(async (refs) => ({
          ...result(),
          cells: refs.map((ref) => ({
            ...cell(ref.id, ref.language),
            ...ref,
            text: "Current long name",
            effectiveText: "Current long name",
            expected: "current",
          })),
        }));
        button(el, "review").click();
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector("[data-review]")).not.toBeNull(),
        );
      } else {
        button(el, "save").click();
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
        );
        await vi.waitFor(() => expect(button(el, "close").disabled).toBe(false));
        if (state === "invalid") {
          expect(field(el).error).toBe(t("translations.name_bytes"));
          expect(api.saveContentTranslations).not.toHaveBeenCalled();
        }
        if (state === "batch-review") {
          button(el, "review-batch").click();
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[data-review]")).not.toBeNull(),
          );
          expect(button(el, "save").disabled).toBe(true);
        }
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
    for (const input of view?.shadowRoot?.querySelectorAll("wt-input") ?? []) {
      expect(input.getBoundingClientRect().left).toBeGreaterThanOrEqual(bodyBounds.left);
      expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(bodyBounds.right);
    }
    if (state === "review" || state === "batch-review") {
      const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review]")!;
      review.scrollIntoView({ block: "center" });
      for (const action of review.querySelectorAll("wt-button")) {
        expect(action.getBoundingClientRect().left).toBeGreaterThanOrEqual(bodyBounds.left);
        expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(bodyBounds.right);
      }
    }
    if (state === "uncertain") {
      const review = button(el, "review-batch");
      await review.updateComplete;
      expect(
        review.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
      ).toBeGreaterThan(0);
    }
    await expectNoA11yViolations(host);
    await page.screenshot({
      element: native,
      path: `__screenshots__/look/a682-editor-${locale}-${theme}-${width}-${state}.png`,
    });
  });
});

const note = (overrides: Partial<ContentSuggestionView>): ContentSuggestionView => ({
  id: "s",
  kind: "product",
  itemId: "suggested",
  item: {
    name:
      (
        { fixed: "STAFF ZURRITO", placeholder: "STAFF ?? nuevo", stale: "STAFF Pan" } as Record<
          string,
          string
        >
      )[overrides.itemId ?? ""] ?? "STAFF Croquetas de la casa",
  },
  language: null,
  text: null,
  placeholder: false,
  fix: null,
  stale: false,
  cell: null,
  expected: null,
  ...overrides,
});
describe.each(["light", "dark"] as const)(
  "translation dialog suggestion accessibility (%s)",
  (theme) => {
    it.each([390, 1280])(
      "renders suggested, fix, placeholder and out-of-date rows in both languages at %i px",
      async (width) => {
        await page.viewport(width, 700);
        expect(window.innerWidth).toBe(width);
        for (const locale of ["en-GB", "es-ES"]) {
          setLocale(locale);
          cleanupWidgets();
          const rows = [
            { ...row("suggested"), name: "STAFF Croquetas de la casa" },
            {
              ...row("fixed"),
              name: "STAFF ZURRITO",
              cells: row("fixed").cells.map((value) =>
                value.language === "en"
                  ? { ...value, text: "CLIENT-en Croquetes", effectiveText: "CLIENT-en Croquetes" }
                  : value,
              ),
            },
            { ...row("placeholder"), name: "STAFF ?? nuevo" },
            { ...row("stale"), name: "STAFF Pan" },
          ];
          const views = [
            note({
              id: "s1",
              language: "es",
              text: "CLIENT-es Croquetas caseras",
              cell: { kind: "product", id: "suggested", language: "es", field: "name" },
              expected: "baseline-suggested-es",
            }),
            note({
              id: "s2",
              language: "en",
              text: "CLIENT-en Homemade croquettes",
              cell: { kind: "product", id: "suggested", language: "en", field: "name" },
              expected: "baseline-suggested-en",
            }),
            note({
              id: "s3",
              itemId: "fixed",
              fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
            }),
            note({
              id: "s4",
              itemId: "fixed",
              language: "en",
              fix: { field: "en", wrong: "Croquetes", right: "Croquettes" },
              cell: { kind: "product", id: "fixed", language: "en", field: "name" },
              expected: "baseline-fixed-en",
            }),
            note({ id: "s5", itemId: "placeholder", placeholder: true }),
            note({
              id: "s6",
              itemId: "stale",
              language: "es",
              text: "CLIENT-es Pan",
              stale: true,
              cell: { kind: "product", id: "stale", language: "es", field: "name" },
              expected: "baseline-stale-es",
            }),
          ];
          const api = {
            getContentTranslationTargets: vi.fn(async () => result(rows)),
            getContentSuggestions: vi.fn(async () => suggestions(views)),
            saveContentTranslations: vi.fn(),
            discardContentSuggestion: vi.fn(),
            startContentSuggestions: vi.fn(async () => ({ run: null })),
          } as unknown as DashboardApi;
          const { el, host } = await mountWidget<ContentTranslationsDialog>(
            "dashboard-content-translations-dialog",
            { api, config, language: "es", open: true },
            theme,
          );
          await vi.waitFor(() => expect(windowFor(el)).not.toBeNull());
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull(),
          );
          await el.updateComplete;
          await windowFor(el).updateComplete;
          for (const id of ["s1", "s3", "s4", "s5", "s6"])
            expect(el.shadowRoot!.querySelector(`[data-suggestion=${id}]`), id).not.toBeNull();
          expect(el.shadowRoot!.querySelector("[data-suggestion=s1]")!.textContent).toContain(
            t("suggestions.suggested"),
          );
          expect(el.shadowRoot!.querySelector("[data-suggestion=s3]")!.textContent).toContain(
            "ZURITO",
          );
          expect(el.shadowRoot!.querySelector("[data-suggestion=s4]")!.textContent).toContain(
            "Croquettes",
          );
          expect(el.shadowRoot!.querySelector("[data-suggestion=s5]")!.textContent).toContain(
            t("suggestions.placeholder"),
          );
          expect(el.shadowRoot!.querySelector("[data-suggestion=s6]")!.textContent).toContain(
            t("suggestions.stale"),
          );
          const modal = el.shadowRoot!.querySelector("wt-modal")!;
          await modal.updateComplete;
          const native = modal.shadowRoot!.querySelector("dialog")!;
          expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
          expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
          await expectNoA11yViolations(host);
          await page.screenshot({
            element: native,
            path: `__screenshots__/look/translate-all-${locale}-${theme}-${width}.png`,
          });
        }
      },
    );
  },
);
