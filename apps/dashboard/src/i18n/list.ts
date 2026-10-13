import { conjunctionList as listIn } from "@waitron/shared";
import { currentLocale } from "./t.js";

export const conjunctionList = (items: readonly string[]): string => listIn(items, currentLocale());
