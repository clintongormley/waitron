import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { resolveCountryDemoIdentity } from "@waitron/country";
import type { DietaryLabel, PricingUnit, VatClass } from "@waitron/catalogue";
import type { PersonRoleValue } from "@waitron/identity";
import type { AdjustmentReasonInput } from "@waitron/adjustments";
import type {
  DemoPlainText,
  CountryDemoIdentity,
  CountryDemoData,
  CountryDemoProduct,
  CountryDemoCategory,
  CountryDemoCatalogue,
  CountryDemoReason,
  CountryDemoPerson,
  CountryDemoProductOptionLists,
  CountryDemoProductExtraLists,
} from "@waitron/country";
import {
  DEMO_DATA_SETS as COUNTRY_DEMO_DATA_SETS,
  DEFAULT_DEMO_DATA_SET_ID,
} from "@waitron/country-packs/demo";
import {
  getCountryPack,
  resolveInstalledDemoIdentity,
  resolveInstalledStartingContentLanguages,
  type StartingContentLanguages,
  type VenueGeography,
} from "@waitron/country-packs";
import { decimal } from "@waitron/shared";
import { onGrid, type SeedRawTable, type SeedTable, type SeedZone } from "./floor.js";
import type { SeedReason } from "./seed-adjustments.js";
import type { SeedLocale } from "./locale.js";
export { inLanguages } from "./in-languages.js";
export type { DemoText, DemoPlainText } from "@waitron/country";
export type StaffLanguage = SeedLocale;
export type StaffText = Readonly<Record<StaffLanguage, string>>;
export type SeedProduct<L extends string = string> = Omit<
  CountryDemoProduct<L>,
  "dietaryDeclarations" | "pricingUnit" | "vatClass"
> & {
  readonly dietaryDeclarations?: readonly DietaryLabel[];
  readonly pricingUnit: PricingUnit;
  readonly vatClass: VatClass;
};
export type SeedCategory<L extends string = string> = Omit<
  CountryDemoCategory<L>,
  "station" | "products"
> & {
  readonly station: "kitchen" | "bar" | "deli" | null;
  readonly products: readonly SeedProduct<L>[];
};
export type SeedCatalogue<L extends string = string> = Omit<
  CountryDemoCatalogue<L>,
  "categories"
> & { readonly categories: readonly SeedCategory<L>[] };
export type SeedProductOptionLists<L extends string = string> = CountryDemoProductOptionLists<L>;
export type SeedProductExtraLists<L extends string = string> = CountryDemoProductExtraLists<L>;
export type SeedPerson = Omit<CountryDemoPerson, "role"> & { readonly role: PersonRoleValue };
type RawReason<L extends string = string> = Omit<
  CountryDemoReason<L>,
  "kind" | "actions" | "applyRoles" | "approverRoles"
> & {
  readonly kind: AdjustmentReasonInput["kind"];
  readonly actions: readonly AdjustmentReasonInput["actions"][number][];
  readonly applyRoles: readonly AdjustmentReasonInput["applyRoles"][number][];
  readonly approverRoles: readonly AdjustmentReasonInput["approverRoles"][number][];
};
export type StrictCountryDemoData<L extends string = string> = Omit<
  CountryDemoData<L>,
  "menus" | "floor" | "staff" | "adjustmentReasons"
> & {
  readonly menus: {
    readonly restaurant: SeedCatalogue<L>;
    readonly deli: SeedCatalogue<L>;
    readonly lunch: SeedCatalogue<L>;
    readonly drinksName: StaffText;
    readonly drinksCustomerName: CountryDemoData<L>["menus"]["drinksCustomerName"];
  };
  readonly floor: Omit<CountryDemoData<L>["floor"], "zones" | "tables"> & {
    readonly zones: readonly SeedZone[];
    readonly tables: readonly SeedRawTable[];
  };
  readonly staff: readonly SeedPerson[];
  readonly adjustmentReasons: readonly RawReason<L>[];
};
export type DemoDataSet<L extends string = string> = Omit<
  StrictCountryDemoData<L>,
  "floor" | "adjustmentReasons"
