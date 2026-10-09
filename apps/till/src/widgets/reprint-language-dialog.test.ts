import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./reprint-language-dialog.js";
import type {
  ReprintLanguageDetail,
  TillReprintLanguageDialog,
} from "./reprint-language-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

const SPAIN = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];

async function mountDialog(
  props: Partial<TillReprintLanguageDialog> = {},
): Promise<TillReprintLanguageDialog> {
  const { el } = await mountWidget<TillReprintLanguageDialog>("till-reprint-language-dialog", {
    languages: SPAIN,
    defaultLanguage: "ca-ES",
    ...props,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}

const radios = (el: TillReprintLanguageDialog) => [
  ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];

const optionTexts = (el: TillReprintLanguageDialog) =>
  [...el.shadowRoot!.querySelectorAll("label")].map((label) => label.textContent!.trim());

const button = (el: TillReprintLanguageDialog, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-reprint-${name}]`)!;

function captured(el: TillReprintLanguageDialog) {
  const seen: { chose: ReprintLanguageDetail[]; cancelled: number } = { chose: [], cancelled: 0 };
  el.addEventListener("reprint-language-confirm", (event) =>
    seen.chose.push((event as CustomEvent<ReprintLanguageDetail>).detail),
  );
  el.addEventListener("reprint-language-cancel", () => (seen.cancelled += 1));
  return seen;
}

describe("till-reprint-language-dialog", () => {
  it("offers each receipt language by name, one radio each, all named language", async () => {
    const el = await mountDialog();

    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(t("reprint_language.title"));
    expect(el.shadowRoot!.querySelector("legend")!.textContent!.trim()).toBe(
      t("reprint_language.legend"),
    );
    expect(optionTexts(el)).toEqual(["Spanish", "Catalan", "Galician", "Basque"]);
    expect(radios(el).map((radio) => [radio.name, radio.value])).toEqual(
      SPAIN.map((tag) => ["language", tag]),
    );
  });

  it("names the languages in the operator's language, capitalised to stand alone", async () => {
    setLocale("es-ES");
    const el = await mountDialog();

    expect(optionTexts(el)).toEqual(["Español", "Catalán", "Gallego", "Euskera"]);
  });

  it("starts on the language it is given", async () => {
    const el = await mountDialog({ defaultLanguage: "gl-ES" });

    expect(
      radios(el)
        .filter((radio) => radio.checked)
        .map((radio) => radio.value),
    ).toEqual(["gl-ES"]);
  });

  it("has the language it starts on focused", async () => {
    const el = await mountDialog({ defaultLanguage: "gl-ES" });

    expect(el.shadowRoot!.activeElement).toBe(radios(el).find((radio) => radio.value === "gl-ES"));
  });

  it("starts on the first language when the one it is given is not among them", async () => {
    const el = await mountDialog({ defaultLanguage: "en-GB" });

    expect(
      radios(el)
        .filter((radio) => radio.checked)
        .map((radio) => radio.value),
    ).toEqual(["es-ES"]);
  });

  it("reprints in the language chosen, and in the default when nothing else is chosen", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    button(el, "confirm").click();
    radios(el)[0]!.click();
    button(el, "confirm").click();

    expect(seen.chose).toEqual([{ language: "ca-ES" }, { language: "es-ES" }]);
    expect(seen.cancelled).toBe(0);
  });

  it("keeps a radio's change to itself", async () => {
    const el = await mountDialog();
    const changes = vi.fn();
    el.shadowRoot!.addEventListener("change", changes);

    radios(el)[2]!.click();

    expect(radios(el)[2]!.checked).toBe(true);
    expect(changes).not.toHaveBeenCalled();
  });

  it("cancels from its button and on Escape without reprinting", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    button(el, "cancel").click();
    const closed = new Promise((resolve) =>
      el
        .shadowRoot!.querySelector("wt-dialog")!
        .addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;

    await vi.waitFor(() => expect(seen.cancelled).toBe(2));
    expect(seen.chose).toEqual([]);
  });

  it("keeps its choices and buttons inside the dialog on a 390px phone", async () => {
    await page.viewport(390, 844);
    try {
      const el = await mountDialog();
      expect(window.innerWidth).toBe(390);
      const dialog = el.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!;
      const box = dialog.querySelector("dialog")!.getBoundingClientRect();
      expect(box.right).toBeLessThanOrEqual(390);
      for (const radio of radios(el))
        expect(radio.closest("label")!.getBoundingClientRect().right).toBeLessThanOrEqual(
          box.right,
        );
      for (const name of ["cancel", "confirm"])
        expect(button(el, name).getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
    } finally {
      await page.viewport(414, 896);
    }
  });
});
