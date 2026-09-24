import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { cardPreview } from "./card-preview.js";
import { CARD_TYPES, type CardType } from "./card-contracts.js";

/**
 * The loop over `CARD_TYPES` drives the exhaustive switch, and each type's MARKER pins a genuinely
 * distinct shape rather than one box under different names.
 */
const hosts: HTMLElement[] = [];
function renderPreview(type: CardType): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  render(cardPreview(type), host);
  return host;
}
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const MARKERS: Record<CardType, string> = {
  "product-grid": ".cp-cell",
  basket: ".cp-line",
  total: ".cp-amount",
  "tender-pay": ".cp-pay",
  "held-orders": ".cp-chip",
  "prep-queue": ".cp-ticket",
  notifications: ".cp-bell",
  "floor-plan": ".cp-table",
  "table-layout-editor": ".cp-edit-handle",
  "kds-board": ".cp-column",
  expo: ".cp-expo-ticket",
  "table-order": ".cp-header",
};

describe("cardPreview", () => {
  it.each(CARD_TYPES)("renders a non-empty, type-specific silhouette for %s", (type) => {
    const host = renderPreview(type);
    const root = host.querySelector<HTMLElement>(`[data-preview="${type}"]`);
    expect(root, `no silhouette root [data-preview="${type}"]`).toBeTruthy();
    expect(root!.children.length, `silhouette for ${type} is empty`).toBeGreaterThan(0);
    expect(
      root!.querySelector(MARKERS[type]),
      `silhouette for ${type} is missing its marker ${MARKERS[type]}`,
    ).toBeTruthy();
  });

  it("gives every card type a distinct silhouette root", () => {
    const values = CARD_TYPES.map((type) =>
      renderPreview(type).querySelector("[data-preview]")!.getAttribute("data-preview"),
    );
    expect(values).toEqual([...CARD_TYPES]);
    expect(new Set(values).size).toBe(CARD_TYPES.length);
  });

  it("renders a mini grid of several cells for product-grid", () => {
    const host = renderPreview("product-grid");
    expect(host.querySelectorAll(".cp-cell").length).toBeGreaterThanOrEqual(4);
  });

  it("renders a couple of pay buttons for tender-pay", () => {
    const host = renderPreview("tender-pay");
    expect(host.querySelectorAll(".cp-pay").length).toBeGreaterThanOrEqual(2);
  });

  it("renders multiple ticket columns for kds-board", () => {
    const host = renderPreview("kds-board");
    expect(host.querySelectorAll(".cp-column").length).toBeGreaterThanOrEqual(2);
  });

  it("returns the same memoized TemplateResult instance for a given type", () => {
    // Referential stability lets Lit skip re-rendering a tile's silhouette on every drag frame.
    for (const type of CARD_TYPES) {
      expect(cardPreview(type), `silhouette for ${type} is not memoized`).toBe(cardPreview(type));
    }
  });

  it("renders the total and tender-pay silhouettes as pure shapes with no text", () => {
    // These silhouettes carry no text: a literal here would show untranslated in other locales.
    for (const type of ["total", "tender-pay"] as const) {
      const host = renderPreview(type);
      const root = host.querySelector<HTMLElement>(`[data-preview="${type}"]`)!;
      expect(root.textContent!.trim(), `silhouette for ${type} carries visible text`).toBe("");
    }
  });
});