> & {
  readonly floor: Omit<StrictCountryDemoData<L>["floor"], "tables"> & {
    readonly tables: readonly SeedTable[];
  };
  readonly adjustmentReasons: readonly SeedReason<L>[];
};
const strictRegistry: Readonly<Record<string, StrictCountryDemoData>> = COUNTRY_DEMO_DATA_SETS;
function adapt(set: StrictCountryDemoData): DemoDataSet {
  return {
    ...set,
    floor: { ...set.floor, tables: set.floor.tables.map(onGrid) },
    adjustmentReasons: set.adjustmentReasons.map((reason) => ({
      ...reason,
      maxAmount: reason.maxAmount === null ? null : decimal(reason.maxAmount),
      actions: [...reason.actions],
      applyRoles: [...reason.applyRoles],
      approverRoles: [...reason.approverRoles],
    })),
  };
}
export const DEMO_DATA_SETS: Readonly<Record<string, DemoDataSet>> = Object.fromEntries(
  Object.entries(strictRegistry).map(([id, set]) => [id, adapt(set)]),
);
/** Throws for an id no data set has; `data-set.test.ts` holds that every pack's id resolves. */
export function demoDataSet(id: string): DemoDataSet {
  if (!Object.hasOwn(DEMO_DATA_SETS, id)) throw new Error(`demoDataSet: no demo data set "${id}"`);
  return DEMO_DATA_SETS[id]!;
}

export type DemoLanguages = StartingContentLanguages;

/** Exactly the languages setup gives a new venue in this area. */
export function demoContentLanguages(geography: VenueGeography): DemoLanguages {
  return resolveInstalledStartingContentLanguages(geography);
}

export function demoDataSetFor(identity: CountryDemoIdentity): DemoDataSet {
  return demoDataSet(identity.dataSet ?? DEFAULT_DEMO_DATA_SET_ID);
}

/** A fallback demo defaults to English, by the owner's decision for a country with no demo data of
 * its own; the area's required languages stay on because `writeContentLanguages` refuses a list
 * without them. */
function englishFallbackLanguages(starting: StartingContentLanguages): DemoLanguages {
  const { required } = starting;
  return {
    defaultLanguage: "en",
    languages: ["en", ...required.filter((language) => language !== "en")],
    required,
  };
}

export function demoLanguagesFor(set: DemoDataSet, geography: VenueGeography): DemoLanguages {
  const starting = demoContentLanguages(geography);
  const ownsSet =
    resolveInstalledDemoIdentity(geography)?.dataSet === set.id ||
    getCountryPack(geography.country ?? "")?.demo?.dataSet === set.id;
  return ownsSet ? starting : englishFallbackLanguages(starting);
}

export function demoPlainText(
  text: DemoPlainText,
  set: DemoDataSet,
  locale: StaffLanguage,
): string {
  const language = set.plainNameLanguage ?? locale;
  const value = text[language];
  if (value === undefined) throw new Error(`demoPlainText: missing ${language} text`);
  return value;
}

export async function readDemoSeedSelection(
  db: Database,
  locationId: string,
): Promise<{ identity: CountryDemoIdentity; dataSet: DemoDataSet }> {
  const { rows } = await db.execute<{ country: string; province: string | null }>(
    sql`select t.country, l.province from tenants t cross join locations l where l.id = ${locationId}`,
  );
  const geography = rows[0];
  const pack = geography === undefined ? undefined : getCountryPack(geography.country);
  const identity =
    pack === undefined ? undefined : resolveCountryDemoIdentity(pack, geography?.province);
  if (identity === undefined)
    throw new Error(
      `readDemoSeedSelection: no demo identity for ${geography?.country ?? "missing location"}`,
    );
  return { identity, dataSet: demoDataSetFor(identity) };
}
