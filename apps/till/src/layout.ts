/**
 * LOCAL copies of `@waitron/layouts` shapes (`packages/layouts/src/canvas.ts`, `types.ts`), not
 * imported for the bundle reason `api/client.ts` states. Keep in sync with those files.
 */

/**
 * The NON-FISCAL receipt trim, rendered around the mandated core of `till-ticket-view`: no field here
 * may suppress or reorder a mandated element.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
}

export type FormFactor = "till" | "phone-portrait" | "tablet-landscape" | "kds";

/** An unknown form factor returns `undefined`, which boot treats as a normal operator till. */
export type DeviceKind = "kds_station" | "handheld" | "till";
export function kindOfFormFactor(ff: string): DeviceKind | undefined {
  switch (ff) {
    case "till":
      return "till";
    case "phone-portrait":
    case "tablet-landscape":
      return "handheld";
    case "kds":
      return "kds_station";
    default:
      return undefined;
  }
}

export type CapabilityFlag =
  "integrated-card-payment" | "open-cash-drawer" | "act-as-kds" | "print-receipt";

export type CardType =
  | "product-grid"
  | "basket"
  | "total"
  | "tender-pay"
  | "held-orders"
  | "prep-queue"
  | "notifications"
  | "floor-plan"
  | "table-layout-editor"
  | "kds-board"
  | "expo"
  | "table-order";

export interface CardInstance {
  type: CardType;
  colSpan: number;
  rowSpan: number;
  config: Record<string, unknown>;
  visibleWhen?: string[];
}

export interface TabDef {
  key: string;
  title: string;
  columns: number;
  cards: CardInstance[];
}

export interface ThemeOverride {
  tokens: Record<string, string>;
}

export interface CanvasDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  theme?: ThemeOverride;
}

// Mirrors the capability and permission axes of `CARD_CONTRACTS`
// (`packages/layouts/src/card-contract.ts`). `tender-pay` still renders without its capability, because
// it takes cash (`widgets/card-grid.ts`).
export const CARD_REQUIRED_CAPABILITY: Partial<Record<CardType, CapabilityFlag>> = {
  "tender-pay": "integrated-card-payment",
  "kds-board": "act-as-kds",
};

export const CARD_REQUIRED_PERMISSION: Partial<Record<CardType, string>> = {
  "table-layout-editor": "venue.configure",
};
