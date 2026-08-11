import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { Product } from "../api/client.js";
import { ProductList } from "./product-list.js";

afterEach(cleanupWidgets);

/**
 * A representative product carrying every field the list reads; individual tests override the one
 * field they exercise (allergens, image, active, descriptions) via a spread so the fixture stays the
 * single source for the rest.
 */
function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    catalogueId: "cat-1",
    categoryId: "category-1",
    descriptions: { es: "Croquetas de jamón" },
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    allergens: null,
    image: null,
    ...overrides,
  };
}

describe("product-list", () => {
  it("renders one wt-card row per product", async () => {
    const products = [product({ id: "a" }), product({ id: "b" }), product({ id: "c" })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const rows = el.shadowRoot!.querySelectorAll("wt-card[data-test=row]");
    expect(rows.length).toBe(3);
  });

  it("shows the name from descriptions[primaryLocale] (default es)", async () => {
    const products = [
      product({ descriptions: { es: "Croquetas de jamón", en: "Ham croquettes" } }),
    ];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const row = el.shadowRoot!.querySelector("[data-test=row]")!;
    expect(row.textContent).toContain("Croquetas de jamón");
    expect(row.textContent).not.toContain("Ham croquettes");
  });

  it("falls back to another description when the primary locale is absent", async () => {
    // primaryLocale es, but this product only carries en — a name in the wrong language beats a blank
    // row (the productName graceful-degrade approach, apps/till/src/widgets/product-name.ts).
    const products = [product({ descriptions: { en: "Ham croquettes" } })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products,
      primaryLocale: "es",
    });
    expect(el.shadowRoot!.querySelector("[data-test=row]")!.textContent).toContain(
      "Ham croquettes",
    );
  });

  it("honours a non-default primaryLocale", async () => {
    const products = [product({ descriptions: { es: "Croquetas", en: "Croquettes" } })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products,
      primaryLocale: "en",
    });
    const row = el.shadowRoot!.querySelector("[data-test=row]")!;
    expect(row.textContent).toContain("Croquettes");
    expect(row.textContent).not.toContain("Croquetas");
  });

  it("shows the gross unitPrice and pricingUnit", async () => {
    const products = [product({ unitPrice: "12.00", pricingUnit: "weight" })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const text = el.shadowRoot!.querySelector("[data-test=row]")!.textContent!;
    expect(text).toContain("12.00");
    expect(text).toContain("weight");
  });

  it("shows the vatClass", async () => {
    const products = [product({ vatClass: "super_reduced" })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    expect(el.shadowRoot!.querySelector("[data-test=row]")!.textContent).toContain("super_reduced");
  });

  it("shows an active/inactive badge carrying text, not colour alone", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "on", active: true }), product({ id: "off", active: false })],
    });
    const badges = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=active-badge]");
    expect(badges.length).toBe(2);
    // Each badge names its state in text (an a11y requirement — not conveyed by colour alone).
    expect(badges[0]!.getAttribute("data-active")).toBe("true");
    expect(badges[0]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[1]!.getAttribute("data-active")).toBe("false");
    expect(badges[1]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[0]!.textContent).not.toBe(badges[1]!.textContent);
  });

  // The three-state allergen invariant (design §7): null=PENDING, {}=none, {…}=declared. PENDING and
  // none MUST be distinguishable — fourteen blank cells must never silently claim "allergen-free".
  it("renders a PENDING allergen pill when allergens is null", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ allergens: null })],
    });
    const pill = el.shadowRoot!.querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("pending");
    expect(pill.textContent!.trim().length).toBeGreaterThan(0);
  });

  it("renders a 'none' allergen pill when allergens is an empty map", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ allergens: {} })],
    });
    const pill = el.shadowRoot!.querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("none");
  });

  it("renders a 'declared' allergen pill when allergens has entries", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ allergens: { gluten: { presence: "contains", source: "trigo" } } })],
    });
    const pill = el.shadowRoot!.querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("declared");
  });

  it("distinguishes all three allergen states from one another", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "p", allergens: null }),
        product({ id: "n", allergens: {} }),
        product({ id: "d", allergens: { milk: { presence: "contains" } } }),
      ],
    });
    const states = Array.from(
      el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=allergen-state]"),
      (pill) => pill.getAttribute("data-state"),
    );
    expect(states).toEqual(["pending", "none", "declared"]);
    // PENDING and none are not the same rendered text (the whole point of the invariant).
    const pills = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=allergen-state]");
    expect(pills[0]!.textContent).not.toBe(pills[1]!.textContent);
  });

  it("renders a thumbnail <img> served from /media with alt text when image is set", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ image: "abc123.webp", descriptions: { es: "Croquetas" } })],
    });
    const img = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=thumb] img")!;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("/media/abc123.webp");
    // A meaningful alt (the product name), never an empty string on a content image.
    expect(img.getAttribute("alt")).toBe("Croquetas");
    expect(el.shadowRoot!.querySelector("[data-test=thumb-placeholder]")).toBeNull();
  });

  it("renders a placeholder (no <img>) when image is null", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ image: null })],
    });
    expect(el.shadowRoot!.querySelector("[data-test=thumb] img")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=thumb-placeholder]")).not.toBeNull();
  });

  it("emits edit-product with the product id when a row's Edit control is clicked", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "prod-42" })],
    });
    const detail = new Promise<{ productId: string }>((resolve) =>
      el.addEventListener("edit-product", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-prod-42]")!.click();
    expect((await detail).productId).toBe("prod-42");
  });

  // edit-product must escape this widget's shadow boundary to reach the catalogue screen, so it is
  // dispatched bubbles+composed — pinned so a future edit does not quietly drop either flag.
  it("emits edit-product as a bubbling, composed event", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "prod-9" })],
    });
    const seen = new Promise<Event>((resolve) => el.addEventListener("edit-product", resolve));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-prod-9]")!.click();
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("renders no rows for an empty products list", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products: [] });
    expect(el.shadowRoot!.querySelectorAll("[data-test=row]").length).toBe(0);
  });
});
