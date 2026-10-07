import type { DietaryLabel, PricingUnit, VatClass } from "@waitron/catalogue";
import {
  resolveInstalledStartingContentLanguages,
  type StartingContentLanguages,
  type VenueGeography,
} from "@waitron/country-packs";
import type { SeedLocale } from "./menu.js";
import type { SeedStatus, SeedTable, SeedZone } from "./floor.js";
import type { SeedPerson } from "./staff.js";
import type { SeedReason } from "./seed-adjustments.js";
import { CASA_DELGADO_ES } from "./data-sets/casa-delgado-es.js";

// In a module of its own: `seed-adjustments.ts` uses it, and `data-sets/casa-delgado-es.ts`, which
// this file imports, imports `seed-adjustments.ts`.
export { inLanguages } from "./in-languages.js";

/** The language staff-facing plain names are written in; the staff apps exist in these two. */
export type StaffLanguage = SeedLocale;
export type StaffText = Readonly<Record<StaffLanguage, string>>;

/** A customer-facing text in every language `L` of its data set. English and Spanish are always
 * among them, because the writers take staff names out of these maps by the seed's language, and
 * with no `noUncheckedIndexedAccess` a missing one would compile and store undefined. */
export type DemoText<L extends string> = Readonly<Record<L | SeedLocale, string>>;

/** Where `staffName` is given it DELIBERATELY differs from the customer-facing name, so a screen
 * showing the wrong one of the three names is visible; omitted, `seedCatalogues` falls back to the
 * seeded locale's customer-facing name. */
export interface SeedProduct<L extends string = string> {
  customerName: DemoText<L>;
  staffName?: string;
  description?: DemoText<L>;
  kitchenName?: string;
  dietaryDeclarations?: DietaryLabel[];
  unit?: {
    name: DemoText<L>;
    precision: number;
    abbreviation: DemoText<L>;
  };
  variants?: {
    customerName: DemoText<L>;
    staffName?: string;
    kitchenName?: string;
    /** The variant's own price, or null to sell at its parent's. */
    unitPrice: string | null;
    available: boolean;
  }[];
  pricingUnit: PricingUnit;
  /** GROSS (VAT-inclusive): per item for `each`, per kg for `weight`. A two-place decimal string;
   * `createProduct` converts it to a count of whole cents at the row. */
  unitPrice: string;
  vatClass: VatClass;
  /** The committed PNG basename under `media/`. */
  image: string;
}

export interface SeedCategory<L extends string = string> {
  /** The section's customer-facing name. */
  name: DemoText<L>;
  /** The reporting category's name, when it cannot be the English section name: categories with
   * one parent must not share a name, while two menus may each have a section called the same. */
  categoryName?: string;
  station: "kitchen" | "bar" | "deli" | null;
  products: SeedProduct<L>[];
}

export interface SeedCatalogue<L extends string = string> {
  /** The menu's staff name. */
  name: StaffText;
  customerName: DemoText<L>;
  categories: SeedCategory<L>[];
}

// Staff `name`, `customerName` and `kitchenName` are DIFFERENT text on every list and label, so a
// surface reading the wrong one of the three shows the wrong words (CLAUDE.md §3).

export interface SeedOptionLabel<L extends string = string> {
  name: string;
  customerName: DemoText<L>;
  kitchenName: string;
  /** Preselected when the list is asked; at most one label of a list carries it. */
  preselected?: boolean;
}

export interface SeedOptionList<L extends string = string> {
  name: string;
  customerName: DemoText<L>;
  kitchenName: string;
  labels: SeedOptionLabel<L>[];
}

export interface SeedProductOptionLists<L extends string = string> {
  productImage: string;
  lists: SeedOptionList<L>[];
}

/** What a demo seed writes from one data set; a pack names one by `id`. */
export interface DemoDataSet<L extends string = string> {
  readonly id: string;
  /** Every language this set has text in. */
  readonly contentLanguages: readonly L[];
  readonly menus: {
    readonly restaurant: SeedCatalogue<L>;
    readonly deli: SeedCatalogue<L>;
    readonly lunch: SeedCatalogue<L>;
    readonly drinksName: StaffText;
    readonly drinksCustomerName: DemoText<L>;
  };
  readonly productOptionLists: readonly SeedProductOptionLists<L>[];
  readonly floor: {
    readonly zones: readonly SeedZone[];
    readonly tables: readonly SeedTable[];
    readonly statuses: readonly SeedStatus[];
    readonly departmentNames: { readonly restaurant: StaffText; readonly deli: StaffText };
    readonly upstairsBarZone: StaffText;
    readonly deliCounterZone: StaffText;
  };
  readonly watcherName: StaffText;
  readonly staff: readonly SeedPerson[];
  readonly adjustmentReasons: readonly SeedReason<L>[];
}

export const DEMO_DATA_SETS: Readonly<Record<string, DemoDataSet>> = {
  [CASA_DELGADO_ES.id]: CASA_DELGADO_ES,
};

/** Throws for an id no data set has; `data-set.test.ts` holds that every pack's id resolves. */
export function demoDataSet(id: string): DemoDataSet {
  if (!Object.hasOwn(DEMO_DATA_SETS, id)) throw new Error(`demoDataSet: no demo data set "${id}"`);
  return DEMO_DATA_SETS[id]!;
}

/** The demo's content languages; `required` is for `writeContentLanguages`' check. */
export type DemoLanguages = StartingContentLanguages;

/** Exactly the languages setup gives a new venue in this area. */
export function demoContentLanguages(geography: VenueGeography): DemoLanguages {
  return resolveInstalledStartingContentLanguages(geography);
}
