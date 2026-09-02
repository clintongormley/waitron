import type { Permission } from "@waitron/identity";
import type { CapabilityFlag, CardType } from "./profile.js";
import type { ConfigValidator, WidgetConfigSchema } from "./widget-config.js";

/** The widest grid a tab may declare (design §4.1). A tab's `columns` is validated into 1..this. */
export const GRID_MAX_COLUMNS = 24;

function intInRange(min: number, max: number): ConfigValidator {
  return (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * What one card kind declares to the system (design §4.2): its config schema, the person-role
 * PERMISSION its sensitive action needs (drives the in-card locked state — §5), the device CAPABILITY
 * it requires to be available at all (drives structural absence — §6 axis 1), the runtime visibility
 * STATES an author may gate rendering on (§6 axis 3), its default grid span, and whether it is
 * sale-critical (§13 — a selling profile must place it).
 */
export interface CardContract {
  configSchema: WidgetConfigSchema;
  requiredPermission?: Permission;
  requiredCapability?: CapabilityFlag;
  visibilityStates: readonly string[];
  defaultColSpan: number;
  defaultRowSpan: number;
  saleCritical: boolean;
}

/**
 * The per-card contract registry — the ONE tested place defining every card kind's contract. The
 * `Record<CardType, …>` type makes forgetting a card a compile error. Config validators reuse the
 * fail-closed `ConfigValidator` shape from widget-config.ts. `visibilityStates` list the states a card
 * exposes; an author's `visibleWhen` must be a subset (validated in Task 6).
 */
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
    requiredPermission: "till.configure",
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

/** The sale-critical cards, derived from the contract so it can never drift from `saleCritical`. */
export const SALE_CRITICAL_CARDS: readonly CardType[] = (
  Object.keys(CARD_CONTRACTS) as CardType[]
).filter((t) => CARD_CONTRACTS[t].saleCritical);
