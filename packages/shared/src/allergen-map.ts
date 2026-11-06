type AllergenKind =
  | "wheat"
  | "rye"
  | "barley"
  | "oats"
  | "spelt"
  | "kamut"
  | "almonds"
  | "hazelnuts"
  | "walnuts"
  | "cashews"
  | "pecans"
  | "brazil_nuts"
  | "pistachios"
  | "macadamia";
export type AllergenMap = Record<string, { kinds?: AllergenKind[] }>;
