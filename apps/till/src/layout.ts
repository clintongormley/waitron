/**
 * The till's LOCAL data mirrors of the server's layout shapes — plain data (no Lit, no elements),
 * browser-safe and bundle-decoupled: deliberately NOT imported from `@waitron/layouts` (the bundle
 * rule, same as every server shape in `api/client.ts`). The server validates every canvas/receipt on
 * write; the client trusts the shape it receives. Keep in sync with the source if those models change.
 *
 * Two things live here: the NON-FISCAL {@link ReceiptConfig} trim, and the SP-B canvas model (a mirror
 * of `packages/layouts/src/canvas.ts`). The old region/widget layout model was removed in SP-B4 — the
 * counter renders solely from the canvas's `counter` tab now.
 */

/**
 * The authorable, NON-FISCAL receipt trim (design §7/§8): a `headerSubtitle` rendered under the venue
 * name and a `footerMessage` under the VERI*FACTU legend, both optional. It renders AROUND the
 * immutable art. 7.1 core of `till-ticket-view`, never able to touch it — no field here can suppress
 * or reorder a mandated element. A LOCAL copy of the server's `ReceiptConfig`
 * (`packages/layouts/src/types.ts`), bundle-decoupled — deliberately NOT imported from
 * `@waitron/layouts`, same rule as every server shape in `api/client.ts`.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
}

// ---------------------------------------------------------------------------
// SP-B canvas model — a LOCAL mirror of `@waitron/layouts` (`packages/layouts/src/canvas.ts`),
// bundle-decoupled exactly like `ReceiptConfig` above — deliberately NOT imported from
// `@waitron/layouts` (the bundle rule). The server validates every canvas on write; the client
// trusts the shape it receives. Keep in sync with canvas.ts if that model changes.
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

export interface CanvasDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  capabilities: CapabilityFlag[];
  theme?: ThemeOverride;
}

// Minimal mirror of the per-card contract axes the till needs to GATE the view (SP-B2). The server
// validates every canvas on write via `validateCanvas` (`packages/layouts/src/validate-canvas.ts`),
// which enforces the per-card `CARD_CONTRACTS` in `packages/layouts/src/card-contract.ts`; the client
// only needs the required-capability / required-permission per card to hide/lock a cell. Keep in sync with
// CARD_CONTRACTS if a card's contract changes. `tender-pay`'s capability is deliberately NOT enforced
// as an absence (it takes cash) — see the always-render carve-out in card-grid.ts.
export const CARD_REQUIRED_CAPABILITY: Partial<Record<CardType, CapabilityFlag>> = {
  "tender-pay": "integrated-card-payment",
  "kds-board": "act-as-kds",
};

export const CARD_REQUIRED_PERMISSION: Partial<Record<CardType, string>> = {
  "table-layout-editor": "till.configure",
};
