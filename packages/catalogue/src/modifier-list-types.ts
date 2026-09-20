/**
 * The extras-list and options-list wire shapes — the JSON the two
 * `/management-api/modifiers/{options,extras}` surfaces hand across the HTTP boundary, so the
 * dashboard (and any browser client) can import ONE authoritative copy instead of re-declaring them
 * by hand. This is a LEAF: type definitions only, no running code. The guard is
 * `scripts/dashboard-browser-purity.test.ts`, which reads the file as TEXT and enforces TYPE-ONLY —
 * an `import type` line would pass it. That the file imports nothing AT ALL is a separate and
 * unguarded fact, true today because every shape below is built from primitives.
 *
 * The file exists because the operational homes are not browser-safe: `option-contract.ts` and
 * `extra-contract.ts` import `AppError` and `decimal` from `@waitron/shared` and the `errors.ts`
 * registry for their side effect, and `options.ts` / `extras.ts` import `@waitron/db` and drizzle.
 * Each of those four re-exports the types it used to declare, so imports elsewhere are unchanged.
 * Same split `product-types.ts` takes, for the same reason.
 */

/**
 * A label and its list each carry the same three names as a product: plain staff `name`, a translated
 * `customerName` map, and a plain `kitchenName`. A null customer or kitchen name falls back to
 * `name`; only `name` is required.
 */
export interface OptionLabel {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  available: boolean;
}

/** A reusable list of labels the diner picks exactly one of. It owns no price, VAT or allergens. */
export interface OptionList {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  /** A label of THIS list, preselected when the list is asked; null when nothing is preselected. */
  defaultLabelId: string | null;
  active: boolean;
  /** Presentation order: the caller writes each label's `sort` from its position here. */
  labels: OptionLabel[];
}

export type OptionLabelInput = Omit<OptionLabel, "id"> & { id?: string };
export type OptionListInput = Omit<OptionList, "id" | "labels"> & { labels: OptionLabelInput[] };

/**
 * One product a list offers. The row holds nothing that duplicates the product: its three names,
 * VAT class, allergens, dietary labels and photo all come from the `products` row it names, so this
 * carries only the terms of the OFFER — how many the diner may take, whether it starts picked, and a
 * price that overrides the product's own.
 */
export interface ExtraListItem {
  id: string;
  productId: string;
  /** Per-dish cap for this product; at least 1, where 1 means "one or none". */
  maxQuantity: number;
  preselected: boolean;
  /** null means "charge the product's own `unitPrice`" — see `resolveExtraPrice` in extras.ts. */
  price: string | null;
}

/**
 * A reusable, named list of products the diner may add to a dish. `minPicks` 0 makes the list
 * optional and 1 or more makes it required; `maxPicks` null leaves it uncapped.
 */
export interface ExtraList {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  minPicks: number;
  maxPicks: number | null;
  active: boolean;
  /** Presentation order: the caller writes each item's `sort` from its position here. */
  items: ExtraListItem[];
}

export type ExtraListItemInput = Omit<ExtraListItem, "id"> & { id?: string };
export type ExtraListInput = Omit<ExtraList, "id" | "items"> & { items: ExtraListItemInput[] };

/** What deleting an options list would touch — see `optionListDependants` (options.ts). */
export interface OptionListDependants {
  products: { id: string; name: string }[];
  menus: { id: string; name: string }[];
}

/** What deleting an extras list would touch — see `extraListDependants` (extras.ts). */
export interface ExtraListDependants {
  products: { id: string; name: string }[];
  menus: { id: string; name: string }[];
}
