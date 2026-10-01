import type { Decimal } from "@waitron/shared";
/** A menu source wraps the included menu's source, preserving each step of inheritance. */
export type ValueSource =
  | { kind: "own" }
  | { kind: "product" }
  | { kind: "parent" }
  | { kind: "menu"; menuId: string; menuName: string; from: ValueSource };
export type Place = { kind: "own_sections" } | { kind: "menu"; menuId: string; menuName: string };
export type Candidate<T> =
  { place: Place; value: T; source: ValueSource } | { place: Place; undecided: true };
export type Setting<T> =
  | { state: "decided"; value: T; source: ValueSource; otherwise: Setting<T> | null }
  | { state: "clash"; candidates: Candidate<T>[] };
export interface CombinedOffer {
  productId: string;
  offered: Setting<boolean>;
  price: Setting<Decimal>;
  variants: {
    variantId: string;
    offered: Setting<boolean>;
    price: Setting<Decimal> & { level: "size" | "product" };
  }[];
}
export interface CombineInput {
  productId: string;
  catalogue: { price: Decimal; variants: { variantId: string; price: Decimal | null }[] };
  own: {
    price: Decimal | null;
    offered: boolean | null;
    variants: { variantId: string; price: Decimal | null; offered: boolean | null }[];
  };
  placedInOwnSections: boolean;
  included: { menuId: string; menuName: string; offer: CombinedOffer }[];
}
export interface MenuClash {
  productId: string;
  variantId: string | null;
  field: "price" | "offered";
  candidates: Candidate<Decimal | boolean>[];
}
