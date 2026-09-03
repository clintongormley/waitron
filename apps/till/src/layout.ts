/**
 * The counter screen's LAYOUT DEFINITION — the configurable-dashboard seam (spec §3).
 *
 * A layout is plain DATA: an ordered list of widget instances, each naming its widget `type`, the
 * `region` it sits in (`"main"` or `"aside"`), and a per-widget `config` bag. `till-counter-screen`
 * renders a layout by ITERATING it and mapping each `type` to its element — so the arrangement is
 * data, not code. That is what lets a later slice's drag/drop editor and per-widget config plug in
 * HERE, by producing a different `LayoutDef`, without the screen changing. Slice 1 ships exactly one
 * fixed layout, {@link LAYOUT_A}; keep this module plain data (no Lit, no elements) so it stays the
 * seam and not a second place the widgets are wired.
 */

/** The widgets the counter can place. Each maps to one custom element in the screen's registry. */
export type WidgetType =
  "product-grid" | "basket" | "total" | "tender-pay" | "held-orders" | "prep-queue";

/** One placed widget: which widget, which region it sits in, and its (slice-1-empty) config bag. */
export interface WidgetInstance {
  type: WidgetType;
  region: "main" | "aside";
  config: Record<string, unknown>;
}

/** A whole layout: the ordered widget instances the screen renders, in order, into their regions. */
export type LayoutDef = WidgetInstance[];

/**
 * The authorable, NON-FISCAL receipt trim (design §7/§8): a `headerSubtitle` rendered under the venue
 * name and a `footerMessage` under the VERI*FACTU legend, both optional. It renders AROUND the
 * immutable art. 7.1 core of `till-ticket-view`, never able to touch it — no field here can suppress
 * or reorder a mandated element. A LOCAL copy of the server's `ReceiptConfig`
 * (`packages/layouts/src/types.ts`), bundle-decoupled exactly like {@link LayoutDef} — deliberately
 * NOT imported from `@waitron/layouts`, same rule as every server shape in `api/client.ts`.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
}

/**
 * Layout A — the walk-up-sale arrangement slice 1 ships: the product grid fills `main` (the left),
 * with the basket, total, pay flow, the held-orders list and the prep queue stacked in `aside` (the
 * right). The held-orders list sits at the foot of the sale flow (basket → total → pay), with the
 * cross-till parked orders below it; the prep queue (7c prepare & collect) sits below that — the
 * kitchen-facing view is the last thing in the stack, after every order-taking control.
 */
export const LAYOUT_A: LayoutDef = [
  { type: "product-grid", region: "main", config: {} },
  { type: "basket", region: "aside", config: {} },
  { type: "total", region: "aside", config: {} },
  { type: "tender-pay", region: "aside", config: {} },
  { type: "held-orders", region: "aside", config: {} },
  { type: "prep-queue", region: "aside", config: {} },
];

// ---------------------------------------------------------------------------
// SP-B profile model — a LOCAL mirror of `@waitron/layouts` (`packages/layouts/src/profile.ts`),
// bundle-decoupled exactly like `LayoutDef`/`ReceiptConfig` above — deliberately NOT imported from
// `@waitron/layouts` (the bundle rule). The server validates every profile on write; the client
// trusts the shape it receives. Keep in sync with profile.ts if that model changes.
// ---------------------------------------------------------------------------

export type FormFactor = "till" | "phone-portrait" | "tablet-landscape" | "kds";

export type CapabilityFlag = "integrated-card-payment" | "open-cash-drawer" | "act-as-kds";

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

export interface ProfileDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  capabilities: CapabilityFlag[];
  theme?: ThemeOverride;
}
