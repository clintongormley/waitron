export type StaffText = Readonly<Record<"en" | "es", string>>;

export type DemoText<L extends string> = Readonly<Record<"en" | "es", string> & Record<L, string>>;

interface CountryDemoProductFields<L extends string = string> {
  customerName: DemoText<L>;
  staffName?: string;
  description?: DemoText<L>;
  kitchenName?: string;
  dietaryDeclarations?: string[];
  unit?: {
    staffName: string;
    staffAbbreviation: string;
    name: DemoText<L>;
    precision: number;
    abbreviation: DemoText<L>;
  };
  variants?: {
    customerName: DemoText<L>;
    staffName?: string;
    kitchenName?: string;

    unitPrice: string | null;
    available: boolean;
  }[];
  pricingUnit: string;

  unitPrice: string;
  vatClass: string;

  image: string;
}

interface CountryDemoCategoryFields<L extends string = string> {
  name: DemoText<L>;

  categoryName?: string;
  color: string;
  station: "kitchen" | "bar" | "deli" | null;
  products: CountryDemoProduct<L>[];
}

interface CountryDemoCatalogueFields<L extends string = string> {
  name: StaffText;
  customerName: DemoText<L>;
  categories: CountryDemoCategory<L>[];
}

interface CountryDemoOptionLabelFields<L extends string = string> {
  name: string;
  customerName: DemoText<L>;
  kitchenName: string;

  preselected?: boolean;
}

interface CountryDemoOptionListFields<L extends string = string> {
  name: string;
  customerName: DemoText<L>;
  kitchenName: string;
  labels: CountryDemoOptionLabel<L>[];
}

interface CountryDemoProductOptionListsFields<L extends string = string> {
  productImage: string;
  lists: CountryDemoOptionList<L>[];
}

interface CountryDemoProductExtraListsFields<L extends string = string> {
  productImage: string;
  lists: {
    name: string;
    customerName: DemoText<L>;
    kitchenName: string;
    minPicks: number;
    maxPicks: number;
    items: { productImage: string; price: string; portion: string; maxQuantity: number }[];
  }[];
}

interface CountryDemoDataFields<L extends string = string> {
  readonly id: string;
  readonly mediaDataSet: string;
  readonly stations: { kitchen: string; downstairsBar: string; upstairsBar: string; deli: string };
  readonly printerName: string;
  readonly specialDayName: string;
  readonly menuPeriodName: string;
  readonly menuPriceOverrides: readonly {
    menu: "drinks" | "lunch";
    productImage: string;
    grossPrice: string;
  }[];

  readonly contentLanguages: readonly L[];
  readonly menus: {
    readonly restaurant: CountryDemoCatalogue<L>;
    readonly deli: CountryDemoCatalogue<L>;
    readonly lunch: CountryDemoCatalogue<L>;
    readonly drinksName: StaffText;
    readonly drinksCustomerName: DemoText<L>;
  };
  readonly productOptionLists: readonly CountryDemoProductOptionLists<L>[];
  readonly productExtraLists: readonly CountryDemoProductExtraLists<L>[];
  readonly floor: {
    readonly setName: StaffText;
    readonly zones: readonly CountryDemoZone[];
    readonly tables: readonly CountryDemoRawTable[];
    readonly departmentNames: { readonly restaurant: StaffText; readonly deli: StaffText };
    readonly upstairsBarZone: StaffText;
    readonly deliCounterZone: StaffText;
  };
  readonly staff: readonly CountryDemoPerson[];
  readonly adjustmentReasons: readonly CountryDemoReason<L>[];
}

export type CountryDemoProduct<L extends string = string> = ReadonlyDemo<
  CountryDemoProductFields<L>
>;

export type CountryDemoCategory<L extends string = string> = ReadonlyDemo<
  CountryDemoCategoryFields<L>
>;

export type CountryDemoCatalogue<L extends string = string> = ReadonlyDemo<
  CountryDemoCatalogueFields<L>
>;

export type CountryDemoOptionLabel<L extends string = string> = ReadonlyDemo<
  CountryDemoOptionLabelFields<L>
>;

export type CountryDemoOptionList<L extends string = string> = ReadonlyDemo<
  CountryDemoOptionListFields<L>
>;

export type CountryDemoProductOptionLists<L extends string = string> = ReadonlyDemo<
  CountryDemoProductOptionListsFields<L>
>;

export type CountryDemoProductExtraLists<L extends string = string> = ReadonlyDemo<
  CountryDemoProductExtraListsFields<L>
>;

type ReadonlyDemo<T> = T extends object ? { readonly [K in keyof T]: ReadonlyDemo<T[K]> } : T;
export type CountryDemoData<L extends string = string> = ReadonlyDemo<CountryDemoDataFields<L>>;
export interface CountryDemoZone {
  readonly key: string;
  readonly name: StaffText;
  readonly displayOrder: number;
}
export interface CountryDemoRawTable {
  readonly label: string;
  readonly zoneKey: string;
  readonly capacity: number;
  readonly posX: number;
  readonly posY: number;
  readonly shape: string;
  readonly rotation: number;
}
export interface CountryDemoPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly shape: string;
  readonly rotation: number;
}
export interface CountryDemoPerson {
  readonly displayName: string;
  readonly role: string;
  readonly email: string;
  readonly dashboardLogin: boolean;
}
export interface CountryDemoReason<L extends string = string> {
  readonly names: DemoText<L>;
  readonly kind: string;
  readonly actions: readonly string[];
  readonly maxPercentBp: number | null;
  readonly maxAmount: string | null;
  readonly applyRoles: readonly string[];
  readonly approverRoles: readonly string[];
  readonly noteRequired: boolean;
}
export interface CountryDemoDeveloperPreset {
  readonly country: string;
  readonly dataSet: string;
  readonly locationName: string;
  readonly postalCode: string;
  readonly city: string;
  readonly province: string;
  readonly timeZone: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly dayCutover: string;
  readonly receiptLocale?: string;
}
