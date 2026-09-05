import { describe, expect, it } from "vitest";
import { validateCanvasDraft } from "./validate-canvas.js";
import type { CanvasDef } from "./card-contracts.js";

const tillDraft = (): CanvasDef => ({
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
        { type: "total", colSpan: 4, rowSpan: 1, config: {} },
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
      ],
    },
  ],
});

describe("validateCanvasDraft", () => {
  it("returns null for a valid till canvas", () => {
    expect(validateCanvasDraft(tillDraft())).toBeNull();
  });
  it("flags a till canvas missing a sale-critical card", () => {
    const d = tillDraft();
    d.tabs[0]!.cards = d.tabs[0]!.cards.filter((c) => c.type !== "total");
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_missing_required");
  });
  it("does NOT require sale-critical cards on a non-till canvas", () => {
    const d = tillDraft();
    d.formFactor = "kds";
    d.tabs[0]!.cards = [{ type: "kds-board", colSpan: 12, rowSpan: 12, config: {} }];
    expect(validateCanvasDraft(d)).toBeNull();
  });
  it("flags no tabs", () => {
    const d = tillDraft();
    d.tabs = [];
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_no_tabs");
  });
  it("flags a duplicate tab key", () => {
    const d = tillDraft();
    d.tabs.push({ ...d.tabs[0]!, cards: [] });
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_duplicate_tab");
  });
  it("flags a blank title", () => {
    const d = tillDraft();
    d.tabs[0]!.title = "";
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_tab");
  });
  it("flags an over-long title", () => {
    const d = tillDraft();
    d.tabs[0]!.title = "x".repeat(61);
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_tab");
  });
  it("flags columns out of 1..24", () => {
    const d = tillDraft();
    d.tabs[0]!.columns = 25;
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_columns");
  });
  it("flags a colSpan over the tab columns", () => {
    const d = tillDraft();
    d.tabs[0]!.cards[0]!.colSpan = 99;
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_span");
  });
  it("flags a rowSpan below 1", () => {
    const d = tillDraft();
    d.tabs[0]!.cards[0]!.rowSpan = 0;
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_span");
  });
  it("flags a visibleWhen not a subset of the card's states", () => {
    const d = tillDraft();
    d.tabs[0]!.cards.push({
      type: "held-orders",
      colSpan: 4,
      rowSpan: 2,
      config: {},
      visibleWhen: ["nope"],
    });
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_visible_when");
  });
  it("flags product-grid.columns out of 1..12", () => {
    const d = tillDraft();
    d.tabs[0]!.cards[0]!.config = { columns: 13 };
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_config");
  });
});
