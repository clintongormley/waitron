import { afterEach, expect, it } from "vitest";
import { render } from "lit";
import { setContentLanguages } from "@waitron/ui";
import { currentLocale, setLocale } from "../i18n/t.js";
import { renderTopSellers } from "./top-sellers-table.js";

const host = document.createElement("div");
afterEach(() => render(undefined, host));

it("renders a row's plain staff name verbatim, regardless of the active locale or content languages", () => {
  const previousLocale = currentLocale();
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "ca", languages: ["ca"] });
  try {
    render(
      renderTopSellers([{ name: "Pan de horno", quantity: "2", total: "4.00" }], {
        title: "Product",
        quantity: "Quantity",
        total: "Total",
        empty: "No sales",
        emptyTest: "empty",
      }),
      host,
    );
    // A sales report shows the staff name (CLAUDE.md's three-name table); there is no translation
    // map to resolve here, so a locale/content-language setting that would defeat one must not
    // change what renders.
    expect(host.querySelector('[data-test="seller-name"]')!.textContent).toBe("Pan de horno");
  } finally {
    setLocale(previousLocale);
    setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  }
});
