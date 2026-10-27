export type DemoPlainText<L extends string = string> = Readonly<
  Record<"en" | "es", string> & Partial<Record<L, string>>
>;

export type StaffText = Readonly<Record<"en" | "es", string>>;

export type DemoText<L extends string> = Readonly<Record<"en" | "es", string> & Record<L, string>>;

interface CountryDemoProductFields<L extends string = string> {
  customerName: DemoText<L>;
  staffName?: DemoPlainText<L>;
  description?: DemoText<L>;
  kitchenName?: DemoPlainText<L>;
  dietaryDeclarations?: string[];
  unit?: {
    staffName: DemoPlainText<L>;
    staffAbbreviation: DemoPlainText<L>;
    name: DemoText<L>;
    precision: number;
    abbreviation: DemoText<L>;
  };
  variants?: {
    customerName: DemoText<L>;
    staffName?: DemoPlainText<L>;
    kitchenName?: DemoPlainText<L>;

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

  categoryName?: DemoPlainText<L>;
  color: string;
  station: "kitchen" | "bar" | "deli" | null;
  products: CountryDemoProduct<L>[];
}

interface CountryDemoCatalogueFields<L extends string = string> {
  name: DemoPlainText<L>;
  customerName: DemoText<L>;
  categories: CountryDemoCategory<L>[];
}

interface CountryDemoOptionLabelFields<L extends string = string> {
  name: DemoPlainText<L>;
  customerName: DemoText<L>;
  kitchenName: DemoPlainText<L>;

  preselected?: boolean;
}

interface CountryDemoOptionListFields<L extends string = string> {
  name: DemoPlainText<L>;
  customerName: DemoText<L>;
  kitchenName: DemoPlainText<L>;
  labels: CountryDemoOptionLabel<L>[];
}

interface CountryDemoProductOptionListsFields<L extends string = string> {
  productImage: string;
  lists: CountryDemoOptionList<L>[];
}

interface CountryDemoProductExtraListsFields<L extends string = string> {
  productImage: string;
  lists: {
    name: DemoPlainText<L>;
    customerName: DemoText<L>;
    kitchenName: DemoPlainText<L>;
    minPicks: number;
    maxPicks: number;
    items: { productImage: string; price: string; portion: string; maxQuantity: number }[];
  }[];
}

interface CountryDemoDataFields<L extends string = string> {
  readonly id: string;
  readonly mediaDataSet: string;
  readonly stations: {
    kitchen: DemoPlainText<L>;
    downstairsBar: DemoPlainText<L>;
    upstairsBar: DemoPlainText<L>;
    deli: DemoPlainText<L>;
  };
  readonly printerName: DemoPlainText<L>;
  readonly specialDayName: DemoPlainText<L>;
  readonly menuPeriodName: DemoPlainText<L>;
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
    readonly drinksName: DemoPlainText<L>;
    readonly drinksCustomerName: DemoText<L>;
  };
  readonly productOptionLists: readonly CountryDemoProductOptionLists<L>[];
  readonly productExtraLists: readonly CountryDemoProductExtraLists<L>[];
  readonly floor: {
    readonly setName: DemoPlainText<L>;
    readonly zones: readonly CountryDemoZone[];
    readonly tables: readonly CountryDemoRawTable[];
    readonly departmentNames: {
      readonly restaurant: DemoPlainText<L>;
      readonly deli: DemoPlainText<L>;
    };
    readonly upstairsBarZone: DemoPlainText<L>;
    readonly deliCounterZone: DemoPlainText<L>;
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
  readonly name: DemoPlainText;
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
