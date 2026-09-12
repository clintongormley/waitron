import { afterEach, expect, it } from "vitest";
import { render } from "lit";
import { setContentLanguages } from "@waitron/ui";
import { currentLocale, setLocale } from "../i18n/t.js";
import { renderTopSellers } from "./top-sellers-table.js";

const host = document.createElement("div");
afterEach(() => render(undefined, host));

it("keeps a historical receipt name when current content supports a different language", () => {
  const previousLocale = currentLocale();
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "ca", languages: ["ca"] });
  try {
    render(
      renderTopSellers([{ descriptions: { "es-ES": "Pan" }, quantity: "2", total: "4.00" }], {
        title: "Product",
        quantity: "Quantity",
        total: "Total",
        empty: "No sales",
        emptyTest: "empty",
      }),
      host,
    );
    expect(host.querySelector('[data-test="seller-name"]')!.textContent).toBe("Pan");
  } finally {
    setLocale(previousLocale);
    setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  }
});
