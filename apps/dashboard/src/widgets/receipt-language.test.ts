import { render } from "lit";
import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { receiptLanguageWarning } from "./receipt-language.js";

const before = currentLocale();
const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
  setLocale(before);
});

it.each([
  [
    "en-GB",
    "By default, receipts print in French, which is not one of your content languages. Product names on them print in A $& {receipt}, the default language.",
  ],
  [
    "es-ES",
    "Por defecto, los recibos se imprimen en francés, que no es uno de tus idiomas del contenido. Los nombres de los productos salen en A $& {receipt}, el idioma predeterminado.",
  ],
])("keeps an unnamed default content language literal (%s)", (locale, expected) => {
  setLocale(locale);
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  render(
    receiptLanguageWarning("fr-FR", { languages: ["en"], defaultLanguage: "A $& {receipt}" }),
    host,
  );
  expect(host.querySelector("[data-test=receipt-language-warning]")!.textContent).toBe(expected);
});
