import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type {
  TranslationCell,
  TranslationItem,
} from "@waitron/catalogue/src/content-translation-types.js";
import { setLocale } from "../i18n/t.js";
import { TranslationDrafts } from "./content-translations-model.js";
import { ContentTranslationWindow } from "./content-translations-window.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

const languages = ["es", "en", "fr", "de", "ca", "pt", "it"];
const config = { defaultLanguage: "es", languages };
function row(kind: "product" | "unit", unavailable: boolean): TranslationItem {
  const owners = kind === "unit" ? ({ kind } as const) : ({ kind, parentId: null } as const);
  return {
    kind,
    id: kind,
    name: kind === "unit" ? "STAFF kilogram / kilogramo" : "STAFF croquette / croqueta",
    owners,
    cells: languages.flatMap((language) =>
      (kind === "unit" ? (["name", "abbreviation"] as const) : (["name"] as const)).map(
        (field) =>
          ({
            kind,
            id: kind,
            language,
            field,
            owners,
            text: null,
            inheritedText: null,
            effectiveText: null,
            defaultText: null,
            inheritedDefaultText: null,
            effectiveDefaultText: null,
            expected: "original",
            staffText:
              field === "abbreviation"
                ? "kg"
                : kind === "unit"
                  ? "STAFF kilogram"
                  : "STAFF croquette",
            eligible: !unavailable,
            unavailableReason: unavailable ? "inactive" : null,
          }) satisfies TranslationCell,
      ),
    ),
  };
}
const original = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(original.width, original.height);
});

describe.each(["light", "dark"] as const)(
  "translation field window accessibility (%s)",
  (theme) => {
    it.each([390, 1280])(
      "paints optional, entered, unavailable and refused fields at %i px",
      async (width) => {
        await page.viewport(width, 850);
        expect(window.innerWidth).toBe(width);
        for (const locale of ["en-GB", "es-ES"]) {
          setLocale(locale);
          for (const state of ["empty", "entered", "unavailable", "refused"] as const) {
            cleanupWidgets();
            const rows = [
              row("product", state === "unavailable"),
              row("unit", state === "unavailable"),
            ];
            const drafts = new TranslationDrafts(
              config,
              rows.flatMap((row) => row.cells),
            );
            if (state === "entered") {
              drafts.edit(rows[0]!.cells[1]!, "CUSTOMER croquette");
              drafts.edit(rows[1]!.cells[2]!, "CUSTOMER kilogram");
              drafts.edit(rows[1]!.cells[3]!, "kilo");
            }
            const { el, host } = await mountWidget<ContentTranslationWindow>(
              "dashboard-content-translation-window",
              {
                rows,
                drafts,
                languages,
                anchor: "en",
                width: width === 390 ? "phone" : "desktop",
                errors:
                  state === "refused"
                    ? [
                        {
                          cell: rows[1]!.cells[3]!,
                          message:
                            locale === "en-GB"
                              ? "Review this changed abbreviation before saving."
                              : "Revisa esta abreviatura modificada antes de guardar.",
                        },
                      ]
                    : [],
              },
              theme,
            );
            const fields = [...el.shadowRoot!.querySelectorAll("wt-input")];
            await Promise.all(fields.map((field) => field.updateComplete));
            for (const field of fields) {
              const native = field.shadowRoot!.querySelector("input")!;
              const bounds = native.getBoundingClientRect();
              expect(bounds.left).toBeGreaterThanOrEqual(0);
              expect(bounds.right).toBeLessThanOrEqual(width);
              expect(bounds.width).toBeGreaterThan(0);
              expect(native.required).toBe(false);
              expect(native.disabled).toBe(state === "unavailable");
              expect(native.name).toBe(field.name);
              if (width === 390) expect(bounds.width).toBeGreaterThan(300);
            }
            expect(fields).toHaveLength(width === 390 ? 9 : 18);
            await expectNoA11yViolations(host);
            await page.screenshot({
              element: el,
              path: `__screenshots__/look/a682-window-${locale}-${theme}-${width}-${state}.png`,
            });
          }
        }
      },
    );
  },
);
