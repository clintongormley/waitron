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
      renderTopSellers([{ name: "Pan de horno", quantity: "2", total: "4.00", variants: [] }], {
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

const labels = {
  title: "Product",
  quantity: "Quantity",
  total: "Total",
  empty: "No sales",
  emptyTest: "empty",
};

it("draws each product's variants as rows beneath it, in the order the server sent them", () => {
  render(
    renderTopSellers(
      [
        {
          name: "Wine by the glass",
          quantity: "5.000",
          total: "24.50",
          variants: [
            { name: "Wine 175", quantity: "3.000", total: "16.50" },
            { name: "Wine 125", quantity: "2.000", total: "8.00" },
          ],
        },
        { name: "Tea", quantity: "2.000", total: "4.00", variants: [] },
      ],
      labels,
    ),
    host,
  );
  const rows = [...host.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-test"));
  expect(rows).toEqual([
    "seller-row-0",
    "seller-row-0-variant-0",
    "seller-row-0-variant-1",
    "seller-row-1",
  ]);
  const cells = (test: string) =>
    [...host.querySelectorAll(`[data-test="${test}"] td`)].map((td) => td.textContent?.trim());
  expect(cells("seller-row-0")).toEqual(["5.000", "24.50"]);
  expect(cells("seller-row-0-variant-0")).toEqual(["3.000", "16.50"]);
  expect(cells("seller-row-0-variant-1")).toEqual(["2.000", "8.00"]);
  // The visible label is the variant's own name alone; the parent's rides in visually hidden text,
  // so the row header's text is "Wine by the glass, Wine 175".
  const variantHeader = host.querySelector('[data-test="seller-row-0-variant-0"] th[scope="row"]')!;
  expect(variantHeader.querySelector('[data-test="variant-name"]')!.textContent).toBe("Wine 175");
  expect(variantHeader.querySelector(".visually-hidden")!.textContent).toBe("Wine by the glass, ");
  // Variant rows do not count as products: only the two parents carry the product-name hook.
  expect([...host.querySelectorAll('[data-test="seller-name"]')].map((n) => n.textContent)).toEqual(
    ["Wine by the glass", "Tea"],
  );
});
