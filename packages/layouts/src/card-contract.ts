import type { Permission } from "@waitron/identity";
import type { CapabilityFlag, CardType } from "./canvas.js";
import type { ConfigValidator, WidgetConfigSchema } from "./widget-config.js";

export const GRID_MAX_COLUMNS = 24;

function intInRange(min: number, max: number): ConfigValidator {
  return (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export interface CardContract {
  configSchema: WidgetConfigSchema;
  requiredPermission?: Permission;
  requiredCapability?: CapabilityFlag;
  visibilityStates: readonly string[];
  defaultColSpan: number;
  defaultRowSpan: number;
  saleCritical: boolean;
}

export const CARD_CONTRACTS: Record<CardType, CardContract> = {
  "product-grid": {
    configSchema: { columns: intInRange(1, 12) },
    visibilityStates: [],
    defaultColSpan: 8,
    defaultRowSpan: 6,
    saleCritical: true,
  },
  basket: {
    configSchema: {},
    visibilityStates: [],
    defaultColSpan: 4,
    defaultRowSpan: 4,
    saleCritical: true,
  },
  total: {
    configSchema: {},
    visibilityStates: [],
    defaultColSpan: 4,
    defaultRowSpan: 1,
    saleCritical: true,
  },
  "tender-pay": {
    configSchema: {},
    requiredCapability: "integrated-card-payment",
    visibilityStates: [],
    defaultColSpan: 4,
    defaultRowSpan: 2,
    saleCritical: true,
  },
  "held-orders": {
    configSchema: {},
    visibilityStates: ["has-parked", "empty"],
    defaultColSpan: 4,
    defaultRowSpan: 2,
    saleCritical: false,
  },
  "prep-queue": {
    configSchema: {},
    visibilityStates: ["has-items", "empty"],
    defaultColSpan: 4,
    defaultRowSpan: 2,
    saleCritical: false,
  },
  notifications: {
    configSchema: {},
    visibilityStates: ["unread", "any", "empty"],
    defaultColSpan: 4,
    defaultRowSpan: 1,
    saleCritical: false,
  },
  "floor-plan": {
    configSchema: {},
    visibilityStates: [],
    defaultColSpan: GRID_MAX_COLUMNS,
    defaultRowSpan: 12,
    saleCritical: false,
  },
  "table-layout-editor": {
    configSchema: {},
    requiredPermission: "venue.configure",
    visibilityStates: [],
    defaultColSpan: GRID_MAX_COLUMNS,
    defaultRowSpan: 12,
    saleCritical: false,
  },
  "kds-board": {
    configSchema: {},
    requiredCapability: "act-as-kds",
    visibilityStates: ["has-tickets", "idle"],
    defaultColSpan: GRID_MAX_COLUMNS,
    defaultRowSpan: 12,
    saleCritical: false,
  },
  expo: {
    configSchema: {},
    visibilityStates: ["has-tickets", "idle"],
    defaultColSpan: GRID_MAX_COLUMNS,
    defaultRowSpan: 12,
    saleCritical: false,
  },
  "table-order": {
    configSchema: {},
    visibilityStates: [],
    defaultColSpan: GRID_MAX_COLUMNS,
    defaultRowSpan: 12,
    saleCritical: false,
  },
};

export const SALE_CRITICAL_CARDS: readonly CardType[] = (
  Object.keys(CARD_CONTRACTS) as CardType[]
).filter((t) => CARD_CONTRACTS[t].saleCritical);
