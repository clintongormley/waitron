import type { SeedCatalogue, SeedLocale, SeedProductOptionLists } from "./menu.js";
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

/** What a demo seed writes from one data set; a pack names one by `id`. */
export interface DemoDataSet {
  readonly id: string;
  readonly menus: {
    readonly restaurant: SeedCatalogue;
    readonly deli: SeedCatalogue;
    readonly lunch: SeedCatalogue;
    readonly drinksName: StaffText;
  };
  readonly productOptionLists: readonly SeedProductOptionLists[];
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
  readonly adjustmentReasons: readonly SeedReason[];
}

export const DEMO_DATA_SETS: Readonly<Record<string, DemoDataSet>> = {
  [CASA_DELGADO_ES.id]: CASA_DELGADO_ES,
};

/** Throws for an id no data set has; `data-set.test.ts` holds that every pack's id resolves. */
export function demoDataSet(id: string): DemoDataSet {
  if (!Object.hasOwn(DEMO_DATA_SETS, id)) throw new Error(`demoDataSet: no demo data set "${id}"`);
  return DEMO_DATA_SETS[id]!;
}
