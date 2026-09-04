// The entire public surface of @waitron/layouts. Re-exports only — no logic here.
export { WIDGET_TYPES } from "./types.js";
export type { WidgetType, Region, WidgetInstance, LayoutDef, ReceiptConfig } from "./types.js";
export { DEFAULT_LAYOUT, DEFAULT_RECEIPT } from "./defaults.js";
export { WIDGET_CONFIG } from "./widget-config.js";
export type { ConfigValidator, WidgetConfigSchema } from "./widget-config.js";
export { MAX_RECEIPT_FIELD_LENGTH, validateLayout, validateReceiptConfig } from "./validate.js";
export { MAX_TAB_TITLE_LENGTH, validateCanvas } from "./validate-canvas.js";
export { getLayout, putLayout, putReceipt } from "./store.js";

// Layout-canvas data model (SP-A.1). Coexists with the widget model above during the transition.
export { FORM_FACTORS, CARD_TYPES, CAPABILITY_FLAGS } from "./canvas.js";
export type {
  FormFactor,
  CardType,
  CapabilityFlag,
  CardInstance,
  TabDef,
  ThemeOverride,
  CanvasDef,
} from "./canvas.js";
export { CARD_CONTRACTS, SALE_CRITICAL_CARDS, GRID_MAX_COLUMNS } from "./card-contract.js";
export type { CardContract } from "./card-contract.js";
// MAX_TAB_TITLE_LENGTH / validateCanvas are already re-exported above.
export { validateThemeOverride, THEMEABLE_TOKENS, MAX_THEME_VALUE_LENGTH } from "./theme.js";
export { DEFAULT_CANVASES } from "./default-canvases.js";
export {
  listCanvases,
  getCanvas,
  createCanvas,
  updateCanvas,
  deleteCanvas,
  getCanvasForFormFactor,
} from "./canvas-store.js";
export { getTenantTheme, putTenantTheme } from "./theme-store.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts (and
// guarded tree-wide by scripts/errors-reachable.test.ts).
import "./errors.js";
