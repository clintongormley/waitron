// validate-canvas.ts — a LIGHT client mirror of @waitron/layouts' validateCanvas, covering the
// author-facing rules for fast in-editor feedback. Returns null when valid, else the i18n key of the
// FIRST broken rule. The SERVER's validateCanvas stays authoritative on every write — a client pass is
// never a guarantee, and a server canvas.invalid still surfaces in the banner.
import {
  CARD_CONTRACTS,
  GRID_MAX_COLUMNS,
  MAX_TAB_TITLE_LENGTH,
  SALE_CRITICAL_CARDS,
} from "./card-contracts.js";
import type { CanvasDef } from "./card-contracts.js";

export function validateCanvasDraft(draft: CanvasDef): string | null {
  if (draft.tabs.length === 0) return "canvas_editor.err_no_tabs";
  const seen = new Set<string>();
  for (const tab of draft.tabs) {
    if (seen.has(tab.key)) return "canvas_editor.err_duplicate_tab";
    seen.add(tab.key);
    if (tab.title.length === 0 || tab.title.length > MAX_TAB_TITLE_LENGTH)
      return "canvas_editor.err_bad_tab";
    if (!Number.isInteger(tab.columns) || tab.columns < 1 || tab.columns > GRID_MAX_COLUMNS) {
      return "canvas_editor.err_bad_columns";
    }
    for (const card of tab.cards) {
      if (!Number.isInteger(card.colSpan) || card.colSpan < 1 || card.colSpan > tab.columns)
        return "canvas_editor.err_bad_span";
      if (!Number.isInteger(card.rowSpan) || card.rowSpan < 1) return "canvas_editor.err_bad_span";
      const states = CARD_CONTRACTS[card.type].visibilityStates;
      if (card.visibleWhen?.some((s) => !states.includes(s)))
        return "canvas_editor.err_bad_visible_when";
      if (card.type === "product-grid" && card.config.columns !== undefined) {
        const n = card.config.columns;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 12)
          return "canvas_editor.err_bad_config";
      }
    }
  }
  if (draft.formFactor === "till") {
    const placed = new Set(draft.tabs.flatMap((t) => t.cards.map((c) => c.type)));
    for (const req of SALE_CRITICAL_CARDS)
      if (!placed.has(req)) return "canvas_editor.err_missing_required";
  }
  return null;
}
