// The entire public surface of @waitron/layouts. Re-exports only — no logic here.
export { WIDGET_TYPES } from "./types.js";
export type { WidgetType, Region, WidgetInstance, LayoutDef, ReceiptConfig } from "./types.js";
export { DEFAULT_LAYOUT, DEFAULT_RECEIPT } from "./defaults.js";
export { WIDGET_CONFIG } from "./widget-config.js";
export type { ConfigValidator, WidgetConfigSchema } from "./widget-config.js";
export { MAX_RECEIPT_FIELD_LENGTH, validateLayout, validateReceiptConfig } from "./validate.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts (and
// guarded tree-wide by scripts/errors-reachable.test.ts).
import "./errors.js";
