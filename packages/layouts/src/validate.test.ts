import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import { MAX_RECEIPT_FIELD_LENGTH, validateLayout, validateReceiptConfig } from "./validate.js";
import { WIDGET_CONFIG } from "./widget-config.js";
import { DEFAULT_LAYOUT } from "./defaults.js";

/** Run `fn`, assert it threw an `AppError`, and return it so the caller can inspect code + params.
 *  A plain `toThrow` checks the message (= the code) but not the params, which is where these codes
 *  carry the whole of what went wrong (CLAUDE.md §1: params name the problem). */
function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error("expected the call to throw an AppError, but it returned");
}

/** A fresh, fully-valid layout (all six widgets, one region each, no duplicates) as a mutable array of
 *  plain objects, so a case can corrupt one field without touching DEFAULT_LAYOUT or a sibling test. */
function validLayout(): unknown[] {
  return [
    { type: "product-grid", region: "main", config: {} },
    { type: "basket", region: "aside", config: {} },
    { type: "total", region: "aside", config: {} },
    { type: "tender-pay", region: "aside", config: {} },
    { type: "held-orders", region: "aside", config: {} },
    { type: "prep-queue", region: "aside", config: {} },
  ];
}

describe("validateLayout", () => {
  it("returns a valid LayoutDef unchanged (round-trips DEFAULT_LAYOUT)", () => {
    expect(validateLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });

  it("rejects a non-array with reason not_array", () => {
    const error = catchAppError(() => validateLayout({ not: "an array" }));
    expect(error.code).toBe("layout.invalid");
    expect(error.params).toEqual({ reason: "not_array" });
  });

  it.each([
    ["a string", ["basket"]],
    ["null", [null]],
    ["a nested array", [[]]],
  ])("rejects %s item with reason unknown_widget", (_label, input) => {
    const error = catchAppError(() => validateLayout(input));
    expect(error.code).toBe("layout.invalid");
    expect(error.params).toEqual({ reason: "unknown_widget" });
  });

  it("rejects a non-string type with reason unknown_widget (the bad value is not echoed)", () => {
    const error = catchAppError(() => validateLayout([{ type: 5, region: "main", config: {} }]));
    expect(error.params).toEqual({ reason: "unknown_widget" });
  });

  it("rejects an unknown widget type with reason unknown_widget", () => {
    const error = catchAppError(() =>
      validateLayout([{ type: "nope", region: "main", config: {} }]),
    );
    expect(error.params).toEqual({ reason: "unknown_widget" });
  });

  it("rejects a bad region with reason bad_region, naming the widget", () => {
    const error = catchAppError(() =>
      validateLayout([{ type: "product-grid", region: "sidebar", config: {} }]),
    );
    expect(error.params).toEqual({ reason: "bad_region", widget: "product-grid" });
  });

  it("accepts product-grid { columns: 3 }", () => {
    const layout = validLayout();
    (layout[0] as { config: unknown }).config = { columns: 3 };
    expect(validateLayout(layout)[0]?.config).toEqual({ columns: 3 });
  });

  it.each([
    ["0 (below range)", 0],
    ["13 (above range)", 13],
    ["3.5 (non-integer)", 3.5],
    ['"x" (non-number)', "x"],
  ])("rejects product-grid { columns: %s } with reason bad_config", (_label, columns) => {
    const error = catchAppError(() =>
      validateLayout([{ type: "product-grid", region: "main", config: { columns } }]),
    );
    expect(error.params).toEqual({
      reason: "bad_config",
      widget: "product-grid",
      configKey: "columns",
    });
  });

  it("rejects an unknown config key (fail-closed, design D8), naming the key", () => {
    const error = catchAppError(() =>
      validateLayout([{ type: "product-grid", region: "main", config: { columns: 3, bogus: 1 } }]),
    );
    expect(error.params).toEqual({
      reason: "bad_config",
      widget: "product-grid",
      configKey: "bogus",
    });
  });

  it("rejects any key on a widget whose schema is empty", () => {
    const error = catchAppError(() =>
      validateLayout([{ type: "basket", region: "aside", config: { foo: 1 } }]),
    );
    expect(error.params).toEqual({ reason: "bad_config", widget: "basket", configKey: "foo" });
  });

  it("rejects a non-object config with reason bad_config", () => {
    const error = catchAppError(() =>
      validateLayout([{ type: "basket", region: "aside", config: "x" }]),
    );
    expect(error.params).toEqual({ reason: "bad_config", widget: "basket" });
  });

  it("rejects a duplicate widget type with reason duplicate (design D5)", () => {
    const error = catchAppError(() =>
      validateLayout([
        { type: "basket", region: "aside", config: {} },
        { type: "basket", region: "aside", config: {} },
      ]),
    );
    expect(error.params).toEqual({ reason: "duplicate", widget: "basket" });
  });

  it("rejects a layout missing a sale-critical widget with reason missing_required (design D4)", () => {
    const layout = validLayout().filter((w) => (w as { type: string }).type !== "total");
    const error = catchAppError(() => validateLayout(layout));
    expect(error.params).toEqual({ reason: "missing_required", widget: "total" });
  });
});

describe("WIDGET_CONFIG", () => {
  it("wires columns only on product-grid; every other widget has an empty schema", () => {
    expect(Object.keys(WIDGET_CONFIG["product-grid"])).toEqual(["columns"]);
    for (const type of ["basket", "total", "tender-pay", "held-orders", "prep-queue"] as const) {
      expect(WIDGET_CONFIG[type]).toEqual({});
    }
  });

  it("the columns validator accepts an integer in 1..12 and rejects out-of-range / non-integers", () => {
    const columns = WIDGET_CONFIG["product-grid"].columns;
    expect(columns?.(1)).toBe(true);
    expect(columns?.(12)).toBe(true);
    expect(columns?.(0)).toBe(false);
    expect(columns?.(13)).toBe(false);
    expect(columns?.(3.5)).toBe(false);
    expect(columns?.("3")).toBe(false);
  });
});

describe("validateReceiptConfig", () => {
  it("accepts an empty config", () => {
    expect(validateReceiptConfig({})).toEqual({});
  });

  it("accepts a footerMessage", () => {
    expect(validateReceiptConfig({ footerMessage: "Gracias por su visita" })).toEqual({
      footerMessage: "Gracias por su visita",
    });
  });

  it("accepts a headerSubtitle and a footerMessage together", () => {
    const input = { headerSubtitle: "Calle Mayor 1", footerMessage: "Hasta pronto" };
    expect(validateReceiptConfig(input)).toEqual(input);
  });

  it("accepts a field exactly at the length cap", () => {
    const value = "x".repeat(MAX_RECEIPT_FIELD_LENGTH);
    expect(validateReceiptConfig({ footerMessage: value })).toEqual({ footerMessage: value });
  });

  it("rejects a non-object input with reason not_object", () => {
    const error = catchAppError(() => validateReceiptConfig(null));
    expect(error.code).toBe("receipt.invalid");
    expect(error.params).toEqual({ reason: "not_object" });
  });

  it("rejects a non-string field with reason not_string, naming the field", () => {
    const error = catchAppError(() => validateReceiptConfig({ footerMessage: 5 }));
    expect(error.params).toEqual({ reason: "not_string", field: "footerMessage" });
  });

  it("rejects an over-length field with reason too_long (the length is not echoed)", () => {
    const value = "x".repeat(MAX_RECEIPT_FIELD_LENGTH + 1);
    const error = catchAppError(() => validateReceiptConfig({ headerSubtitle: value }));
    expect(error.params).toEqual({
      reason: "too_long",
      field: "headerSubtitle",
      maxLength: MAX_RECEIPT_FIELD_LENGTH,
    });
  });

  it("rejects an unknown field with reason unknown_field (fail-closed — no field may suppress the fiscal core, design §8)", () => {
    const error = catchAppError(() => validateReceiptConfig({ showCashChange: true }));
    expect(error.params).toEqual({ reason: "unknown_field" });
  });
});
