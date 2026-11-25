import type { OptionSnapshot } from "@waitron/shared";

export interface MadeHereExtra {
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  soldInEach: boolean;
  perDish: number;
}

export interface MadeHereItem {
  lineId: string;
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  soldInEach: boolean;
  optionSnapshots: OptionSnapshot[];
  extras: MadeHereExtra[];
  note: string | null;
}
