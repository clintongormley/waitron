import { formatDecimalInput } from "@waitron/ui";
import { currentLocale } from "./i18n/t.js";

export const quantity = (value: string) =>
  formatDecimalInput(value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""), currentLocale());
