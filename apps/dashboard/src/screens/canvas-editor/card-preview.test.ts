import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { cardPreview } from "./card-preview.js";
import { CARD_TYPES, type CardType } from "./card-contracts.js";

/**
 * `cardPreview` is a dashboard-LOCAL, static, presentational silhouette per card type — a
 * recognizable preview of what each till card looks like, with NO data binding. These tests render
 * the bare TemplateResult into a detached container and assert on structure only (the silhouette's
 * chrome is styled by the host component's shadow CSS, so no styling is needed here).
 *
 * Each silhouette's root carries `data-preview="<type>"`; a per-type MARKER selector pins that each
 * type produces a genuinely DISTINCT shape (not just a shared box under a different name). The loop
 * over the full `CARD_TYPES` list drives the exhaustive switch: a missing case throws (and fails to
 * compile), so removing any case fails this suite.
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

/** A structure marker unique to each type's silhouette, so "distinct" means distinct shape. */
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
    // The silhouettes depend only on `type` (no data), so they are built ONCE at module load and the
    // same static instance is returned for every render. Referential stability across calls is what
    // lets Lit skip re-rendering a tile's silhouette on every drag frame.
    for (const type of CARD_TYPES) {
      expect(cardPreview(type), `silhouette for ${type} is not memoized`).toBe(cardPreview(type));
    }
  });

  it("renders the total and tender-pay silhouettes as pure shapes with no text", () => {
    // Localisation discipline: unlike the other ten silhouettes these two once carried hardcoded
    // English literals (a currency amount, "Cash"/"Card"). They are decorative (aria-hidden) shapes,
    // so a non-English locale must never see untranslated text leak through them.
    for (const type of ["total", "tender-pay"] as const) {
      const host = renderPreview(type);
      const root = host.querySelector<HTMLElement>(`[data-preview="${type}"]`)!;
      expect(root.textContent!.trim(), `silhouette for ${type} carries visible text`).toBe("");
    }
  });
});
