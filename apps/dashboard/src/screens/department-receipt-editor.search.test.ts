import { afterEach, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import * as editor from "./department-receipt-editor.js";
import {
  mountReceiptEditor,
  receiptApi,
  receiptModel,
} from "../testing/department-receipt-editor-fixture.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it.each(["en-GB", "es-ES"])(
  "aligns receipt declarations with mounted controls, empty/saved logo (%s)",
  async (locale) => {
    setLocale(locale);
    for (const savedLogo of [false, true]) {
      const { el } = await mountReceiptEditor(
        receiptApi({
          ...receiptModel,
          receipt: { ...receiptModel.receipt, ...(savedLogo ? { logo: "/media/logo.png" } : {}) },
        }),
      );
      await expect.poll(() => el.shadowRoot!.querySelector("[name=previewWidth]")).toBeTruthy();
      const actual = new Set<string>();
      for (const field of el.shadowRoot!.querySelectorAll<HTMLElement & { label: string }>(
        "[name]",
      )) {
        const name = field.getAttribute("name")!;
        if (["previewLanguage", "previewWidth"].includes(name)) continue;
        if (name === "logo") {
          const button = field.shadowRoot!.querySelector("[data-test=choose-image]")!;
          const label =
            button.getAttribute("aria-label") ?? button.textContent!.replace("+", "").trim();
          expect(label).toBe(t(savedLogo ? "image.change_logo" : "image.add_logo"));
          actual.add(JSON.stringify([name, t("appearance.logo")]));
        } else actual.add(JSON.stringify([name.replace(/-(?:es|ca)-ES$/, ""), field.label]));
      }
      const declarations = Reflect.get(editor, "departmentReceiptSettingFields") as
        readonly { name: string; labelKey: Parameters<typeof t>[0] }[] | undefined;
      expect(declarations, "receipt settings publish their searchable labels").toBeDefined();
      const declared = declarations!.map(({ name, labelKey }) =>
        JSON.stringify([name, t(labelKey)]),
      );
      expect(declared).toHaveLength(new Set(declared).size);
      expect(new Set(declared)).toEqual(actual);
      cleanupWidgets();
    }
  },
);
