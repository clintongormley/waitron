import type { VatClass } from "./vat-rates.js";

export type MenuKind = "menu" | "set_menu";

export interface SetMenuLine {
  id: string;
  count: number;
  /** Active courses, in course display order. */
  courseIds: string[];
}

export type SetMenuProblem =
  | { kind: "no_dishes" }
  | { kind: "no_lines" }
  | { kind: "line_without_course"; lineId: string }
  | { kind: "line_unfillable"; lineId: string }
  | { kind: "dish_without_course"; productId: string; name: string; parentName: string | null }
  | {
      kind: "dish_not_included";
      productId: string;
      name: string;
      parentName: string | null;
      courseId: string;
      courseName: string;
    }
  | { kind: "dish_sold_by_measure"; productId: string; name: string };

export interface SetMenuTerms {
  /** Gross price per set menu, as a two-place decimal string. */
  price: string;
  vatClass: VatClass;
  takeawayVatClass: VatClass;
  /** Customer-facing names by language, frozen at publish for receipts. */
  names: Record<string, string>;
  lines: SetMenuLine[];
}
